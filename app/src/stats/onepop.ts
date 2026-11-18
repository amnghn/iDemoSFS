/**
 * One-population statistics from the SFS, written as weight vectors (Achaz 2009).
 *
 * Notation: n chromosomes; xi[i] (i = 0..n) is the unfolded SFS (counts of sites with i derived
 * copies; xi[0] and xi[n] are ignored); a_n = sum_{k=1}^{n-1} 1/k; b_n = sum_{k=1}^{n-1} 1/k^2.
 * All theta estimators are per dataset; divide by L for per-site values.
 *
 * Sources: Watterson (1975); Tajima (1983, 1989); Fu & Li (1993) with the corrected variances
 * of Simonsen et al. (1995) for F and F*; Fay & Wu (2000); Zeng et al. (2006).
 *
 * Folded input: a folded spectrum (moments/dadi convention, minor-allele counts in bins
 * 0..floor(n/2), zeros above) gives correct values for every estimator with symmetric weights
 * (S, theta_W, theta_pi, theta_eta) and for the tests built from them (Tajima's D, D*, F*).
 */

export const harmonic = (n: number, p = 1): number => {
  let s = 0;
  for (let k = 1; k < n; k++) s += 1 / k ** p;
  return s;
};

export type Estimator = "S" | "thetaW" | "thetaPi" | "thetaH" | "thetaL" | "thetaXi1" | "thetaEta";

/** Which estimators are defined on a folded spectrum. */
export const FOLDED_OK: Record<Estimator, boolean> = {
  S: true,
  thetaW: true,
  thetaPi: true,
  thetaH: false,
  thetaL: false,
  thetaXi1: false,
  thetaEta: true,
};

/** Weight vector (length n + 1; entries 0 and n are 0) of each estimator. */
export function weights1D(n: number): Record<Estimator, Float64Array> {
  const an = harmonic(n);
  const pairs = (n * (n - 1)) / 2;
  const w = (f: (i: number) => number) => {
    const v = new Float64Array(n + 1);
    for (let i = 1; i < n; i++) v[i] = f(i);
    return v;
  };
  return {
    S: w(() => 1),
    thetaW: w(() => 1 / an),
    thetaPi: w((i) => (i * (n - i)) / pairs),
    thetaH: w((i) => (i * i) / pairs),
    thetaL: w((i) => i / (n - 1)),
    thetaXi1: w((i) => (i === 1 ? 1 : 0)),
    thetaEta: w((i) => (i === 1 || i === n - 1 ? (n - 1) / n : 0)),
  };
}

export function dot(w: ArrayLike<number>, xi: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i] * xi[i];
  return s;
}

export interface OnePopStats {
  n: number;
  S: number;
  thetaW: number;
  thetaPi: number;
  thetaH: number;
  thetaL: number;
  thetaXi1: number; // derived singletons
  thetaEta: number; // folded singletons, scaled
  tajimaD: number;
  fuLiD: number; // with outgroup (derived singletons)
  fuLiF: number;
  fuLiDstar: number; // without outgroup (folded singletons)
  fuLiFstar: number;
  fayWuH: number; // raw: thetaPi - thetaH (Fay & Wu 2000)
  zengH: number; // normalised: (thetaPi - thetaL) / sd (Zeng et al. 2006)
  zengE: number; // (thetaL - thetaW) / sd
}

const ratio = (num: number, varr: number): number => (varr > 0 ? num / Math.sqrt(varr) : NaN);

/** All one-population statistics from an unfolded SFS (counts). */
export function onePopStats(xi: ArrayLike<number>): OnePopStats {
  const n = xi.length - 1;
  const W = weights1D(n);
  const S = dot(W.S, xi);
  const thetaW = dot(W.thetaW, xi);
  const thetaPi = dot(W.thetaPi, xi);
  const thetaH = dot(W.thetaH, xi);
  const thetaL = dot(W.thetaL, xi);
  const etaE = xi[1]; // external (derived) singletons
  const etaS = xi[1] + xi[n - 1]; // singletons without an outgroup
  const t = testsFromCounts(n, S, thetaPi, thetaL, etaE, etaS);
  return {
    n,
    S,
    thetaW,
    thetaPi,
    thetaH,
    thetaL,
    thetaXi1: etaE,
    thetaEta: ((n - 1) / n) * etaS,
    ...t,
    fayWuH: thetaPi - thetaH,
  };
}

/**
 * The neutrality tests from summary counts. Variances use theta_hat = S / a_n and
 * theta^2_hat = S (S - 1) / (a_n^2 + b_n) where needed.
 */
export function testsFromCounts(
  n: number,
  S: number,
  pi: number,
  thetaL: number,
  etaE: number,
  etaS: number,
): Omit<OnePopStats, "n" | "S" | "thetaW" | "thetaPi" | "thetaH" | "thetaL" | "thetaXi1" | "thetaEta" | "fayWuH"> {
  const an = harmonic(n); // sum_{1}^{n-1} 1/k
  const bn = harmonic(n, 2); // sum_{1}^{n-1} 1/k^2
  const an1 = an + 1 / n; // a_{n+1}
  const bn1 = bn + 1 / (n * n); // b_{n+1}
  const thetaW = S / an;
  const theta2 = (S * (S - 1)) / (an * an + bn);

  // Tajima (1989)
  const b1 = (n + 1) / (3 * (n - 1));
  const b2 = (2 * (n * n + n + 3)) / (9 * n * (n - 1));
  const c1 = b1 - 1 / an;
  const c2 = b2 - (n + 2) / (an * n) + bn / (an * an);
  const e1 = c1 / an;
  const e2 = c2 / (an * an + bn);
  const tajimaD = ratio(pi - thetaW, e1 * S + e2 * S * (S - 1));

  // Fu & Li (1993): D and F with an outgroup
  const cn = (2 * (n * an - 2 * (n - 1))) / ((n - 1) * (n - 2));
  const vD = 1 + ((an * an) / (bn + an * an)) * (cn - (n + 1) / (n - 1));
  const uD = an - 1 - vD;
  const fuLiD = ratio(S - an * etaE, uD * S + vD * S * S);
  // F: corrected variance of Simonsen et al. (1995)
  const vF = (cn + (2 * (n * n + n + 3)) / (9 * n * (n - 1)) - 2 / (n - 1)) / (an * an + bn);
  const uF = (1 + (n + 1) / (3 * (n - 1)) - ((4 * (n + 1)) / ((n - 1) * (n - 1))) * (an1 - (2 * n) / (n + 1))) / an - vF;
  const fuLiF = ratio(pi - etaE, uF * S + vF * S * S);

  // Fu & Li (1993): D* and F* without an outgroup
  const dn = cn + (n - 2) / ((n - 1) * (n - 1)) + (2 / (n - 1)) * (1.5 - (2 * an1 - 3) / (n - 2) - 1 / n);
  const nn = n / (n - 1);
  const vDs = (nn * nn * bn + an * an * dn - (2 * n * an * (an + 1)) / ((n - 1) * (n - 1))) / (an * an + bn);
  const uDs = nn * (an - nn) - vDs;
  const fuLiDstar = ratio(nn * S - an * etaS, uDs * S + vDs * S * S);
  // F*: corrected variance of Simonsen et al. (1995)
  const vFs =
    ((2 * n ** 3 + 110 * n * n - 255 * n + 153) / (9 * n * n * (n - 1)) + (2 * (n - 1) * an) / (n * n) - (8 * bn) / n) /
    (an * an + bn);
  const uFs = (4 * n * n + 19 * n + 3 - 12 * (n + 1) * an1) / (3 * n * (n - 1)) / an - vFs;
  const fuLiFstar = ratio(pi - ((n - 1) / n) * etaS, uFs * S + vFs * S * S);

  // Zeng et al. (2006): normalised H and E
  const varH =
    ((n - 2) / (6 * (n - 1))) * thetaW +
    ((18 * n * n * (3 * n + 2) * bn1 - (88 * n ** 3 + 9 * n * n - 13 * n + 6)) / (9 * n * (n - 1) * (n - 1))) * theta2;
  const zengH = ratio(pi - thetaL, varH);
  const varE =
    (n / (2 * (n - 1)) - 1 / an) * thetaW +
    (bn / (an * an) + 2 * nn * nn * bn - (2 * (n * bn - n + 1)) / ((n - 1) * an) - (3 * n + 1) / (n - 1)) * theta2;
  const zengE = ratio(thetaL - thetaW, varE);

  return { tajimaD, fuLiD, fuLiF, fuLiDstar, fuLiFstar, zengH, zengE };
}
