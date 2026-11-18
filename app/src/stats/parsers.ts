/**
 * Parsers for observed spectra (calculator mode).
 *
 * - dadi/moments `.fs` (also the dadi-format output of easySFS): comment lines start with '#';
 *   a header line with the dimensions (n + 1 per population), then `folded` or `unfolded` and
 *   optional population names in double quotes; one line of data (row-major); an optional mask
 *   line (1 = masked). The old format has only the dimensions and no mask line. This follows
 *   `moments.Spectrum.from_file` (moments 1.7.1); without a mask line, the corners are masked,
 *   as `moments.Spectrum` does by default.
 * - ANGSD `realSFS` (Korneliussen et al. 2014): one spectrum per line, (n1 + 1)(n2 + 1) numbers,
 *   reshaped row-major with population 1 as rows (as `moments.Spectrum.from_angsd`). Several
 *   lines (bootstrap replicates or windows): the first line or the mean.
 * - Plain matrix (comma, tab, semicolon or space separated): one row = 1D; several rows = 2D with
 *   n1 + 1 rows and n2 + 1 columns. A non-numeric first row and first column are treated as
 *   labels and dropped (for example the CSV export of this app).
 */

export type Format = "dadi" | "realsfs" | "matrix";

export interface ParsedSFS {
  format: Format;
  shape: number[]; // n + 1 per population
  data: Float64Array; // row-major
  mask: Uint8Array; // 1 = masked
  folded: boolean;
  popNames: string[] | null;
  comments: string[];
  notes: string[]; // messages for the user
  lines?: number; // number of spectra in a realSFS file
}

const NUM = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$|^[-+]?(inf|nan)$/i;
const isNum = (t: string): boolean => NUM.test(t);
const toNum = (t: string): number => {
  const l = t.toLowerCase();
  if (l === "nan" || l === "+nan" || l === "-nan") return NaN;
  if (l === "inf" || l === "+inf") return Infinity;
  if (l === "-inf") return -Infinity;
  return Number(t);
};

function cornerMaskOf(shape: number[]): Uint8Array {
  const n = shape.reduce((a, b) => a * b, 1);
  const m = new Uint8Array(n);
  m[0] = 1;
  m[n - 1] = 1;
  return m;
}

function checkValues(data: Float64Array, notes: string[]): void {
  let neg = 0;
  let bad = 0;
  for (const v of data) {
    if (!Number.isFinite(v)) bad++;
    else if (v < 0) neg++;
  }
  if (bad) throw new Error(`${bad} entries are not finite numbers`);
  if (neg) notes.push(`${neg} entries are negative. Spectra from ANGSD can have tiny negative values from numerical optimisation; check the file.`);
}

/** Is this text a dadi/moments .fs file (a header with 'folded'/'unfolded', or old format)? */
export function looksLikeDadi(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  if (!lines.length) return false;
  if (/\b(un)?folded\b/.test(lines[0])) return true;
  // old format: a short integer header followed by a longer data line of product length
  const head = lines[0].trim().split(/\s+/);
  if (lines.length >= 2 && head.length <= 3 && head.every((t) => /^\d+$/.test(t))) {
    const prod = head.map(Number).reduce((a, b) => a * b, 1);
    return lines[1].trim().split(/\s+/).length === prod;
  }
  return false;
}

export function parseDadi(text: string): ParsedSFS {
  const all = text.split(/\r?\n/);
  const comments: string[] = [];
  let k = 0;
  while (k < all.length && (all[k].startsWith("#") || !all[k].trim())) {
    if (all[k].startsWith("#")) comments.push(all[k].slice(1).trim());
    k++;
  }
  if (k >= all.length) throw new Error("no header line found");
  const header = all[k++];
  const spl = header.trim().split(/\s+/);
  let shape: number[];
  let folded = false;
  let popNames: string[] | null = null;
  if (!spl.includes("folded") && !spl.includes("unfolded")) {
    shape = spl.map((t) => {
      if (!/^\d+$/.test(t)) throw new Error(`header: "${t}" is not an integer dimension`);
      return Number(t);
    });
  } else {
    shape = [];
    let i = 0;
    while (spl[i] !== "folded" && spl[i] !== "unfolded") {
      if (!/^\d+$/.test(spl[i])) throw new Error(`header: "${spl[i]}" is not an integer dimension`);
      shape.push(Number(spl[i++]));
    }
    folded = spl[i] === "folded";
    const names = header.split('"').filter((_, j) => j % 2 === 1);
    popNames = names.length ? names : null;
  }
  if (!shape.length || shape.length > 2) throw new Error(`only 1D and 2D spectra are supported (found ${shape.length} dimensions)`);
  if (shape.some((d) => d < 2)) throw new Error("each dimension must be at least 2 (n + 1 with n >= 1)");
  const total = shape.reduce((a, b) => a * b, 1);
  // data: the next non-empty, non-comment line (moments reads exactly one line)
  while (k < all.length && (!all[k].trim() || all[k].startsWith("#"))) k++;
  if (k >= all.length) throw new Error("no data line found");
  const tokens = all[k++].trim().split(/\s+/);
  if (tokens.length < total) throw new Error(`the data line has ${tokens.length} numbers; the header needs ${total}`);
  if (!tokens.slice(0, total).every(isNum)) throw new Error("the data line contains entries that are not numbers");
  const data = Float64Array.from(tokens.slice(0, total).map(toNum));
  const notes: string[] = [];
  checkValues(data, notes);
  let mask: Uint8Array;
  while (k < all.length && !all[k].trim()) k++;
  if (k < all.length && all[k].trim() && !all[k].startsWith("#")) {
    const mt = all[k].trim().split(/\s+/);
    if (mt.length < total) throw new Error(`the mask line has ${mt.length} entries; the header needs ${total}`);
    mask = Uint8Array.from(mt.slice(0, total).map((t) => (Number(t) !== 0 ? 1 : 0)));
  } else {
    mask = cornerMaskOf(shape);
    notes.push("The file has no mask line (old format); the two corner bins are masked.");
  }
  return { format: "dadi", shape, data, mask, folded, popNames, comments, notes };
}

export function parseRealSFS(text: string, n: number[], use: "first" | "mean" = "first"): ParsedSFS {
  const shape = n.map((x) => x + 1);
  const total = shape.reduce((a, b) => a * b, 1);
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(/[\s,]+/));
  if (!rows.length) throw new Error("no numbers found");
  rows.forEach((r, i) => {
    if (r.length !== total)
      throw new Error(`line ${i + 1} has ${r.length} numbers, but sample sizes (${n.join(", ")}) need ${total} = ${shape.join(" × ")}`);
    if (!r.every(isNum)) throw new Error(`line ${i + 1} contains entries that are not numbers`);
  });
  const data = new Float64Array(total);
  const take = use === "first" ? rows.slice(0, 1) : rows;
  for (const r of take) for (let k = 0; k < total; k++) data[k] += toNum(r[k]) / take.length;
  const notes: string[] = [];
  if (rows.length > 1)
    notes.push(use === "first" ? `The file has ${rows.length} spectra (bootstrap replicates or windows); the first line is used.` : `The mean of ${rows.length} spectra is used.`);
  checkValues(data, notes);
  return { format: "realsfs", shape, data, mask: cornerMaskOf(shape), folded: false, popNames: null, comments: [], notes, lines: rows.length };
}

export function parseMatrix(text: string): ParsedSFS {
  let rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(/[\s,;]+/).filter(Boolean));
  if (!rows.length) throw new Error("no numbers found");
  const notes: string[] = [];
  if (!rows[0].every(isNum)) {
    const header = rows[0];
    rows = rows.slice(1);
    notes.push("The first row has labels and was skipped.");
    // a first column of labels: non-numeric, or the row indices 0, 1, 2, ... under a header of the same width
    const indexColumn = rows.length > 0 && rows.every((r, i) => r.length === header.length && r[0] === String(i));
    if (rows.length && (!isNum(rows[0][0]) || indexColumn)) {
      rows = rows.map((r) => r.slice(1));
      notes.push("The first column has labels and was skipped.");
    }
  }
  if (!rows.length) throw new Error("no numeric rows found");
  const w = rows[0].length;
  rows.forEach((r, i) => {
    if (r.length !== w) throw new Error(`row ${i + 1} has ${r.length} entries; the first row has ${w}`);
    if (!r.every(isNum)) throw new Error(`row ${i + 1} contains entries that are not numbers`);
  });
  const shape = rows.length === 1 ? [w] : [rows.length, w];
  if (shape.some((d) => d < 2)) throw new Error("each dimension must be at least 2");
  const data = Float64Array.from(rows.flat().map(toNum));
  checkValues(data, notes);
  return { format: "matrix", shape, data, mask: cornerMaskOf(shape), folded: false, popNames: null, comments: [], notes };
}

/** Is a spectrum folded in the moments sense (all entries above half the total sample are zero)? */
export function looksFolded(p: ParsedSFS): boolean {
  const total = p.shape.reduce((a, d) => a + d - 1, 0);
  const strides = p.shape.length === 2 ? [p.shape[1], 1] : [1];
  let any = false;
  for (let k = 0; k < p.data.length; k++) {
    const idx = p.shape.length === 2 ? [Math.floor(k / strides[0]), k % strides[0]] : [k];
    const c = idx.reduce((a, b) => a + b, 0);
    if (c > total / 2 && p.data[k] !== 0) return false;
    if (c > total / 2) any = true;
  }
  return any;
}

/** Total of the two monomorphic corner bins (0 when the file has none). */
export function cornerTotal(p: ParsedSFS): number {
  return p.data[0] + p.data[p.data.length - 1];
}
