/**
 * Jackknife extrapolation matrices for the moment closure.
 *
 * Port of moments 1.7.1 `Jackknife.pyx` (Jouganous et al. 2017).
 * calcJK13(n): order-3 jackknife for one jump, Phi_n -> Phi_(n+1); shape (n, n-1).
 * calcJK23(n): order-3 jackknife for two jumps, Phi_n -> Phi_(n+2); shape (n+1, n-1).
 * Matrices are stored row-major in a Float64Array.
 */

export interface DenseMatrix {
  rows: number;
  cols: number;
  data: Float64Array; // row-major
}

export function at(m: DenseMatrix, i: number, j: number): number {
  // Python-style negative row index (moments relies on ljk[-1, ...] only with a zero factor;
  // we keep the wrap so that a literal port stays faithful).
  const r = i < 0 ? m.rows + i : i;
  const c = j < 0 ? m.cols + j : j;
  return m.data[r * m.cols + c];
}

/** Python 2 rounding (half away from zero), as in moments' `python2round`. */
export function python2round(f: number): number {
  // Python 3 round() is round-half-to-even; moments corrects ties to round away from zero.
  const r3 = (x: number): number => {
    const fl = Math.floor(x);
    const diff = x - fl;
    if (diff > 0.5) return fl + 1;
    if (diff < 0.5) return fl;
    return fl % 2 === 0 ? fl : fl + 1; // banker's rounding
  };
  if (r3(f + 1) - r3(f) !== 1) {
    return f + (Math.abs(f) / f) * 0.5;
  }
  return r3(f);
}

/** The index i' in n samples that best approximates the frequency i/(n+1). */
export function indexBis(i: number, n: number): number {
  return Math.trunc(Math.min(Math.max(python2round((i * n) / (n + 1)), 2), n - 2));
}

export function calcJK13(n: number): DenseMatrix {
  const rows = n;
  const cols = n - 1;
  const J = new Float64Array(rows * cols);
  for (let i = 0; i < n; i++) {
    const ibis = indexBis(i + 1, n) - 1;
    const I1 = i + 1;
    const B1 = ibis + 1;
    J[i * cols + ibis] =
      (-(1 + n) *
        ((2 + i) * (2 + n) * (-6 - n + I1 * (3 + n)) -
          2 * (4 + n) * (-1 + I1 * (2 + n)) * B1 +
          (12 + 7 * n + n ** 2) * B1 ** 2)) /
      (2 + n) /
      (3 + n) /
      (4 + n);
    J[i * cols + ibis - 1] =
      ((1 + n) *
        (4 +
          I1 ** 2 * (6 + 5 * n + n ** 2) -
          I1 * (14 + 9 * n + n ** 2) -
          (4 + n) * (-5 - n + 2 * I1 * (2 + n)) * B1 +
          (12 + 7 * n + n ** 2) * B1 ** 2)) /
      (2 + n) /
      (3 + n) /
      (4 + n) /
      2;
    J[i * cols + ibis + 1] =
      ((1 + n) *
        ((2 + i) * (2 + n) * (-2 + I1 * (3 + n)) -
          (4 + n) * (1 + n + 2 * I1 * (2 + n)) * B1 +
          (12 + 7 * n + n ** 2) * B1 ** 2)) /
      (2 + n) /
      (3 + n) /
      (4 + n) /
      2;
  }
  return { rows, cols, data: J };
}

export function calcJK23(n: number): DenseMatrix {
  const rows = n + 1;
  const cols = n - 1;
  const J = new Float64Array(rows * cols);
  for (let i = 0; i < n + 1; i++) {
    let ibis = indexBis(i + 1, n) - 1;
    if (i === n - 1 || i === n) ibis = n - 3;
    const I1 = i + 1;
    const B1 = ibis + 1;
    J[i * cols + ibis] =
      (-(1 + n) *
        ((2 + i) * (2 + n) * (-9 - n + I1 * (3 + n)) -
          2 * (5 + n) * (-2 + I1 * (2 + n)) * B1 +
          (20 + 9 * n + n ** 2) * B1 ** 2)) /
      (3 + n) /
      (4 + n) /
      (5 + n);
    J[i * cols + ibis - 1] =
      ((1 + n) *
        (12 +
          I1 ** 2 * (6 + 5 * n + n ** 2) -
          I1 * (22 + 13 * n + n ** 2) -
          (5 + n) * (-8 - n + 2 * I1 * (2 + n)) * B1 +
          (20 + 9 * n + n ** 2) * B1 ** 2)) /
      (3 + n) /
      (4 + n) /
      (5 + n) /
      2;
    J[i * cols + ibis + 1] =
      ((1 + n) *
        ((2 + i) * (2 + n) * (-4 + I1 * (3 + n)) -
          (5 + n) * (n + 2 * I1 * (2 + n)) * B1 +
          (20 + 9 * n + n ** 2) * B1 ** 2)) /
      (3 + n) /
      (4 + n) /
      (5 + n) /
      2;
  }
  return { rows, cols, data: J };
}
