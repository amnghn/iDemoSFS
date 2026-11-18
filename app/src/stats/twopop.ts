/**
 * Two-population statistics from the joint SFS xi[i][j] (i of n1 in pop 1, j of n2 in pop 2),
 * written as weight matrices (row-major, (n1+1) x (n2+1)). Corner entries (0,0) and (n1,n2)
 * are monomorphic and get weight 0.
 *
 * Sources: Nei & Li (1979) and Nei (1987) for d_xy and d_a; Hudson et al. (1992) and
 * Bhatia et al. (2013) for Hudson's F_ST (ratio of averages); Weir & Cockerham (1984) for theta;
 * Peter (2016) for f2; Wakeley & Hey (1997) for the site categories. tskit's `Fst` is
 * 1 - 2 (pi1 + pi2) / (pi1 + 2 dxy + pi2) and is reported separately (Ralph et al. 2020).
 */

export interface Joint {
  n1: number;
  n2: number;
  data: ArrayLike<number>; // row-major (n1+1) x (n2+1)
}

export type HetMode =
  | { kind: "hwe" } // h = 2p(1-p) * 2k/(2k-1): expected heterozygosity given the allele count (decision of 2026-11-18)
  | { kind: "hwe-plain" } // h = 2p(1-p) (the prompt's form; small bias, shown for comparison)
  | { kind: "fis"; F: [number, number] } // h = (1 - F_IS) * 2p(1-p) * 2k/(2k-1)
  | { kind: "haploid" }; // haploid or pooled data: k = n gene copies and no heterozygosity term (c = 0)

export function matrix(n1: number, n2: number, f: (i: number, j: number) => number): Float64Array {
  const w = new Float64Array((n1 + 1) * (n2 + 1));
  for (let i = 0; i <= n1; i++)
    for (let j = 0; j <= n2; j++) {
      if ((i === 0 && j === 0) || (i === n1 && j === n2)) continue;
      w[i * (n2 + 1) + j] = f(i, j);
    }
  return w;
}

export function wsum(w: ArrayLike<number>, x: ArrayLike<number>): number {
  let s = 0;
  for (let k = 0; k < w.length; k++) s += w[k] * x[k];
  return s;
}

/** Weight matrices of the linear statistics. */
export function weights2D(n1: number, n2: number) {
  const P1 = (n1 * (n1 - 1)) / 2;
  const P2 = (n2 * (n2 - 1)) / 2;
  const pi1 = matrix(n1, n2, (i) => (i * (n1 - i)) / P1);
  const pi2 = matrix(n1, n2, (_, j) => (j * (n2 - j)) / P2);
  const dxy = matrix(n1, n2, (i, j) => (i * (n2 - j) + j * (n1 - i)) / (n1 * n2));
  const hudsonNum = matrix(n1, n2, (i, j) => {
    const p1 = i / n1;
    const p2 = j / n2;
    return (p1 - p2) ** 2 - (p1 * (1 - p1)) / (n1 - 1) - (p2 * (1 - p2)) / (n2 - 1);
  });
  const fixed = matrix(n1, n2, (i, j) => ((i === n1 && j === 0) || (i === 0 && j === n2) ? 1 : 0));
  const shared = matrix(n1, n2, (i, j) => (i > 0 && i < n1 && j > 0 && j < n2 ? 1 : 0));
  const private1 = matrix(n1, n2, (i, j) => (i > 0 && i < n1 && (j === 0 || j === n2) ? 1 : 0));
  const private2 = matrix(n1, n2, (i, j) => (j > 0 && j < n2 && (i === 0 || i === n1) ? 1 : 0));
  const segregating = matrix(n1, n2, () => 1);
  return { pi1, pi2, dxy, hudsonNum, hudsonDen: dxy, fixed, shared, private1, private2, segregating };
}

/** Weir & Cockerham (1984) variance components a, b, c for two populations (r = 2). */
export function wcComponents(p1: number, p2: number, k1: number, k2: number, h1: number, h2: number): [number, number, number] {
  const r = 2;
  const nbar = (k1 + k2) / r;
  const nc = (r * nbar - (k1 * k1 + k2 * k2) / (r * nbar)) / (r - 1);
  const pbar = (k1 * p1 + k2 * p2) / (r * nbar);
  const s2 = (k1 * (p1 - pbar) ** 2 + k2 * (p2 - pbar) ** 2) / ((r - 1) * nbar);
  const hbar = (k1 * h1 + k2 * h2) / (r * nbar);
  const q = pbar * (1 - pbar);
  const a = (nbar / nc) * (s2 - (1 / (nbar - 1)) * (q - ((r - 1) / r) * s2 - hbar / 4));
  const b = (nbar / (nbar - 1)) * (q - ((r - 1) / r) * s2 - ((2 * nbar - 1) / (4 * nbar)) * hbar);
  const c = hbar / 2;
  return [a, b, c];
}

function hetFor(p: number, k: number, mode: HetMode, pop: 0 | 1): number {
  if (mode.kind === "haploid") return 0;
  const base = 2 * p * (1 - p);
  if (mode.kind === "hwe-plain") return base;
  const corr = base * ((2 * k) / (2 * k - 1));
  if (mode.kind === "hwe") return corr;
  return (1 - mode.F[pop]) * corr;
}

/**
 * WC weight matrices (a, b, c) for a sample of n1/2 and n2/2 diploid individuals. In haploid
 * mode the "individuals" are the n1 and n2 gene copies and c = 0; theta = a / (a + b) is then the
 * one-level analysis-of-variance estimator (MSP - MSG) / (MSP + (n_c - 1) MSG) (algebra in
 * docs/VALIDATION.md, Section 5).
 */
export function wcWeights(n1: number, n2: number, mode: HetMode) {
  const haploid = mode.kind === "haploid";
  if (!haploid && (n1 % 2 || n2 % 2)) throw new Error("Weir & Cockerham needs even (diploid) sample sizes");
  const k1 = haploid ? n1 : n1 / 2;
  const k2 = haploid ? n2 : n2 / 2;
  const A = new Float64Array((n1 + 1) * (n2 + 1));
  const B = new Float64Array(A.length);
  const C = new Float64Array(A.length);
  for (let i = 0; i <= n1; i++)
    for (let j = 0; j <= n2; j++) {
      if ((i === 0 && j === 0) || (i === n1 && j === n2)) continue;
      const p1 = i / n1;
      const p2 = j / n2;
      const [a, b, c] = wcComponents(p1, p2, k1, k2, hetFor(p1, k1, mode, 0), hetFor(p2, k2, mode, 1));
      const idx = i * (n2 + 1) + j;
      A[idx] = a;
      B[idx] = b;
      C[idx] = c;
    }
  return { A, B, C };
}

export interface TwoPopStats {
  n1: number;
  n2: number;
  pi1: number;
  pi2: number;
  dxy: number;
  da: number;
  fstHudson: number; // ratio of averages (Bhatia et al. 2013)
  fstTskit: number; // tskit definition, for comparison
  fstWC: number; // Weir & Cockerham theta
  fisWC: number;
  fitWC: number;
  f2: number; // per dataset; divide by L for per site
  fixed: number;
  shared: number;
  private1: number;
  private2: number;
  segregating: number;
  hetMode: HetMode;
}

export function twoPopStats(x: Joint, hetMode: HetMode = { kind: "hwe" }): TwoPopStats {
  const { n1, n2, data } = x;
  const W = weights2D(n1, n2);
  const pi1 = wsum(W.pi1, data);
  const pi2 = wsum(W.pi2, data);
  const dxy = wsum(W.dxy, data);
  const num = wsum(W.hudsonNum, data);
  let fstWC = NaN;
  let fisWC = NaN;
  let fitWC = NaN;
  if (hetMode.kind === "haploid" || (n1 % 2 === 0 && n2 % 2 === 0)) {
    const { A, B, C } = wcWeights(n1, n2, hetMode);
    const sa = wsum(A, data);
    const sb = wsum(B, data);
    const sc = wsum(C, data);
    fstWC = sa / (sa + sb + sc);
    if (hetMode.kind !== "haploid") {
      fisWC = 1 - sc / (sb + sc);
      fitWC = 1 - sc / (sa + sb + sc);
    }
  }
  return {
    n1,
    n2,
    pi1,
    pi2,
    dxy,
    da: dxy - (pi1 + pi2) / 2,
    fstHudson: num / dxy,
    fstTskit: 1 - (2 * (pi1 + pi2)) / (pi1 + 2 * dxy + pi2),
    fstWC,
    fisWC,
    fitWC,
    f2: num,
    fixed: wsum(W.fixed, data),
    shared: wsum(W.shared, data),
    private1: wsum(W.private1, data),
    private2: wsum(W.private2, data),
    segregating: wsum(W.segregating, data),
    hetMode,
  };
}

/**
 * Exact WC from per-site genotype counts (calculator mode, "HWE off, exact").
 * counts: per site [homRef1, het1, homAlt1, homRef2, het2, homAlt2]. Sums a, b, c over sites
 * (ratio of averages). Sites with missing genotypes are allowed (sample sizes per site).
 */
export function wcFromGenotypeCounts(counts: ArrayLike<number>[]): { fstWC: number; fisWC: number; fitWC: number; a: number; b: number; c: number } {
  let sa = 0;
  let sb = 0;
  let sc = 0;
  for (const s of counts) {
    const k1 = s[0] + s[1] + s[2];
    const k2 = s[3] + s[4] + s[5];
    if (k1 < 2 || k2 < 2) continue;
    const p1 = (s[1] + 2 * s[2]) / (2 * k1);
    const p2 = (s[4] + 2 * s[5]) / (2 * k2);
    if ((p1 === 0 && p2 === 0) || (p1 === 1 && p2 === 1)) continue;
    const [a, b, c] = wcComponents(p1, p2, k1, k2, s[1] / k1, s[4] / k2);
    sa += a;
    sb += b;
    sc += c;
  }
  return { fstWC: sa / (sa + sb + sc), fisWC: 1 - sc / (sb + sc), fitWC: 1 - sc / (sa + sb + sc), a: sa, b: sb, c: sc };
}
