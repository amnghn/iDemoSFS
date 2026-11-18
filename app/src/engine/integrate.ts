/**
 * Time integration of the moment equations for one or two populations.
 *
 * Port of moments 1.7.1:
 *   - `Integration_nomig.integrate_neutral` (per-axis Crank–Nicolson, tridiagonal solves),
 *   - `Integration_nomig.integrate_nomig`   (per-axis Crank–Nicolson with selection),
 *   - `Integration.integrate_nD`            (full Crank–Nicolson with migration),
 *   - `Integration.compute_dt`, `Numerics.compute_N_effective`,
 *   - `LinearSystem_1D.steady_state_1D`,
 *   - the dispatch of `Spectrum.integrate`.
 * Internal time is in units of N_ref generations (Tmax = 2 T), as in moments.
 */

import { calcJK13, calcJK23 } from "./jackknife.ts";
import {
  calcD,
  calcDDiags,
  calcS,
  calcS2,
  calcD1,
  calcD2,
  calcS_1,
  calcS_2,
  calcS2_1,
  calcS2_2,
  calcM_1,
  calcM_2,
} from "./operators.ts";
import {
  CSR,
  PatternSet,
  makePatternSet,
  combine,
  forwardStep,
  factorIdentityMinus,
  bandSolve,
  BandLU,
  tridiagFactor,
  tridiagSolve,
  Tridiag,
} from "./linalg.ts";
import { NDArray } from "./ndarray.ts";

/** Relative sizes: a constant list, or a function of time (in 2 N_ref generation units). */
export type NuSpec = number[] | ((t: number) => number[]);

export interface IntegrateOptions {
  dtFac?: number; // default 0.02 (moments Spectrum.integrate default)
  theta?: number; // default 1
  gamma?: number[]; // per population, default 0
  h?: number[]; // per population, default 0.5
  m?: number[][] | null; // migration matrix m[i][j] = into i from j (scaled 2 N_ref m); null = no migration
}

export interface IntegrateStats {
  steps: number;
  factorisations: number;
}

// ---------------------------------------------------------------- caches of operator matrices

const cache = new Map<string, unknown>();
function cached<T>(key: string, make: () => T): T {
  let v = cache.get(key) as T | undefined;
  if (v === undefined) {
    v = make();
    cache.set(key, v);
  }
  return v;
}

const jk13 = (n: number) => cached(`jk13:${n}`, () => calcJK13(n));
const jk23 = (n: number) => cached(`jk23:${n}`, () => calcJK23(n));

/** 1D pattern set: [D, S (h=0.5 part), S2 (h != 0.5 part)]. */
function patterns1D(d: number): PatternSet {
  return cached(`ps1:${d}`, () => makePatternSet([calcD(d), calcS(d, jk13(d - 1)), calcS2(d, jk23(d - 1))]));
}

/** 2D pattern set: [D1, D2, S_1, S_2, S2_1, S2_2, M_1, M_2]. */
function patterns2D(d1: number, d2: number): PatternSet {
  return cached(`ps2:${d1}x${d2}`, () => {
    const mats: CSR[] = [
      calcD1(d1, d2),
      calcD2(d1, d2),
      calcS_1(d1, d2, jk13(d1 - 1)),
      calcS_2(d1, d2, jk13(d2 - 1)),
      calcS2_1(d1, d2, jk23(d1 - 1)),
      calcS2_2(d1, d2, jk23(d2 - 1)),
      calcM_1(d1, d2, jk13(d2 - 1)),
      calcM_2(d1, d2, jk13(d1 - 1)),
    ];
    return makePatternSet(mats);
  });
}

// ---------------------------------------------------------------- time step helpers

/** moments `_compute_dt_1pop`. */
function computeDt1Pop(N: number, mRow: number[], s: number, h: number, timescaleFactor = 0.1): number {
  const maxVM = Math.max(
    0.25 / N,
    Math.max(...mRow),
    Math.abs(s) *
      2 *
      Math.max(Math.abs(h + (1 - 2 * h) * 0.5) * 0.5 * (1 - 0.5), Math.abs(h + (1 - 2 * h) * 0.25) * 0.25 * (1 - 0.25)),
  );
  const dt = maxVM > 0 ? timescaleFactor / maxVM : Infinity;
  if (dt === 0) throw new Error("time step is zero");
  return dt;
}

/** moments `Integration.compute_dt`. */
export function computeDt(N: number[], m?: number[][] | null, s?: number[], h?: number[]): number {
  const p = N.length;
  const mm = m ?? Array.from({ length: p }, () => new Array(p).fill(0));
  const ss = s ?? new Array(p).fill(0);
  const hh = h ?? new Array(p).fill(0.5);
  let dt = Infinity;
  for (let i = 0; i < p; i++) dt = Math.min(dt, computeDt1Pop(N[i], mm[i], ss[i], hh[i]));
  return dt;
}

/** moments `Numerics.compute_N_effective`: harmonic mean over [t0, t1] by a 10-point trapezoid. */
export function computeNEffective(f: (t: number) => number[], t0: number, t1: number): number[] {
  const nbPts = 10;
  const step = (t1 - t0) / nbPts;
  const values: number[][] = [];
  for (let i = 0; i <= nbPts; i++) values.push(f(t0 + i * step).map((x) => 1 / x));
  const p = values[0].length;
  const res = new Array(p).fill(0);
  for (let i = 0; i < nbPts; i++) for (let k = 0; k < p; k++) res[k] += 0.5 * (values[i][k] + values[i + 1][k]) * step;
  return res.map((r) => (t1 - t0) / r);
}

function anyDiff(a: number[], b: number[]): boolean {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return true;
  return false;
}

/**
 * Shared time-stepping logic of the three moments integrators: returns, for each step, the
 * step length, the size at the end of the step (N) and the effective size (Neff), and whether
 * the matrices must be rebuilt. `dtBase(N)` gives the stability-limited step.
 */
interface Step {
  dt: number;
  N: number[];
  Neff: number[];
  rebuild: boolean;
}

function* timeSteps(nu: NuSpec, Tmax: number, dtFac: number, dtBase: (N: number[]) => number): Generator<Step> {
  const callable = typeof nu === "function";
  let N = callable ? (nu as (t: number) => number[])(0) : [...(nu as number[])];
  if (N.some((x) => !(x > 0))) throw new Error("All population sizes must be positive");
  let Nold = [...N];
  let Neff = [...N];
  let t = 0;
  let dt = Tmax * dtFac;
  while (t < Tmax) {
    const dtOld = dt;
    dt = Math.min(dtBase(N), Tmax * dtFac);
    if (t + dt > Tmax) dt = Tmax - t;
    if (callable) {
      const f = nu as (t: number) => number[];
      N = f((t + dt) / 2);
      if (N.some((x) => !(x > 0))) throw new Error("All population sizes must be positive");
      Neff = computeNEffective(f, 0.5 * t, 0.5 * (t + dt));
      let nIter = 0;
      const relChange = () => Math.max(...N.map((x, k) => Math.abs(x - Nold[k]) / Nold[k]));
      while (relChange() > 0.5) {
        dt /= 2;
        N = f((t + dt) / 2);
        if (N.some((x) => !(x > 0))) throw new Error("All population sizes must be positive");
        Neff = computeNEffective(f, 0.5 * t, 0.5 * (t + dt));
        nIter++;
        if (nIter >= 10) break; // moments prints a warning and continues
      }
    }
    const rebuild = t === 0 || anyDiff(Nold, N) || dt !== dtOld;
    yield { dt, N: [...N], Neff: [...Neff], rebuild };
    Nold = N;
    t += dt;
  }
}

// ---------------------------------------------------------------- 1D / 2D without migration, neutral

function integrateNeutral(sfs: NDArray, nu: NuSpec, tf: number, dtFac: number, theta: number, st: IntegrateStats): NDArray {
  const dims = sfs.shape;
  const p = dims.length;
  const Tmax = tf * 2.0;
  const u = new Array(p).fill(theta / 4.0);
  const diags = dims.map((d) => cached(`dd:${d}`, () => calcDDiags(d)));
  let tri: Tridiag[] = [];
  let Q: Float64Array[] = []; // dense, row-major d x d
  let x: Float64Array = new Float64Array(sfs.data);
  for (const step of timeSteps(nu, Tmax, dtFac, (N) => computeDt(N))) {
    const { dt, Neff } = step;
    if (step.rebuild) {
      st.factorisations++;
      tri = dims.map((d, i) => {
        const c0 = ((-0.5 * dt) / 4 / Neff[i]);
        const a = new Float64Array(d - 1);
        const dd = new Float64Array(d);
        const c = new Float64Array(d - 1);
        for (let k = 0; k < d - 1; k++) {
          a[k] = c0 * diags[i].a[k];
          c[k] = c0 * diags[i].c[k];
        }
        for (let k = 0; k < d; k++) dd[k] = 1 - ((0.5 * dt) / 4 / Neff[i]) * diags[i].d[k];
        const t: Tridiag = { a, d: dd, c };
        tridiagFactor(t);
        return t;
      });
      Q = dims.map((d, i) => {
        const q = new Float64Array(d * d);
        const cD = 1.0 / 4 / Neff[i];
        const dg = diags[i];
        for (let r = 0; r < d; r++) {
          q[r * d + r] = 1 + 0.5 * dt * (cD * dg.d[r]);
          if (r > 0) q[r * d + r - 1] = 0.5 * dt * (cD * dg.a[r - 1]);
          if (r < d - 1) q[r * d + r + 1] = 0.5 * dt * (cD * dg.c[r]);
        }
        return q;
      });
    }
    st.steps++;
    if (p === 1) {
      const d = dims[0];
      const y = matVecDense(Q[0], x, d);
      y[1] += dt * ((d - 1) * u[0]);
      x = tridiagSolve(tri[0], y);
    } else {
      x = applyAxis2D(x, dims, 0, (v) => matVecDense(Q[0], v, dims[0]));
      x = applyAxis2D(x, dims, 1, (v) => matVecDense(Q[1], v, dims[1]));
      x[1 * dims[1] + 0] += dt * ((dims[0] - 1) * u[0]);
      x[0 * dims[1] + 1] += dt * ((dims[1] - 1) * u[1]);
      x = applyAxis2D(x, dims, 0, (v) => tridiagSolve(tri[0], v));
      x = applyAxis2D(x, dims, 1, (v) => tridiagSolve(tri[1], v));
    }
  }
  return { shape: [...dims], data: x };
}

function matVecDense(q: Float64Array, v: ArrayLike<number>, d: number): Float64Array {
  const y = new Float64Array(d);
  for (let r = 0; r < d; r++) {
    let s = 0;
    const lo = Math.max(0, r - 1);
    const hi = Math.min(d - 1, r + 1);
    for (let c = lo; c <= hi; c++) s += q[r * d + c] * v[c];
    y[r] = s;
  }
  return y;
}

/** Apply a vector map along one axis of a 2D row-major array. */
function applyAxis2D(x: Float64Array, dims: number[], axis: number, f: (v: Float64Array) => Float64Array): Float64Array {
  const [d1, d2] = dims;
  const out = new Float64Array(x.length);
  if (axis === 0) {
    const col = new Float64Array(d1);
    for (let j = 0; j < d2; j++) {
      for (let i = 0; i < d1; i++) col[i] = x[i * d2 + j];
      const r = f(col);
      for (let i = 0; i < d1; i++) out[i * d2 + j] = r[i];
    }
  } else {
    const row = new Float64Array(d2);
    for (let i = 0; i < d1; i++) {
      for (let j = 0; j < d2; j++) row[j] = x[i * d2 + j];
      const r = f(row);
      for (let j = 0; j < d2; j++) out[i * d2 + j] = r[j];
    }
  }
  return out;
}

// ---------------------------------------------------------------- 1D / 2D without migration, with selection

function integrateNomig(
  sfs: NDArray,
  nu: NuSpec,
  tf: number,
  dtFac: number,
  theta: number,
  gamma: number[],
  h: number[],
  st: IntegrateStats,
): NDArray {
  const dims = sfs.shape;
  const p = dims.length;
  const Tmax = tf * 2.0;
  const u = new Array(p).fill(theta / 4.0);
  const ps = dims.map((d) => patterns1D(d));
  let A: Float64Array[] = [];
  let LU: BandLU[] = [];
  let x: Float64Array = new Float64Array(sfs.data);
  for (const step of timeSteps(nu, Tmax, dtFac, (N) => computeDt(N, null, gamma, h))) {
    const { dt, Neff } = step;
    if (step.rebuild) {
      st.factorisations++;
      A = dims.map((_, i) => combine(ps[i], [(1.0 / 4 / Neff[i]), gamma[i] * h[i], gamma[i] * (1 - 2.0 * h[i])]));
      LU = dims.map((_, i) => factorIdentityMinus(ps[i], A[i], dt / 2.0));
    }
    st.steps++;
    if (p === 1) {
      const d = dims[0];
      const y = forwardStep(ps[0], A[0], dt / 2.0, x);
      y[1] += dt * ((d - 1) * u[0]);
      x = bandSolve(LU[0], y);
    } else {
      x = applyAxis2D(x, dims, 0, (v) => forwardStep(ps[0], A[0], dt / 2.0, v));
      x = applyAxis2D(x, dims, 1, (v) => forwardStep(ps[1], A[1], dt / 2.0, v));
      x[1 * dims[1] + 0] += dt * ((dims[0] - 1) * u[0]);
      x[0 * dims[1] + 1] += dt * ((dims[1] - 1) * u[1]);
      x = applyAxis2D(x, dims, 0, (v) => bandSolve(LU[0], new Float64Array(v)));
      x = applyAxis2D(x, dims, 1, (v) => bandSolve(LU[1], new Float64Array(v)));
    }
  }
  return { shape: [...dims], data: x };
}

// ---------------------------------------------------------------- 2D with migration

function integrateND(
  sfs: NDArray,
  nu: NuSpec,
  tf: number,
  dtFac: number,
  theta: number,
  gamma: number[],
  h: number[],
  m: number[][],
  st: IntegrateStats,
): NDArray {
  const dims = sfs.shape;
  if (dims.length !== 2) throw new Error("integrateND is implemented for two populations");
  const [d1, d2] = dims;
  const Tmax = tf * 2.0;
  const u = [theta / 4.0, theta / 4.0];
  const mig = m.map((row) => row.map((v) => v / 2.0));
  if (mig.some((row) => row.some((v) => v < 0))) throw new Error("Migration rate is below zero");
  const ps = patterns2D(d1, d2);
  let A: Float64Array = new Float64Array(0);
  let LU: BandLU | null = null;
  let x: Float64Array = new Float64Array(sfs.data);
  for (const step of timeSteps(nu, Tmax, dtFac, (N) => computeDt(N, mig, gamma, h))) {
    const { dt, Neff } = step;
    if (step.rebuild) {
      st.factorisations++;
      // (1/(max(p,2)-1)) * (D + S1 + S2) + Mi, with p = 2
      A = combine(ps, [
        1.0 / (4 * Neff[0]),
        1.0 / (4 * Neff[1]),
        gamma[0] * h[0],
        gamma[1] * h[1],
        gamma[0] * (1 - 2.0 * h[0]),
        gamma[1] * (1 - 2.0 * h[1]),
        mig[0][1],
        mig[1][0],
      ]);
      LU = factorIdentityMinus(ps, A, dt / 2.0 / 1.0);
    }
    st.steps++;
    const y = forwardStep(ps, A, dt / 2.0 / 1.0, x);
    y[1 * d2 + 0] += (dt / 1.0) * ((d1 - 1) * u[0]);
    y[0 * d2 + 1] += (dt / 1.0) * ((d2 - 1) * u[1]);
    x = bandSolve(LU!, y);
  }
  return { shape: [...dims], data: x };
}

// ---------------------------------------------------------------- public API

/**
 * Integrate a spectrum forward in time (moments `Spectrum.integrate` dispatch):
 * - 1D: neutral -> tridiagonal integrator; selection -> per-axis sparse integrator;
 * - 2D without migration (m = null): the same two, per axis;
 * - 2D with a migration matrix (even all zero): the full 2D integrator.
 */
export function integrate(sfs: NDArray, nu: NuSpec, tf: number, opts: IntegrateOptions = {}, stats?: IntegrateStats): NDArray {
  if (tf < 0) throw new Error("Integration time should be positive.");
  const st = stats ?? { steps: 0, factorisations: 0 };
  if (tf === 0) return { shape: [...sfs.shape], data: new Float64Array(sfs.data) };
  const p = sfs.shape.length;
  const dtFac = opts.dtFac ?? 0.02;
  const theta = opts.theta ?? 1.0;
  const gamma = opts.gamma ?? new Array(p).fill(0);
  const h = opts.h ?? new Array(p).fill(0.5);
  const neutral = gamma.every((g) => g === 0);
  if (p === 1 || opts.m == null) {
    if (neutral) return integrateNeutral(sfs, nu, tf, dtFac, theta, st);
    return integrateNomig(sfs, nu, tf, dtFac, theta, gamma, h, st);
  }
  return integrateND(sfs, nu, tf, dtFac, theta, gamma, h, opts.m, st);
}

/** Equilibrium 1D spectrum (moments `LinearSystem_1D.steady_state_1D`), scaled by theta. */
export function steadyState1D(n: number, gamma = 0, h = 0.5, theta = 1.0): NDArray {
  const d = n + 1;
  const u = theta / 4.0;
  const ps = patterns1D(d);
  // Mat = D/(4N) + gamma*h*S + gamma*(1-2h)*S2, with N = 1
  const vals = combine(ps, [1 / 4.0 / 1.0, gamma * h, gamma * (1 - 2.0 * h)]);
  // dense interior system Mat[1:d-1, 1:d-1] x = -B[1:d-1]
  const m = d - 2;
  const M = new Float64Array(m * m);
  for (let r = 1; r < d - 1; r++)
    for (let k = ps.rowPtr[r]; k < ps.rowPtr[r + 1]; k++) {
      const c = ps.colIdx[k];
      if (c >= 1 && c < d - 1) M[(r - 1) * m + (c - 1)] += vals[k];
    }
  const b = new Float64Array(m);
  b[0] = -(n * u); // B[1] = n * u
  const x = denseSolve(M, b, m);
  const out = new Float64Array(d);
  for (let k = 0; k < m; k++) out[k + 1] = x[k];
  return { shape: [d], data: out };
}

/** Gaussian elimination with partial pivoting (small dense systems). */
export function denseSolve(Ain: Float64Array, bin: Float64Array, n: number): Float64Array {
  const A = new Float64Array(Ain);
  const b = new Float64Array(bin);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(A[i * n + k]) > Math.abs(A[p * n + k])) p = i;
    if (A[p * n + k] === 0) throw new Error("singular matrix");
    if (p !== k) {
      for (let j = 0; j < n; j++) {
        const t = A[k * n + j];
        A[k * n + j] = A[p * n + j];
        A[p * n + j] = t;
      }
      const t = b[k];
      b[k] = b[p];
      b[p] = t;
    }
    for (let i = k + 1; i < n; i++) {
      const f = A[i * n + k] / A[k * n + k];
      if (f === 0) continue;
      for (let j = k; j < n; j++) A[i * n + j] -= f * A[k * n + j];
      b[i] -= f * b[k];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i * n + j] * x[j];
    x[i] = s / A[i * n + i];
  }
  return x;
}
