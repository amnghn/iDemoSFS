/**
 * Independent check for neutral one-population models: the expected SFS from the coalescent.
 *
 * For any (time-inhomogeneous) Kingman coalescent, the tree topology is independent of the
 * coalescence times, so (Fu 1995; Griffiths & Tavaré 1998; Polanski & Kimmel 2003)
 *
 *   E[xi_i] = (theta / 2) * sum_{k=2}^{n-i+1} k E[T_k] C(n-i-1, k-2) / C(n-1, k-1),
 *
 * where T_k is the time (in 2 N_ref generations) during which the sample has k ancestral
 * lineages. E[T_k] = integral of P(K(t) = k) dt, with K the number of lineages backwards in
 * time; K is a pure-death process with rate C(k,2)/nu(t). This module integrates P(K(t) = k)
 * through the epochs with the classical Runge-Kutta method (small steps), and treats the
 * infinite ancestral epoch (nu = 1) exactly: from k' lineages, the chain visits every k <= k'
 * once and stays 1 / C(k,2) on average.
 *
 * This code shares nothing with the moment equations, so it is an independent oracle.
 */

import { Model } from "./model.ts";

function lnC(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  let s = 0;
  for (let j = 1; j <= k; j++) s += Math.log(n - k + j) - Math.log(j);
  return s;
}

/** Size function of an epoch in forward time s in [0, T]. */
function epochSize(dyn: string, start: number, end: number, T: number): (s: number) => number {
  if (dyn === "sudden") return () => end;
  if (dyn === "linear") return (s) => start + (s / T) * (end - start);
  return (s) => start * Math.exp((Math.log(end / start) * s) / T);
}

/** Expected SFS (theta = 1, entries 0..n) of a neutral one-population model. */
export function coalescentSFS(model: Model, stepScale = 0.02): Float64Array {
  if (model.mode !== 1) throw new Error("coalescentSFS: one population only");
  const n = model.n[0];
  // epochs past -> present with their size functions
  const eps: { T: number; f: (s: number) => number; min: number }[] = [];
  let prev = 1;
  for (const e of model.ancestral) {
    if (e.T > 0) {
      const f = epochSize(e.dyn, prev, e.nu, e.T);
      eps.push({ T: e.T, f, min: Math.min(e.dyn === "sudden" ? e.nu : Math.min(prev, e.nu)) });
    }
    prev = e.nu;
  }
  const rate = (k: number) => (k * (k - 1)) / 2;
  // state: p[k] for k = 1..n, ET[k] accumulated
  let p = new Float64Array(n + 1);
  p[n] = 1;
  const ET = new Float64Array(n + 1);
  const deriv = (pp: Float64Array, nu: number): Float64Array => {
    const d = new Float64Array(n + 1);
    for (let k = 2; k <= n; k++) {
      d[k] -= (rate(k) / nu) * pp[k];
      d[k - 1] += (rate(k) / nu) * pp[k];
    }
    return d;
  };
  // backwards in time: most recent epoch first
  for (let e = eps.length - 1; e >= 0; e--) {
    const { T, f, min } = eps[e];
    const steps = Math.max(200, Math.ceil((T * rate(n)) / min / stepScale));
    const h = T / steps;
    const nuAt = (tau: number) => f(T - tau); // backward time tau
    for (let s = 0; s < steps; s++) {
      const tau = s * h;
      const nu1 = nuAt(tau);
      const nu2 = nuAt(tau + h / 2);
      const nu3 = nuAt(tau + h);
      const k1 = deriv(p, nu1);
      const p2 = p.map((v, k) => v + (h / 2) * k1[k]);
      const k2 = deriv(p2, nu2);
      const p3 = p.map((v, k) => v + (h / 2) * k2[k]);
      const k3 = deriv(p3, nu2);
      const p4 = p.map((v, k) => v + h * k3[k]);
      const k4 = deriv(p4, nu3);
      // integral of p over the step (Simpson, consistent with RK4)
      for (let k = 2; k <= n; k++) ET[k] += (h / 6) * (p[k] + 2 * p2[k] + 2 * p3[k] + p4[k]);
      p = p.map((v, k) => v + (h / 6) * (k1[k] + 2 * k2[k] + 2 * k3[k] + k4[k]));
    }
  }
  // infinite ancestral epoch at nu = 1: P(K >= k) / C(k,2)
  let tail = 0;
  for (let k = n; k >= 2; k--) {
    tail += p[k];
    ET[k] += tail / rate(k);
  }
  const xi = new Float64Array(n + 1);
  for (let i = 1; i < n; i++) {
    let s = 0;
    for (let k = 2; k <= n - i + 1; k++) s += k * ET[k] * Math.exp(lnC(n - i - 1, k - 2) - lnC(n - 1, k - 1));
    xi[i] = 0.5 * s;
  }
  return xi;
}
