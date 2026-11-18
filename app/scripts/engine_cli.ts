/**
 * Command-line interface to the TypeScript engine, for the validation pipeline.
 *
 *   tsx scripts/engine_cli.ts spectra --csv ../validation/models.csv --root .. --out ../validation/output/ts [--dtfac 0.02]
 *       For every row: the expected SFS (theta = 1), its folded form, the 2D views, the
 *       "core" spectrum (before inbreeding and misidentification), and the Demes YAML export.
 *   tsx scripts/engine_cli.ts bench --csv ../validation/models.csv --root .. --out <file.tsv> [--reps 7] [--dtfac 0.02]
 *       Median wall time per model (warm cache), for the speed table.
 *
 * Paths are relative to the current directory. No network access, no other side effects.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { computeSFS, views2D } from "../src/engine/compute.ts";
import { modelFromOverrides, Model } from "../src/engine/model.ts";
import { toDemesYaml } from "../src/engine/demes.ts";
import { fold, marginalize } from "../src/engine/ndarray.ts";
import { onePopStats } from "../src/stats/onepop.ts";
import { twoPopStats, wcFromGenotypeCounts, HetMode } from "../src/stats/twopop.ts";

function arg(name: string, def?: string): string {
  const k = process.argv.indexOf(`--${name}`);
  if (k >= 0 && k + 1 < process.argv.length) return process.argv[k + 1];
  if (def === undefined) throw new Error(`missing --${name}`);
  return def;
}

/** Minimal CSV reader (quoted fields allowed). */
function readCsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, "utf-8").replace(/\r/g, "");
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.length > 1 || r[0] !== "");
  return body.map((r) => Object.fromEntries(head.map((h, k) => [h, r[k] ?? ""])));
}

function loadModel(root: string, file: string): Model {
  return modelFromOverrides(JSON.parse(readFileSync(join(root, file), "utf-8")));
}

const arr = (x: Float64Array | Uint8Array) => Array.from(x);

function spectra(): void {
  const csv = arg("csv");
  const root = resolve(arg("root", "."));
  const out = resolve(arg("out"));
  const dtFac = Number(arg("dtfac", "0.02"));
  mkdirSync(out, { recursive: true });
  for (const row of readCsv(csv)) {
    const id = row.model_id;
    const model = loadModel(root, row.model_file);
    const res = computeSFS(model, { dtFac });
    const core = computeSFS({ ...model, inbreeding: { ...model.inbreeding, on: false }, misid: { ...model.misid, on: false } }, { dtFac });
    const f = fold(res.sfs);
    const o: Record<string, unknown> = {
      model_id: id,
      dt_fac: dtFac,
      shape: res.sfs.shape,
      n: res.plan.n,
      sim_n: res.plan.simN,
      root_n: res.plan.rootN,
      intervals: res.plan.intervals.map((iv) => ({ start: iv.start, end: iv.end, pops: iv.pops, ns: iv.ns, migration: iv.mig !== null })),
      stats: res.stats,
      sfs: arr(res.sfs.data),
      core_sfs: arr(core.sfs.data),
      folded: arr(f.data),
      folded_mask: arr(f.mask),
      model,
    };
    if (res.sfs.shape.length === 2) {
      const v = views2D(res.sfs);
      o.marg1 = arr(v.marg1.data);
      o.marg2 = arr(v.marg2.data);
      o.pooled = arr(v.pooled.data);
    }
    writeFileSync(join(out, `${id}.json`), JSON.stringify(o));
    writeFileSync(join(out, `${id}.yaml`), toDemesYaml(model, { description: `Validation model ${id}: ${row.description}` }));
    console.log(`${id}\tshape=${res.sfs.shape.join("x")}\tsteps=${res.stats.steps}\tfact=${res.stats.factorisations}\tms=${res.stats.ms.toFixed(1)}`);
  }
}

function bench(): void {
  const csv = arg("csv");
  const root = resolve(arg("root", "."));
  const outFile = resolve(arg("out"));
  const reps = Number(arg("reps", "7"));
  const dtFac = Number(arg("dtfac", "0.02"));
  const lines = ["model_id\tshape\tdt_fac\treps\tmedian_ms\tmin_ms\tsteps\tfactorisations"];
  for (const row of readCsv(csv)) {
    const model = loadModel(root, row.model_file);
    computeSFS(model, { dtFac }); // warm-up (operator caches, JIT)
    const times: number[] = [];
    let last = computeSFS(model, { dtFac });
    for (let r = 0; r < reps; r++) {
      last = computeSFS(model, { dtFac });
      times.push(last.stats.ms);
    }
    times.sort((a, b) => a - b);
    const med = times[Math.floor(times.length / 2)];
    lines.push([row.model_id, last.sfs.shape.join("x"), dtFac, reps, med.toFixed(2), times[0].toFixed(2), last.stats.steps, last.stats.factorisations].join("\t"));
    console.log(lines[lines.length - 1]);
  }
  writeFileSync(outFile, lines.join("\n") + "\n");
}

/**
 * stats --in <file.json> --out <file.json>
 * Input: [{id, shape: [n+1] | [n1+1, n2+1], sfs: flat counts, fis?: [F1, F2], genotype_counts?: [[6 ints], ...]}]
 * Output: one-population statistics (1D, or each margin of a 2D spectrum) and two-population
 * statistics for each heterozygosity mode.
 */
function stats(): void {
  const items = JSON.parse(readFileSync(resolve(arg("in")), "utf-8")) as {
    id: string;
    shape: number[];
    sfs: number[];
    fis?: [number, number];
    genotype_counts?: number[][];
  }[];
  const out = items.map((it) => {
    const nd = { shape: it.shape, data: Float64Array.from(it.sfs) };
    if (it.shape.length === 1) return { id: it.id, onepop: onePopStats(nd.data) };
    const m1 = marginalize(nd, 1).data;
    const m2 = marginalize(nd, 0).data;
    const joint = { n1: it.shape[0] - 1, n2: it.shape[1] - 1, data: nd.data };
    const modes: Record<string, HetMode> = { hwe: { kind: "hwe" }, hwe_plain: { kind: "hwe-plain" } };
    if (it.fis) modes.fis = { kind: "fis", F: it.fis };
    const two = Object.fromEntries(Object.entries(modes).map(([k, mode]) => [k, twoPopStats(joint, mode)]));
    const r: Record<string, unknown> = { id: it.id, pop1: onePopStats(m1), pop2: onePopStats(m2), twopop: two };
    if (it.genotype_counts) r.wc_genotypes = wcFromGenotypeCounts(it.genotype_counts);
    return r;
  });
  writeFileSync(resolve(arg("out")), JSON.stringify(out, null, 1));
  console.log(`statistics for ${out.length} spectra written to ${arg("out")}`);
}

const cmd = process.argv[2];
if (cmd === "spectra") spectra();
else if (cmd === "bench") bench();
else if (cmd === "stats") stats();
else {
  console.error("usage: engine_cli.ts spectra|bench --csv <models.csv> --root <project root> --out <dir|file>  |  stats --in <json> --out <json>");
  process.exit(2);
}
