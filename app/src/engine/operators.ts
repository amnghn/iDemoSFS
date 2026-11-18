/**
 * Operator matrices of the moment equations (drift, selection, migration).
 *
 * Literal port of moments 1.7.1 `LinearSystem_1D.pyx` and `LinearSystem_2D.pyx`.
 * `d` (or d1, d2) is the number of entries along an axis, i.e. sample size + 1.
 * 2D matrices act on the row-major flattened spectrum, k = i * d2 + j.
 * Duplicate (row, col) entries are summed, as in scipy's coo_matrix.
 */

import { COO, CSR, cooToCsr, Tridiag } from "./linalg.ts";
import { DenseMatrix, at, indexBis } from "./jackknife.ts";

// ---------------------------------------------------------------- 1D

/** Drift matrix (calcD), sparse. */
export function calcD(d: number): CSR {
  const m = new COO(d);
  for (let i = 0; i < d; i++) {
    if (i > 1) m.add(i, i - 1, (i - 1) * (d - i));
    if (i < d - 2) m.add(i, i + 1, (i + 1) * (d - i - 2));
    if (i > 0 && i < d - 1) m.add(i, i, -2 * i * (d - i - 1));
  }
  return cooToCsr(m);
}

/** The three diagonals of the drift matrix (calcD_dense + mat_to_diag). */
export function calcDDiags(d: number): Tridiag {
  const a = new Float64Array(d - 1);
  const dd = new Float64Array(d);
  const c = new Float64Array(d - 1);
  for (let i = 0; i < d; i++) {
    if (i > 1) a[i - 1] = (i - 1) * (d - i); // res[i, i-1]
    if (i < d - 2) c[i] = (i + 1) * (d - i - 2); // res[i, i+1]
    if (i > 0 && i < d - 1) dd[i] = -2 * i * (d - i - 1);
  }
  return { a, d: dd, c };
}

/** Selection with h = 0.5 (calcS); ljk = calcJK13(d - 1). */
export function calcS(d: number, ljk: DenseMatrix): CSR {
  const m = new COO(d);
  for (let i = 0; i < d; i++) {
    const iBis = indexBis(i, d - 1);
    const iTer = indexBis(i + 1, d - 1);
    const g1 = (i * (d - i)) / d;
    const g2 = (-(i + 1) * (d - 1 - i)) / d;
    if (i < d - 1 && i > 0) {
      m.add(i, iBis, g1 * at(ljk, i - 1, iBis - 1));
      m.add(i, iBis - 1, g1 * at(ljk, i - 1, iBis - 2));
      m.add(i, iBis + 1, g1 * at(ljk, i - 1, iBis));
      m.add(i, iTer, g2 * at(ljk, i, iTer - 1));
      m.add(i, iTer - 1, g2 * at(ljk, i, iTer - 2));
      m.add(i, iTer + 1, g2 * at(ljk, i, iTer));
    } else if (i === 0) {
      m.add(i, iTer, g2 * at(ljk, i, iTer - 1));
      m.add(i, iTer - 1, g2 * at(ljk, i, iTer - 2));
      m.add(i, iTer + 1, g2 * at(ljk, i, iTer));
    } else if (i === d - 1) {
      m.add(i, iBis, g1 * at(ljk, i - 1, iBis - 1));
      m.add(i, iBis - 1, g1 * at(ljk, i - 1, iBis - 2));
      m.add(i, iBis + 1, g1 * at(ljk, i - 1, iBis));
    }
  }
  return cooToCsr(m);
}

/** Selection, part due to h != 0.5 (calcS2); ljk = calcJK23(d - 1). */
export function calcS2(d: number, ljk: DenseMatrix): CSR {
  const m = new COO(d);
  for (let i = 0; i < d; i++) {
    const iTer = indexBis(i + 1, d - 1);
    const iQua = indexBis(i + 2, d - 1);
    const g1 = (((i + 1) / d / (d + 1)) * i) * (d - i);
    const g2 = (((-(i + 1) / d / (d + 1)) * (i + 2)) * (d - 1 - i));
    if (i < d - 1) {
      m.add(i, iTer, g1 * at(ljk, i, iTer - 1));
      m.add(i, iTer - 1, g1 * at(ljk, i, iTer - 2));
      m.add(i, iTer + 1, g1 * at(ljk, i, iTer));
      m.add(i, iQua, g2 * at(ljk, i + 1, iQua - 1));
      m.add(i, iQua - 1, g2 * at(ljk, i + 1, iQua - 2));
      m.add(i, iQua + 1, g2 * at(ljk, i + 1, iQua));
    } else if (i === d - 1) {
      m.add(i, iTer, g1 * at(ljk, i, iTer - 1));
      m.add(i, iTer - 1, g1 * at(ljk, i, iTer - 2));
      m.add(i, iTer + 1, g1 * at(ljk, i, iTer));
    }
  }
  return cooToCsr(m);
}

// ---------------------------------------------------------------- 2D

export function calcD1(d1: number, d2: number): CSR {
  const d = d1 * d2;
  const m = new COO(d);
  for (let k = 0; k < d; k++) {
    const index = Math.floor(k / d2);
    if (index > 1) m.add(k, k - d2, (index - 1) * (d1 - index));
    if (index < d1 - 2) m.add(k, k + d2, (index + 1) * (d1 - index - 2));
    if (index > 0 && index < d1 - 1) m.add(k, k, -2 * index * (d1 - index - 1));
  }
  return cooToCsr(m);
}

export function calcD2(d1: number, d2: number): CSR {
  const d = d1 * d2;
  const m = new COO(d);
  for (let k = 0; k < d; k++) {
    const index = k % d2;
    if (index > 1) m.add(k, k - 1, (index - 1) * (d2 - index));
    if (index < d2 - 2) m.add(k, k + 1, (index + 1) * (d2 - index - 2));
    if (index > 0 && index < d2 - 1) m.add(k, k, -2 * index * (d2 - index - 1));
  }
  return cooToCsr(m);
}

/** Selection along axis 1 with h = 0.5; ljk = calcJK13(d1 - 1). */
export function calcS_1(d1: number, d2: number, ljk: DenseMatrix): CSR {
  const d = d1 * d2;
  const m = new COO(d);
  for (let k = 0; k < d; k++) {
    const i = Math.floor(k / d2);
    const j = k % d2;
    const iBis = indexBis(i, d1 - 1);
    const iTer = indexBis(i + 1, d1 - 1);
    const g1 = (i * (d1 - i)) / d1;
    const g2 = (-(i + 1) * (d1 - 1 - i)) / d1;
    if (i < d1 - 1) {
      // for i == 0, g1 == 0 and moments reads ljk[-1, ...] (wraps); the product is 0
      m.add(k, iBis * d2 + j, g1 * at(ljk, i - 1, iBis - 1));
      m.add(k, (iBis - 1) * d2 + j, g1 * at(ljk, i - 1, iBis - 2));
      m.add(k, (iBis + 1) * d2 + j, g1 * at(ljk, i - 1, iBis));
      m.add(k, iTer * d2 + j, g2 * at(ljk, i, iTer - 1));
      m.add(k, (iTer - 1) * d2 + j, g2 * at(ljk, i, iTer - 2));
      m.add(k, (iTer + 1) * d2 + j, g2 * at(ljk, i, iTer));
    }
    if (i === d1 - 1) {
      m.add(k, iBis * d2 + j, g1 * at(ljk, i - 1, iBis - 1));
      m.add(k, (iBis - 1) * d2 + j, g1 * at(ljk, i - 1, iBis - 2));
      m.add(k, (iBis + 1) * d2 + j, g1 * at(ljk, i - 1, iBis));
    }
  }
  return cooToCsr(m);
}

/** Selection along axis 2 with h = 0.5; ljk = calcJK13(d2 - 1). */
export function calcS_2(d1: number, d2: number, ljk: DenseMatrix): CSR {
  const d = d1 * d2;
  const m = new COO(d);
  for (let k = 0; k < d; k++) {
    const i = Math.floor(k / d2);
    const j = k % d2;
    const jBis = indexBis(j, d2 - 1);
    const jTer = indexBis(j + 1, d2 - 1);
    const g1 = (j * (d2 - j)) / d2;
    const g2 = (-(j + 1) * (d2 - 1 - j)) / d2;
    if (j < d2 - 1) {
      m.add(k, i * d2 + jBis, g1 * at(ljk, j - 1, jBis - 1));
      m.add(k, i * d2 + jBis - 1, g1 * at(ljk, j - 1, jBis - 2));
      m.add(k, i * d2 + jBis + 1, g1 * at(ljk, j - 1, jBis));
      m.add(k, i * d2 + jTer, g2 * at(ljk, j, jTer - 1));
      m.add(k, i * d2 + jTer - 1, g2 * at(ljk, j, jTer - 2));
      m.add(k, i * d2 + jTer + 1, g2 * at(ljk, j, jTer));
    }
    if (j === d2 - 1) {
      m.add(k, i * d2 + jBis, g1 * at(ljk, j - 1, jBis - 1));
      m.add(k, i * d2 + jBis - 1, g1 * at(ljk, j - 1, jBis - 2));
      m.add(k, i * d2 + jBis + 1, g1 * at(ljk, j - 1, jBis));
    }
  }
  return cooToCsr(m);
}

/** Selection along axis 1, part due to h != 0.5; ljk = calcJK23(d1 - 1). */
export function calcS2_1(d1: number, d2: number, ljk: DenseMatrix): CSR {
  const d = d1 * d2;
  const m = new COO(d);
  for (let k = 0; k < d; k++) {
    const i = Math.floor(k / d2);
    const j = k % d2;
    const iTer = indexBis(i + 1, d1 - 1);
    const iQua = indexBis(i + 2, d1 - 1);
    const g1 = (((i + 1) / d1 / (d1 + 1)) * i) * (d1 - i);
    const g2 = ((-(i + 1) / d1 / (d1 + 1)) * (i + 2)) * (d1 - 1 - i);
    if (i < d1 - 1) {
      m.add(k, iTer * d2 + j, g1 * at(ljk, i, iTer - 1));
      m.add(k, (iTer - 1) * d2 + j, g1 * at(ljk, i, iTer - 2));
      m.add(k, (iTer + 1) * d2 + j, g1 * at(ljk, i, iTer));
      m.add(k, iQua * d2 + j, g2 * at(ljk, i + 1, iQua - 1));
      m.add(k, (iQua - 1) * d2 + j, g2 * at(ljk, i + 1, iQua - 2));
      m.add(k, (iQua + 1) * d2 + j, g2 * at(ljk, i + 1, iQua));
    }
    if (i === d1 - 1) {
      m.add(k, iTer * d2 + j, g1 * at(ljk, i, iTer - 1));
      m.add(k, (iTer - 1) * d2 + j, g1 * at(ljk, i, iTer - 2));
      m.add(k, (iTer + 1) * d2 + j, g1 * at(ljk, i, iTer));
    }
  }
  return cooToCsr(m);
}

/** Selection along axis 2, part due to h != 0.5; ljk = calcJK23(d2 - 1). */
export function calcS2_2(d1: number, d2: number, ljk: DenseMatrix): CSR {
  const d = d1 * d2;
  const m = new COO(d);
  for (let k = 0; k < d; k++) {
    const i = Math.floor(k / d2);
    const j = k % d2;
    const jTer = indexBis(j + 1, d2 - 1);
    const jQua = indexBis(j + 2, d2 - 1);
    const g1 = (((j + 1) / d2 / (d2 + 1)) * j) * (d2 - j);
    const g2 = ((-(j + 1) / d2 / (d2 + 1)) * (j + 2)) * (d2 - 1 - j);
    if (j < d2 - 1) {
      m.add(k, i * d2 + jTer, g1 * at(ljk, j, jTer - 1));
      m.add(k, i * d2 + jTer - 1, g1 * at(ljk, j, jTer - 2));
      m.add(k, i * d2 + jTer + 1, g1 * at(ljk, j, jTer));
      m.add(k, i * d2 + jQua, g2 * at(ljk, j + 1, jQua - 1));
      m.add(k, i * d2 + jQua - 1, g2 * at(ljk, j + 1, jQua - 2));
      m.add(k, i * d2 + jQua + 1, g2 * at(ljk, j + 1, jQua));
    }
    if (j === d2 - 1) {
      m.add(k, i * d2 + jTer, g1 * at(ljk, j, jTer - 1));
      m.add(k, i * d2 + jTer - 1, g1 * at(ljk, j, jTer - 2));
      m.add(k, i * d2 + jTer + 1, g1 * at(ljk, j, jTer));
    }
  }
  return cooToCsr(m);
}

/** Migration into population 1 (changes axis 1, jackknife on axis 2); ljk = calcJK13(d2 - 1). */
export function calcM_1(d1: number, d2: number, ljk: DenseMatrix): CSR {
  const d = d1 * d2;
  const m = new COO(d);
  for (let k = 0; k < d; k++) {
    const i = Math.floor(k / d2);
    const j = k % d2;
    const jTer = indexBis(j + 1, d2 - 1);
    const c = (j + 1) / d2;
    const coeff1 = (2 * i - (d1 - 1)) * c;
    const coeff2 = (d1 - i) * c;
    const coeff3 = -(i + 1) * c;
    m.add(k, k, -i);
    if (i < d1 - 1) m.add(k, k + d2, i + 1);
    if (j < d2 - 1) {
      m.add(k, i * d2 + jTer - 1, coeff1 * at(ljk, j, jTer - 2));
      m.add(k, i * d2 + jTer, coeff1 * at(ljk, j, jTer - 1));
      m.add(k, i * d2 + jTer + 1, coeff1 * at(ljk, j, jTer));
      if (i > 0) {
        m.add(k, (i - 1) * d2 + jTer - 1, coeff2 * at(ljk, j, jTer - 2));
        m.add(k, (i - 1) * d2 + jTer, coeff2 * at(ljk, j, jTer - 1));
        m.add(k, (i - 1) * d2 + jTer + 1, coeff2 * at(ljk, j, jTer));
      }
      if (i < d1 - 1) {
        m.add(k, (i + 1) * d2 + jTer - 1, coeff3 * at(ljk, j, jTer - 2));
        m.add(k, (i + 1) * d2 + jTer, coeff3 * at(ljk, j, jTer - 1));
        m.add(k, (i + 1) * d2 + jTer + 1, coeff3 * at(ljk, j, jTer));
      }
    } else if (j === d2 - 1) {
      m.add(k, k, coeff1);
      m.add(k, i * d2 + jTer - 1, (-coeff1 / d2) * at(ljk, j - 1, jTer - 2));
      m.add(k, i * d2 + jTer, (-coeff1 / d2) * at(ljk, j - 1, jTer - 1));
      m.add(k, i * d2 + jTer + 1, (-coeff1 / d2) * at(ljk, j - 1, jTer));
      if (i > 0) {
        m.add(k, k - d2, coeff2);
        m.add(k, (i - 1) * d2 + jTer - 1, (-coeff2 / d2) * at(ljk, j - 1, jTer - 2));
        m.add(k, (i - 1) * d2 + jTer, (-coeff2 / d2) * at(ljk, j - 1, jTer - 1));
        m.add(k, (i - 1) * d2 + jTer + 1, (-coeff2 / d2) * at(ljk, j - 1, jTer));
      }
      if (i < d1 - 1) {
        m.add(k, k + d2, coeff3);
        m.add(k, (i + 1) * d2 + jTer - 1, (-coeff3 / d2) * at(ljk, j - 1, jTer - 2));
        m.add(k, (i + 1) * d2 + jTer, (-coeff3 / d2) * at(ljk, j - 1, jTer - 1));
        m.add(k, (i + 1) * d2 + jTer + 1, (-coeff3 / d2) * at(ljk, j - 1, jTer));
      }
    }
  }
  return cooToCsr(m);
}

/** Migration into population 2 (changes axis 2, jackknife on axis 1); ljk = calcJK13(d1 - 1). */
export function calcM_2(d1: number, d2: number, ljk: DenseMatrix): CSR {
  const d = d1 * d2;
  const m = new COO(d);
  for (let k = 0; k < d; k++) {
    const i = Math.floor(k / d2);
    const j = k % d2;
    const iTer = indexBis(i + 1, d1 - 1);
    const c = (i + 1) / d1;
    const coeff1 = (2 * j - (d2 - 1)) * c;
    const coeff2 = (d2 - j) * c;
    const coeff3 = -(j + 1) * c;
    m.add(k, k, -j);
    if (j < d2 - 1) m.add(k, k + 1, j + 1);
    if (i < d1 - 1) {
      m.add(k, (iTer - 1) * d2 + j, coeff1 * at(ljk, i, iTer - 2));
      m.add(k, iTer * d2 + j, coeff1 * at(ljk, i, iTer - 1));
      m.add(k, (iTer + 1) * d2 + j, coeff1 * at(ljk, i, iTer));
      if (j > 0) {
        m.add(k, (iTer - 1) * d2 + j - 1, coeff2 * at(ljk, i, iTer - 2));
        m.add(k, iTer * d2 + j - 1, coeff2 * at(ljk, i, iTer - 1));
        m.add(k, (iTer + 1) * d2 + j - 1, coeff2 * at(ljk, i, iTer));
      }
      if (j < d2 - 1) {
        m.add(k, (iTer - 1) * d2 + j + 1, coeff3 * at(ljk, i, iTer - 2));
        m.add(k, iTer * d2 + j + 1, coeff3 * at(ljk, i, iTer - 1));
        m.add(k, (iTer + 1) * d2 + j + 1, coeff3 * at(ljk, i, iTer));
      }
    } else if (i === d1 - 1) {
      m.add(k, k, coeff1);
      m.add(k, (iTer - 1) * d2 + j, (-coeff1 / d1) * at(ljk, i - 1, iTer - 2));
      m.add(k, iTer * d2 + j, (-coeff1 / d1) * at(ljk, i - 1, iTer - 1));
      m.add(k, (iTer + 1) * d2 + j, (-coeff1 / d1) * at(ljk, i - 1, iTer));
      if (j > 0) {
        m.add(k, k - 1, coeff2);
        m.add(k, (iTer - 1) * d2 + j - 1, (-coeff2 / d1) * at(ljk, i - 1, iTer - 2));
        m.add(k, iTer * d2 + j - 1, (-coeff2 / d1) * at(ljk, i - 1, iTer - 1));
        m.add(k, (iTer + 1) * d2 + j - 1, (-coeff2 / d1) * at(ljk, i - 1, iTer));
      }
      if (j < d2 - 1) {
        m.add(k, k + 1, coeff3);
        m.add(k, (iTer - 1) * d2 + j + 1, (-coeff3 / d1) * at(ljk, i - 1, iTer - 2));
        m.add(k, iTer * d2 + j + 1, (-coeff3 / d1) * at(ljk, i - 1, iTer - 1));
        m.add(k, (iTer + 1) * d2 + j + 1, (-coeff3 / d1) * at(ljk, i - 1, iTer));
      }
    }
  }
  return cooToCsr(m);
}
