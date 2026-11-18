/**
 * Small N-dimensional array (row-major, like numpy C order) and the spectrum manipulations
 * of moments 1.7.1: projection, marginalisation, axis swaps, split, admixture into a new
 * population (`Manips.admix_into_new`, exact), merging two demes into one sample, folding,
 * and flipping (ancestral misidentification).
 */

export interface NDArray {
  shape: number[];
  data: Float64Array;
}

export function size(shape: number[]): number {
  return shape.reduce((a, b) => a * b, 1);
}

export function zeros(shape: number[]): NDArray {
  return { shape: [...shape], data: new Float64Array(size(shape)) };
}

export function clone(a: NDArray): NDArray {
  return { shape: [...a.shape], data: new Float64Array(a.data) };
}

export function strides(shape: number[]): number[] {
  const s = new Array(shape.length).fill(1);
  for (let k = shape.length - 2; k >= 0; k--) s[k] = s[k + 1] * shape[k + 1];
  return s;
}

/** Sample sizes (number of chromosomes) along each axis. */
export function sampleSizes(a: NDArray): number[] {
  return a.shape.map((d) => d - 1);
}

// ---------------------------------------------------------------- log-binomials

const lnFactCache: number[] = [0];
export function lnFact(n: number): number {
  if (n < 0) return NaN;
  while (lnFactCache.length <= n) {
    const k = lnFactCache.length;
    lnFactCache.push(lnFactCache[k - 1] + Math.log(k));
  }
  return lnFactCache[n];
}

/** log of the binomial coefficient C(n, k); -Infinity if k is out of range. */
export function lnComb(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return lnFact(n) - lnFact(k) - lnFact(n - k);
}

// ---------------------------------------------------------------- generic axis helpers

/** Call fn(offsetOfLine, stride) for every 1D line along `axis`. */
function forEachLine(shape: number[], axis: number, fn: (base: number, stride: number) => void): void {
  const st = strides(shape);
  const outer = shape.slice(0, axis).reduce((a, b) => a * b, 1);
  const inner = st[axis];
  const blk = shape[axis] * inner;
  for (let o = 0; o < outer; o++)
    for (let r = 0; r < inner; r++) fn(o * blk + r, inner);
}

/** Hypergeometric projection weights from n0 to n for `hits` derived copies (moments `_cached_projection`). */
const projCache = new Map<string, Float64Array>();
export function projectionWeights(n: number, n0: number, hits: number): Float64Array {
  const key = `${n},${n0},${hits}`;
  let w = projCache.get(key);
  if (w) return w;
  w = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) {
    const l = lnComb(n, k) + lnComb(n0 - n, hits - k) - lnComb(n0, hits);
    w[k] = Number.isFinite(l) ? Math.exp(l) : 0;
  }
  projCache.set(key, w);
  return w;
}

/** Project one axis from its sample size down to n (hypergeometric sampling). */
export function projectAxis(a: NDArray, axis: number, n: number): NDArray {
  const n0 = a.shape[axis] - 1;
  if (n === n0) return clone(a);
  if (n > n0) throw new Error(`cannot project up from ${n0} to ${n}`);
  const outShape = [...a.shape];
  outShape[axis] = n + 1;
  const out = zeros(outShape);
  const inSt = strides(a.shape);
  const outSt = strides(outShape);
  const outer = a.shape.slice(0, axis).reduce((x, y) => x * y, 1);
  const inner = inSt[axis];
  for (let hits = 0; hits <= n0; hits++) {
    const w = projectionWeights(n, n0, hits);
    const least = Math.max(n - (n0 - hits), 0);
    const most = Math.min(hits, n);
    for (let o = 0; o < outer; o++)
      for (let r = 0; r < inner; r++) {
        const v = a.data[o * inSt[axis] * a.shape[axis] + hits * inner + r];
        if (v === 0) continue;
        const base = o * outSt[axis] * outShape[axis] + r;
        for (let k = least; k <= most; k++) out.data[base + k * outSt[axis]] += v * w[k];
      }
  }
  return out;
}

export function project(a: NDArray, ns: number[]): NDArray {
  let out = a;
  ns.forEach((n, axis) => {
    if (n !== out.shape[axis] - 1) out = projectAxis(out, axis, n);
  });
  return out === a ? clone(a) : out;
}

/** Sum over one axis. */
export function marginalize(a: NDArray, axis: number): NDArray {
  const outShape = a.shape.filter((_, k) => k !== axis);
  const out = zeros(outShape);
  const st = strides(a.shape);
  const outer = a.shape.slice(0, axis).reduce((x, y) => x * y, 1);
  const inner = st[axis];
  for (let o = 0; o < outer; o++)
    for (let h = 0; h < a.shape[axis]; h++)
      for (let r = 0; r < inner; r++) out.data[o * inner + r] += a.data[o * inner * a.shape[axis] + h * inner + r];
  return out;
}

/** General axis permutation (numpy transpose). */
export function transpose(a: NDArray, perm: number[]): NDArray {
  const outShape = perm.map((p) => a.shape[p]);
  const out = zeros(outShape);
  const inSt = strides(a.shape);
  const nd = a.shape.length;
  const idx = new Array(nd).fill(0);
  const total = out.data.length;
  for (let flat = 0; flat < total; flat++) {
    let src = 0;
    for (let k = 0; k < nd; k++) src += idx[k] * inSt[perm[k]];
    out.data[flat] = a.data[src];
    for (let k = nd - 1; k >= 0; k--) {
      idx[k]++;
      if (idx[k] < outShape[k]) break;
      idx[k] = 0;
    }
  }
  return out;
}

export function swapAxes(a: NDArray, ax1: number, ax2: number): NDArray {
  const perm = a.shape.map((_, k) => k);
  perm[ax1] = ax2;
  perm[ax2] = ax1;
  return transpose(a, perm);
}

/** Move the last axis to position `pos` (numpy.moveaxis(a, -1, pos)). */
export function moveLastAxisTo(a: NDArray, pos: number): NDArray {
  const nd = a.shape.length;
  const perm: number[] = [];
  for (let k = 0; k < nd - 1; k++) perm.push(k);
  perm.splice(pos, 0, nd - 1);
  return transpose(a, perm);
}

/** Reverse every axis (numpy.flip with no axis). */
export function flipAll(a: NDArray): NDArray {
  const out = zeros(a.shape);
  const n = a.data.length;
  // reversing all axes of a row-major array = reversing the flat array
  for (let k = 0; k < n; k++) out.data[k] = a.data[n - 1 - k];
  return out;
}

/** Remove axes of length 1. */
export function squeeze(a: NDArray): NDArray {
  return { shape: a.shape.filter((d) => d !== 1), data: a.data };
}

// ---------------------------------------------------------------- moments Manips

/** One-to-two population split (`Manips.split_1D_to_2D`): hypergeometric. */
export function split1Dto2D(a: NDArray, n1: number, n2: number): NDArray {
  if (a.shape.length !== 1) throw new Error("split1Dto2D: spectrum is not 1D");
  let d1 = a;
  if (a.shape[0] < n1 + n2 + 1) throw new Error(`sample size too small to split into ${n1} and ${n2}`);
  if (a.shape[0] > n1 + n2 + 1) d1 = project(a, [n1 + n2]);
  const out = zeros([n1 + 1, n2 + 1]);
  for (let i = 0; i <= n1; i++)
    for (let j = 0; j <= n2; j++) {
      const l = lnComb(n1, i) + lnComb(n2, j) - lnComb(n1 + n2, i + j);
      out.data[i * (n2 + 1) + j] = d1.data[i + j] * Math.exp(l);
    }
  return out;
}

/** Two demes pooled into one sample (`Manips.merge_2D_to_1D`). */
export function merge2Dto1D(a: NDArray): NDArray {
  const [d1, d2] = a.shape;
  const out = zeros([d1 + d2 - 1]);
  for (let k = 0; k < d1; k++) for (let l = 0; l < d2; l++) out.data[k + l] += a.data[k * d2 + l];
  return out;
}

/**
 * Move one lineage from axis `src` to axis `tgt` (`Manips.__migrate_1__`).
 * The new array has one entry less along src and one more along tgt.
 */
export function migrate1(a: NDArray, src: number, tgt: number): NDArray {
  const ns = a.shape;
  const M = ns[src] - 1;
  const newShape = [...ns];
  newShape[src] -= 1;
  newShape[tgt] += 1;
  const out = zeros(newShape);
  const inSt = strides(ns);
  const outSt = strides(newShape);
  const nd = ns.length;
  const idx = new Array(nd).fill(0);
  for (let flat = 0; flat < a.data.length; flat++) {
    const v = a.data[flat];
    if (v !== 0) {
      const i = idx[src];
      // ancestral allele picked: source keeps i derived (needs i <= M-1), target unchanged
      if (i <= M - 1) {
        let o = 0;
        for (let k = 0; k < nd; k++) o += idx[k] * outSt[k];
        out.data[o] += v * (1 - i / M);
      }
      // derived allele picked: source i-1, target +1
      if (i >= 1) {
        let o = 0;
        for (let k = 0; k < nd; k++) {
          let x = idx[k];
          if (k === src) x -= 1;
          if (k === tgt) x += 1;
          o += x * outSt[k];
        }
        out.data[o] += v * (i / M);
      }
    }
    for (let k = nd - 1; k >= 0; k--) {
      idx[k]++;
      if (idx[k] < ns[k]) break;
      idx[k] = 0;
    }
  }
  void inSt;
  return out;
}

function scale(a: NDArray, c: number): NDArray {
  const out = clone(a);
  for (let k = 0; k < out.data.length; k++) out.data[k] *= c;
  return out;
}

function add(a: NDArray, b: NDArray): NDArray {
  const out = clone(a);
  for (let k = 0; k < out.data.length; k++) out.data[k] += b.data[k];
  return out;
}

/**
 * Exact admixture into a new population (`Manips.admix_into_new`): draws nLineages, each
 * from axis d1 with probability m1 and from axis d2 with probability 1 - m1. The new
 * population is the last axis; axes of length 1 are squeezed.
 */
export function admixIntoNew(a: NDArray, d1: number, d2: number, nLineages: number, m1: number): NDArray {
  const M = a.shape[d1] - 1;
  const N = a.shape[d2] - 1;
  if (nLineages > Math.min(M, N)) throw new Error(`not enough lineages to produce ${nLineages}, M=${M}, N=${N}`);
  let cur: NDArray = { shape: [...a.shape, 1], data: new Float64Array(a.data) };
  const projDims = cur.shape.map((d) => d - 1);
  const last = cur.shape.length - 1;
  for (let it = 0; it < nLineages; it++) {
    projDims[last] += 1;
    projDims[d1] -= 1;
    projDims[d2] -= 1;
    const p1 = project(scale(migrate1(cur, d1, last), m1), projDims);
    const p2 = project(scale(migrate1(cur, d2, last), 1 - m1), projDims);
    cur = add(p1, p2);
  }
  return squeeze(cur);
}

/**
 * Pulse of gene flow from `source` into `dest` with proportion f, via admixIntoNew
 * (moments.Demes `_pulse_fs` / `_pulse_migrate_into_new`). Before the pulse, the source
 * axis carries n_source + n_dest lineages; afterwards both axes have their sample sizes,
 * and the axis order is unchanged.
 */
export function pulse2D(a: NDArray, source: number, dest: number, f: number): NDArray {
  if (a.shape.length !== 2) throw new Error("pulse2D needs a 2D spectrum");
  const nDest = a.shape[dest] - 1;
  let out = admixIntoNew(a, source, dest, nDest, f);
  // after squeezing, the dest axis is gone and the new population is the last axis;
  // move it back to the dest position
  out = moveLastAxisTo(out, dest);
  return out;
}

// ---------------------------------------------------------------- folding, flipping

export interface Folded {
  data: Float64Array;
  mask: Uint8Array; // 1 = masked
  shape: number[];
}

/** Indices -> total derived count per entry. */
function totalPerEntry(shape: number[]): Int32Array {
  const n = size(shape);
  const out = new Int32Array(n);
  const nd = shape.length;
  const idx = new Array(nd).fill(0);
  for (let flat = 0; flat < n; flat++) {
    let s = 0;
    for (let k = 0; k < nd; k++) s += idx[k];
    out[flat] = s;
    for (let k = nd - 1; k >= 0; k--) {
      idx[k]++;
      if (idx[k] < shape[k]) break;
      idx[k] = 0;
    }
  }
  return out;
}

/** Default moments mask: the two corners (all-ancestral, all-derived). */
export function cornerMask(shape: number[]): Uint8Array {
  const m = new Uint8Array(size(shape));
  m[0] = 1;
  m[m.length - 1] = 1;
  return m;
}

/**
 * Fold a spectrum on the global minor allele (moments `Spectrum.fold`). Entries with a total
 * count above half the total sample size are added to their mirror entry and masked; entries
 * exactly at half are split evenly with their mirror.
 */
export function fold(a: NDArray, mask?: Uint8Array): Folded {
  const shape = a.shape;
  const n = a.data.length;
  const origMask = mask ?? cornerMask(shape);
  const total = sampleSizes(a).reduce((x, y) => x + y, 0);
  const tpe = totalPerEntry(shape);
  const half = Math.floor(total / 2);
  const data = new Float64Array(n);
  for (let k = 0; k < n; k++) data[k] = a.data[k];
  // reversed(where_folded_out ? self : 0)
  for (let k = 0; k < n; k++) {
    const r = n - 1 - k; // flat index of the fully reversed entry
    if (tpe[r] > half) data[k] += a.data[r];
  }
  for (let k = 0; k < n; k++) if (tpe[k] > half) data[k] = 0;
  // ambiguous entries (total == total/2)
  const amb = new Float64Array(n);
  for (let k = 0; k < n; k++) if (tpe[k] === total / 2) amb[k] = a.data[k];
  for (let k = 0; k < n; k++) data[k] += -0.5 * amb[k] + 0.5 * amb[n - 1 - k];
  const outMask = new Uint8Array(n);
  for (let k = 0; k < n; k++) outMask[k] = origMask[k] || origMask[n - 1 - k] || tpe[k] > half ? 1 : 0;
  return { data, mask: outMask, shape: [...shape] };
}

/** Ancestral misidentification (moments.Misc.flip_ancestral_misid): (1-eps) fs + eps flip(fs). */
export function flipAncestralMisid(a: NDArray, eps: number): NDArray {
  if (eps < 0 || eps > 1) throw new Error("misidentification rate must be between 0 and 1");
  const f = flipAll(a);
  const out = zeros(a.shape);
  for (let k = 0; k < out.data.length; k++) out.data[k] = (1 - eps) * a.data[k] + eps * f.data[k];
  return out;
}

export { forEachLine };
