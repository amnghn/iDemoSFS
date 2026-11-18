/**
 * Genotype counts for the exact Weir & Cockerham option (calculator mode, "HWE off, exact").
 *
 * - `vcfToGenotypeCounts`: reads a VCF (text), keeps biallelic records (one ALT allele) and
 *   counts hom-ref / het / hom-alt per population from the GT field. Missing or non-diploid
 *   genotypes are left out of the counts for that site. Samples not in the population map are
 *   ignored. The result is one row of 6 numbers per site:
 *   [homRef1, het1, homAlt1, homRef2, het2, homAlt2].
 * - `parseGenotypeTable`: the same 6 columns from a table (header lines are skipped).
 * - `parseHweFiles`: two `vcftools --hardy` outputs (one per population), joined on CHR and POS,
 *   using the OBS(HOM1/HET/HOM2) column.
 * - `parsePopmap`: "sample<TAB>population" lines; the first two population labels become 1 and 2.
 *
 * Weir & Cockerham's components do not change when the two alleles swap labels, so it does not
 * matter which allele is called "ref".
 */

export interface GenotypeCounts {
  counts: Float64Array; // sites x 6, row-major
  sites: number;
  skipped: Record<string, number>;
  samples: [number, number];
}

export function parsePopmap(text: string): { map: Record<string, 1 | 2>; labels: [string, string] } {
  const map: Record<string, 1 | 2> = {};
  const labels: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [sample, pop] = line.split(/[\s,]+/);
    if (!sample || !pop) throw new Error(`population map: the line "${line}" needs a sample name and a population label`);
    if (!labels.includes(pop)) labels.push(pop);
    if (labels.length > 2) throw new Error("population map: more than two population labels");
    map[sample] = (labels.indexOf(pop) + 1) as 1 | 2;
  }
  if (labels.length !== 2) throw new Error("population map: exactly two population labels are needed");
  return { map, labels: [labels[0], labels[1]] };
}

export function vcfToGenotypeCounts(text: string, popmap: Record<string, 1 | 2>): GenotypeCounts {
  const lines = text.split(/\r?\n/);
  let k = 0;
  while (k < lines.length && !lines[k].startsWith("#CHROM")) k++;
  if (k >= lines.length) throw new Error("VCF: no #CHROM header line found");
  const header = lines[k].split("\t");
  if (header.length < 10) throw new Error("VCF: the file has no sample columns");
  const cols: { idx: number; pop: 1 | 2 }[] = [];
  for (let j = 9; j < header.length; j++) {
    const p = popmap[header[j]];
    if (p) cols.push({ idx: j, pop: p });
  }
  const samples: [number, number] = [cols.filter((c) => c.pop === 1).length, cols.filter((c) => c.pop === 2).length];
  if (!samples[0] || !samples[1]) throw new Error(`VCF: the population map matches ${samples[0]} samples of population 1 and ${samples[1]} of population 2; both need at least one`);
  const rows: number[] = [];
  const skipped: Record<string, number> = { multiallelic: 0, monomorphic: 0, "missing GT field": 0, "missing or non-diploid genotypes": 0 };
  for (k = k + 1; k < lines.length; k++) {
    const line = lines[k];
    if (!line || line.startsWith("#")) continue;
    const f = line.split("\t");
    const alt = f[4];
    if (alt === "." || alt === "*") {
      skipped.monomorphic++;
      continue;
    }
    if (alt.includes(",")) {
      skipped.multiallelic++;
      continue;
    }
    const fmt = (f[8] ?? "").split(":");
    const gi = fmt.indexOf("GT");
    if (gi < 0) {
      skipped["missing GT field"]++;
      continue;
    }
    const c = [0, 0, 0, 0, 0, 0];
    for (const col of cols) {
      const gt = (f[col.idx] ?? ".").split(":")[gi] ?? ".";
      const al = gt.split(/[/|]/);
      if (al.length !== 2 || al[0] === "." || al[1] === ".") {
        skipped["missing or non-diploid genotypes"]++;
        continue;
      }
      const s = Number(al[0]) + Number(al[1]);
      if (!(s >= 0 && s <= 2)) {
        skipped["missing or non-diploid genotypes"]++;
        continue;
      }
      c[(col.pop - 1) * 3 + s]++;
    }
    rows.push(...c);
  }
  return { counts: Float64Array.from(rows), sites: rows.length / 6, skipped, samples };
}

export function parseGenotypeTable(text: string): GenotypeCounts {
  const rows: number[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t || t.startsWith("#")) continue;
    const parts = t.split(/[\s,;]+/);
    const nums = parts.slice(-6).map(Number);
    if (parts.length < 6 || nums.some((x) => !Number.isFinite(x) || x < 0)) {
      skipped++;
      continue;
    }
    rows.push(...nums);
  }
  if (!rows.length) throw new Error("no rows with 6 non-negative numbers (hom-ref, het, hom-alt for population 1, then for population 2)");
  return { counts: Float64Array.from(rows), sites: rows.length / 6, skipped: { "lines without 6 numbers": skipped }, samples: [NaN, NaN] };
}

function parseHwe(text: string): Map<string, [number, number, number]> {
  const out = new Map<string, [number, number, number]>();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error("empty vcftools --hardy file");
  const head = lines[0].split("\t");
  const ci = head.findIndex((h) => h.startsWith("OBS(HOM1/HET/HOM2)"));
  if (ci < 0) throw new Error('not a vcftools --hardy file (no "OBS(HOM1/HET/HOM2)" column)');
  for (const l of lines.slice(1)) {
    const f = l.split("\t");
    const obs = (f[ci] ?? "").split("/").map(Number);
    if (obs.length === 3 && obs.every(Number.isFinite)) out.set(`${f[0]}:${f[1]}`, [obs[0], obs[1], obs[2]]);
  }
  return out;
}

export function parseHweFiles(pop1: string, pop2: string): GenotypeCounts {
  const a = parseHwe(pop1);
  const b = parseHwe(pop2);
  const rows: number[] = [];
  let only = 0;
  for (const [key, x] of a) {
    const y = b.get(key);
    if (!y) {
      only++;
      continue;
    }
    rows.push(...x, ...y);
  }
  only += [...b.keys()].filter((k) => !a.has(k)).length;
  if (!rows.length) throw new Error("the two files have no site (CHR and POS) in common");
  return { counts: Float64Array.from(rows), sites: rows.length / 6, skipped: { "sites in only one file": only }, samples: [NaN, NaN] };
}
