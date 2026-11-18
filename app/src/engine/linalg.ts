/**
 * Small linear-algebra kit for the engine.
 *
 * - Tridiagonal LU without pivoting: exact port of moments 1.7.1 `Tridiag_solve.pyx`.
 * - Sparse matrices in COO (with duplicate summation, as scipy's coo_matrix) and CSR form.
 * - "Pattern sets": several sparse matrices aligned on one union sparsity pattern, so that a
 *   linear combination sum_k c_k * M_k is a cheap loop over one value array.
 * - Banded LU with partial pivoting: a port of LAPACK dgbtf2 / dgbtrs (column-major band
 *   storage). It replaces scipy's sparse LU (SuperLU) used by moments; both are exact
 *   direct solvers, so results agree to rounding error.
 */

// ---------------------------------------------------------------- tridiagonal (moments port)

export interface Tridiag {
  a: Float64Array; // sub-diagonal (length n-1), a[0] = A[1,0]
  d: Float64Array; // diagonal (length n)
  c: Float64Array; // super-diagonal (length n-1), c[0] = A[0,1]
}

/** In-place LU factorisation of a tridiagonal matrix (no pivoting). */
export function tridiagFactor(t: Tridiag): void {
  const { a, d, c } = t;
  const n = d.length;
  for (let i = 1; i < n; i++) {
    a[i - 1] = a[i - 1] / d[i - 1];
    d[i] = d[i] - a[i - 1] * c[i - 1];
  }
}

/** Solve A x = b with a factorised tridiagonal matrix; returns a new array. */
export function tridiagSolve(t: Tridiag, b: ArrayLike<number>, out?: Float64Array): Float64Array {
  const { a, d, c } = t;
  const n = d.length;
  const x = out ?? new Float64Array(n);
  x[0] = b[0];
  for (let i = 1; i < n; i++) x[i] = b[i] - a[i - 1] * x[i - 1];
  x[n - 1] = x[n - 1] / d[n - 1];
  for (let i = n - 2; i >= 0; i--) x[i] = (x[i] - c[i] * x[i + 1]) / d[i];
  return x;
}

// ---------------------------------------------------------------- sparse matrices

export class COO {
  rows: number[] = [];
  cols: number[] = [];
  vals: number[] = [];
  constructor(public readonly n: number) {}
  add(r: number, c: number, v: number): void {
    this.rows.push(r);
    this.cols.push(c);
    this.vals.push(v);
  }
}

export interface CSR {
  n: number;
  rowPtr: Int32Array;
  colIdx: Int32Array;
  val: Float64Array;
}

/** Convert COO to CSR, summing duplicates (scipy semantics). Entries are sorted by column. */
export function cooToCsr(m: COO): CSR {
  const n = m.n;
  const perRow: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  for (let k = 0; k < m.vals.length; k++) {
    const r = m.rows[k];
    const c = m.cols[k];
    if (r < 0 || r >= n || c < 0 || c >= n) throw new Error(`COO index out of range: (${r}, ${c})`);
    const row = perRow[r];
    row.set(c, (row.get(c) ?? 0) + m.vals[k]);
  }
  return mapsToCsr(n, perRow);
}

function mapsToCsr(n: number, perRow: Map<number, number>[]): CSR {
  let nnz = 0;
  for (const row of perRow) nnz += row.size;
  const rowPtr = new Int32Array(n + 1);
  const colIdx = new Int32Array(nnz);
  const val = new Float64Array(nnz);
  let k = 0;
  for (let r = 0; r < n; r++) {
    rowPtr[r] = k;
    const cols = [...perRow[r].keys()].sort((x, y) => x - y);
    for (const c of cols) {
      colIdx[k] = c;
      val[k] = perRow[r].get(c)!;
      k++;
    }
  }
  rowPtr[n] = k;
  return { n, rowPtr, colIdx, val };
}

/** y = A x */
export function csrMatVec(A: CSR, x: ArrayLike<number>, y?: Float64Array): Float64Array {
  const out = y ?? new Float64Array(A.n);
  for (let r = 0; r < A.n; r++) {
    let s = 0;
    for (let k = A.rowPtr[r]; k < A.rowPtr[r + 1]; k++) s += A.val[k] * x[A.colIdx[k]];
    out[r] = s;
  }
  return out;
}

/** Dense copy (for tests and fixtures). */
export function csrToDense(A: CSR): Float64Array {
  const out = new Float64Array(A.n * A.n);
  for (let r = 0; r < A.n; r++)
    for (let k = A.rowPtr[r]; k < A.rowPtr[r + 1]; k++) out[r * A.n + A.colIdx[k]] += A.val[k];
  return out;
}

/**
 * Several sparse matrices aligned on the union of their patterns.
 * `vals[m]` holds the values of matrix m on the union pattern (zeros where absent).
 */
export interface PatternSet {
  n: number;
  rowPtr: Int32Array;
  colIdx: Int32Array;
  vals: Float64Array[];
  kl: number; // lower bandwidth of the union pattern
  ku: number; // upper bandwidth of the union pattern
}

export function makePatternSet(mats: CSR[]): PatternSet {
  if (mats.length === 0) throw new Error("empty pattern set");
  const n = mats[0].n;
  const perRow: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  for (const A of mats) {
    if (A.n !== n) throw new Error("pattern set: size mismatch");
    for (let r = 0; r < n; r++)
      for (let k = A.rowPtr[r]; k < A.rowPtr[r + 1]; k++) perRow[r].set(A.colIdx[k], 0);
  }
  const union = mapsToCsr(n, perRow);
  // position lookup per row
  const vals = mats.map((A) => {
    const v = new Float64Array(union.val.length);
    for (let r = 0; r < n; r++) {
      let u = union.rowPtr[r];
      for (let k = A.rowPtr[r]; k < A.rowPtr[r + 1]; k++) {
        const c = A.colIdx[k];
        while (union.colIdx[u] !== c) u++;
        v[u] = A.val[k];
      }
    }
    return v;
  });
  let kl = 0;
  let ku = 0;
  for (let r = 0; r < n; r++)
    for (let k = union.rowPtr[r]; k < union.rowPtr[r + 1]; k++) {
      const c = union.colIdx[k];
      if (r - c > kl) kl = r - c;
      if (c - r > ku) ku = c - r;
    }
  return { n, rowPtr: union.rowPtr, colIdx: union.colIdx, vals, kl, ku };
}

/** Linear combination on the union pattern: out = sum_m coef[m] * vals[m] (left to right). */
export function combine(ps: PatternSet, coef: number[], out?: Float64Array): Float64Array {
  const nnz = ps.colIdx.length;
  const v = out ?? new Float64Array(nnz);
  v.fill(0);
  for (let m = 0; m < coef.length; m++) {
    const c = coef[m];
    if (c === 0) continue;
    const vm = ps.vals[m];
    for (let k = 0; k < nnz; k++) v[k] += c * vm[k];
  }
  return v;
}

/** y = x + h * (A x), with A given by values on the pattern. */
export function forwardStep(ps: PatternSet, aVals: Float64Array, h: number, x: Float64Array, y?: Float64Array): Float64Array {
  const out = y ?? new Float64Array(ps.n);
  for (let r = 0; r < ps.n; r++) {
    let s = 0;
    for (let k = ps.rowPtr[r]; k < ps.rowPtr[r + 1]; k++) s += aVals[k] * x[ps.colIdx[k]];
    out[r] = x[r] + h * s;
  }
  return out;
}

// ---------------------------------------------------------------- banded LU (LAPACK port)

export interface BandLU {
  n: number;
  kl: number;
  ku: number;
  ldab: number;
  ab: Float64Array; // column-major band storage, ldab x n
  ipiv: Int32Array;
}

/** Build the band matrix I - h * A (A given by values on the pattern) and factorise it. */
export function factorIdentityMinus(ps: PatternSet, aVals: Float64Array, h: number): BandLU {
  const { n, kl, ku } = ps;
  const kv = kl + ku;
  const ldab = 2 * kl + ku + 1;
  const ab = new Float64Array(ldab * n);
  for (let j = 0; j < n; j++) ab[kv + j * ldab] = 1;
  for (let r = 0; r < n; r++)
    for (let k = ps.rowPtr[r]; k < ps.rowPtr[r + 1]; k++) {
      const c = ps.colIdx[k];
      ab[kv + r - c + c * ldab] -= h * aVals[k];
    }
  const lu: BandLU = { n, kl, ku, ldab, ab, ipiv: new Int32Array(n) };
  bandFactor(lu);
  return lu;
}

/** In-place LU with partial pivoting of a band matrix (LAPACK dgbtf2, 0-based). */
export function bandFactor(lu: BandLU): void {
  const { n, kl, ku, ldab, ab, ipiv } = lu;
  const kv = ku + kl;
  let ju = 0;
  for (let j = 0; j < n; j++) {
    const km = Math.min(kl, n - 1 - j);
    // pivot search in column j, rows j..j+km
    let jp = 0;
    let best = Math.abs(ab[kv + j * ldab]);
    for (let p = 1; p <= km; p++) {
      const v = Math.abs(ab[kv + p + j * ldab]);
      if (v > best) {
        best = v;
        jp = p;
      }
    }
    ipiv[j] = j + jp;
    if (ab[kv + jp + j * ldab] === 0) throw new Error(`singular band matrix at column ${j}`);
    ju = Math.max(ju, Math.min(j + ku + jp, n - 1));
    if (jp !== 0) {
      // swap rows j and j+jp over columns j..ju
      for (let c = j; c <= ju; c++) {
        const i1 = kv + jp + j - c + c * ldab;
        const i2 = kv + j - c + c * ldab;
        const tmp = ab[i1];
        ab[i1] = ab[i2];
        ab[i2] = tmp;
      }
    }
    if (km > 0) {
      const piv = ab[kv + j * ldab];
      const inv = 1 / piv;
      for (let p = 1; p <= km; p++) ab[kv + p + j * ldab] *= inv;
      for (let c = j + 1; c <= ju; c++) {
        const ajc = ab[kv + j - c + c * ldab];
        if (ajc !== 0) {
          const base = kv + j - c + c * ldab;
          for (let p = 1; p <= km; p++) ab[base + p] -= ab[kv + p + j * ldab] * ajc;
        }
      }
    }
  }
}

/** Solve A x = b in place (b is overwritten with x). LAPACK dgbtrs, no transpose. */
export function bandSolve(lu: BandLU, b: Float64Array): Float64Array {
  const { n, kl, ku, ldab, ab, ipiv } = lu;
  const kv = ku + kl;
  if (kl > 0) {
    for (let j = 0; j < n - 1; j++) {
      const lm = Math.min(kl, n - 1 - j);
      const l = ipiv[j];
      if (l !== j) {
        const t = b[l];
        b[l] = b[j];
        b[j] = t;
      }
      const bj = b[j];
      if (bj !== 0) for (let p = 1; p <= lm; p++) b[j + p] -= ab[kv + p + j * ldab] * bj;
    }
  }
  for (let j = n - 1; j >= 0; j--) {
    if (b[j] !== 0) {
      b[j] /= ab[kv + j * ldab];
      const bj = b[j];
      const i0 = Math.max(0, j - kv);
      for (let i = i0; i < j; i++) b[i] -= bj * ab[kv + i - j + j * ldab];
    }
  }
  return b;
}
