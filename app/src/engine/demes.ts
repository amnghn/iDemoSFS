/**
 * Export a model as a Demes YAML file (Gower et al. 2022; https://popsim-consortium.github.io/demes-spec-docs/).
 *
 * Absolute values: sizes = nu * N_ref (individuals), times = T * 2 N_ref (generations, or years
 * when a generation time is given), migration rate m = M / (2 N_ref), pulse proportion f.
 * Selection, dominance, inbreeding, misidentification and sample sizes are written under
 * `metadata`, because the Demes format has no fields for them.
 */

import { Model, Dynamics, epochBounds } from "./model.ts";

export interface DemesOptions {
  Nref?: number; // default 10000
  generationTime?: number; // years per generation; if given, time_units = years
  description?: string;
}

const num = (x: number): string => {
  if (!Number.isFinite(x)) return x > 0 ? "Infinity" : "-Infinity";
  // shortest round-trip representation (like Python repr)
  return String(x);
};

interface Ep {
  end: number;
  start_size: number;
  end_size: number;
  fn: "constant" | "linear" | "exponential";
}

function epochOf(dyn: Dynamics, startNu: number, endNu: number, end: number, Nref: number): Ep {
  if (dyn === "sudden") return { end, start_size: endNu * Nref, end_size: endNu * Nref, fn: "constant" };
  return { end, start_size: startNu * Nref, end_size: endNu * Nref, fn: dyn };
}

function epochYaml(e: Ep, tScale: number, indent: string): string {
  const parts = [`end_time: ${num(e.end * tScale)}`, `start_size: ${num(e.start_size)}`];
  if (e.fn !== "constant") parts.push(`end_size: ${num(e.end_size)}`, `size_function: ${e.fn}`);
  return `${indent}- {${parts.join(", ")}}`;
}

export function toDemesYaml(m: Model, opts: DemesOptions = {}): string {
  const Nref = opts.Nref ?? 10000;
  const gt = opts.generationTime;
  const tScale = 2 * Nref * (gt ?? 1); // 2 N_ref generations -> generations (or years)
  const lines: string[] = [];
  lines.push(`description: ${JSON.stringify(opts.description ?? "Model exported by the app 'Demographic history and the expected SFS'")}`);
  lines.push(`time_units: ${gt ? "years" : "generations"}`);
  if (gt) lines.push(`generation_time: ${num(gt)}`);
  // metadata
  const meta: string[] = [];
  meta.push(`  N_ref: ${num(Nref)}`);
  meta.push(`  units_note: "nu = N/N_ref; T in 2*N_ref generations; M = 2*N_ref*m; gamma = 2*N_ref*s"`);
  meta.push(`  sample_sizes: {${m.mode === 1 ? `pop1: ${m.n[0]}` : `pop1: ${m.n[0]}, pop2: ${m.n[1]}`}}`);
  if (m.selection.on) meta.push(`  selection: {gamma: ${num(m.selection.gamma)}, h: ${num(m.selection.h)}}`);
  if (m.inbreeding.on)
    meta.push(`  inbreeding: {${m.mode === 1 ? `pop1: ${num(m.inbreeding.F[0])}` : `pop1: ${num(m.inbreeding.F[0])}, pop2: ${num(m.inbreeding.F[1])}`}}`);
  if (m.misid.on) meta.push(`  ancestral_misidentification: ${num(m.misid.eps)}`);
  lines.push("metadata:");
  lines.push(...meta);
  lines.push("demes:");

  const anc = m.ancestral.filter((e) => e.T > 0);
  const postBounds = m.mode === 2 ? epochBounds(m.post.map((e) => e.T), 0) : [];
  const Tsplit = m.mode === 2 ? postBounds[0].start : 0;
  const ancBounds = epochBounds(anc.map((e) => e.T), Tsplit);
  const rootName = m.mode === 1 ? "pop1" : "ANC";
  // root deme: an infinite epoch at N_ref, then the ancestral epochs (end times are suffix
  // sums from the present, so the last epoch ends at exactly 0 or at the split time)
  const rootEps: Ep[] = [{ end: ancBounds.length ? ancBounds[0].start : Tsplit, start_size: Nref, end_size: Nref, fn: "constant" }];
  let prevNu = 1;
  let kept = 0;
  for (const e of m.ancestral) {
    if (e.T > 0) rootEps.push(epochOf(e.dyn, prevNu, e.nu, ancBounds[kept++].end, Nref));
    prevNu = e.nu;
  }
  lines.push(`  - name: ${rootName}`);
  lines.push(`    epochs:`);
  for (const e of rootEps) lines.push(epochYaml(e, tScale, "      "));
  if (m.mode === 1) return lines.join("\n") + "\n";

  // daughters
  const start0 = m.split.useFraction ? [m.split.s * prevNu, (1 - m.split.s) * prevNu] : [m.split.nu1, m.split.nu2];
  for (const p of [0, 1]) {
    lines.push(`  - name: pop${p + 1}`);
    lines.push(`    ancestors: [ANC]`);
    lines.push(`    epochs:`);
    let prev = start0[p];
    m.post.forEach((e, l) => {
      lines.push(epochYaml(epochOf(e.dyn[p], prev, e.nu[p], postBounds[l].end, Nref), tScale, "      "));
      prev = e.nu[p];
    });
  }
  // migrations
  const migs: string[] = [];
  if (m.migration) {
    m.post.forEach((e, l) => {
      const st = postBounds[l].start;
      const en = postBounds[l].end;
      if (e.mig12On)
        migs.push(`  - {source: pop2, dest: pop1, start_time: ${num(st * tScale)}, end_time: ${num(en * tScale)}, rate: ${num(e.m12 / (2 * Nref))}}`);
      if (e.mig21On)
        migs.push(`  - {source: pop1, dest: pop2, start_time: ${num(st * tScale)}, end_time: ${num(en * tScale)}, rate: ${num(e.m21 / (2 * Nref))}}`);
    });
  }
  if (migs.length) lines.push("migrations:", ...migs);
  if (m.pulse.on) {
    const src = `pop${m.pulse.source}`;
    const dst = m.pulse.source === 1 ? "pop2" : "pop1";
    lines.push("pulses:");
    lines.push(`  - {sources: [${src}], dest: ${dst}, time: ${num(m.pulse.time * tScale)}, proportions: [${num(m.pulse.f)}]}`);
  }
  return lines.join("\n") + "\n";
}
