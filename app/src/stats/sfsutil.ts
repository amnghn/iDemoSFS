/**
 * Helpers that work on spectra as plain arrays (theta = 1 or counts): views of a joint SFS,
 * folding for display, a minor-allele-frequency filter, and the neutral expectation.
 */

import { NDArray, fold, marginalize, merge2Dto1D, project, cornerMask } from "../engine/ndarray.ts";

export const asND = (shape: number[], data: Float64Array): NDArray => ({ shape: [...shape], data });

/** Neutral expectation E[xi_i] = theta / i (i = 1..n-1), zeros at the corners. */
export function neutralSFS(n: number, theta = 1): Float64Array {
  const x = new Float64Array(n + 1);
  for (let i = 1; i < n; i++) x[i] = theta / i;
  return x;
}

/** The 1D spectra of a joint spectrum: the two margins and the pooled sample. */
export function views(joint: NDArray): { pop1: NDArray; pop2: NDArray; pooled: NDArray } {
  return { pop1: marginalize(joint, 1), pop2: marginalize(joint, 0), pooled: merge2Dto1D(joint) };
}

export interface Bins {
  bins: number[]; // derived (unfolded) or minor (folded) allele counts shown
  values: number[]; // value per shown bin
}

/** The polymorphic bins of a 1D spectrum (unfolded 1..n-1, or folded 1..floor(n/2)). */
export function polyBins(x: ArrayLike<number>, folded: boolean): Bins {
  const n = x.length - 1;
  if (!folded) {
    const bins = Array.from({ length: n - 1 }, (_, k) => k + 1);
    return { bins, values: bins.map((i) => x[i]) };
  }
  const f = fold({ shape: [n + 1], data: Float64Array.from(x) });
  const bins = Array.from({ length: Math.floor(n / 2) }, (_, k) => k + 1);
  return { bins, values: bins.map((i) => f.data[i]) };
}

/** Folded joint spectrum with its mask (moments convention). */
export function foldJoint(joint: NDArray): { data: Float64Array; mask: Uint8Array } {
  const f = fold(joint, cornerMask(joint.shape));
  return { data: f.data, mask: f.mask };
}

/**
 * Minor allele frequency filter on a joint spectrum: entries whose minor allele frequency in
 * the pooled sample is below `maf` are set to zero (monomorphic corners are always zero).
 */
export function mafFilterJoint(joint: NDArray, maf: number): NDArray {
  const [d1, d2] = joint.shape;
  const N = d1 - 1 + (d2 - 1);
  const out = new Float64Array(joint.data.length);
  for (let i = 0; i < d1; i++)
    for (let j = 0; j < d2; j++) {
      const c = i + j;
      const minor = Math.min(c, N - c) / N;
      if (minor > 0 && minor >= maf - 1e-12) out[i * d2 + j] = joint.data[i * d2 + j];
    }
  return { shape: [d1, d2], data: out };
}

/** Sum of the polymorphic entries (corners excluded). */
export function polySum(a: NDArray): number {
  let s = 0;
  for (let k = 1; k < a.data.length - 1; k++) s += a.data[k];
  return s;
}

export function scale(a: ArrayLike<number>, c: number): Float64Array {
  const out = new Float64Array(a.length);
  for (let k = 0; k < a.length; k++) out[k] = a[k] * c;
  return out;
}

/** Project a joint spectrum to smaller sample sizes (hypergeometric sampling). */
export const projectJoint = (joint: NDArray, n1: number, n2: number): NDArray => project(joint, [n1, n2]);
