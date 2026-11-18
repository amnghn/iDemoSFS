/**
 * Independent check for selection: the exact equilibrium SFS of the diffusion.
 *
 * Genotype fitnesses 1, 1 + 2hs, 1 + 2s; gamma = 2 N s; time in 2N generations. Then the drift
 * coefficient is M(x) = 2 gamma x (1 - x) [h + (1 - 2h) x] and the variance V(x) = x (1 - x).
 * With G(x) = int_0^x 2M/V = 4 gamma [h x + (1 - 2h) x^2 / 2], the equilibrium density of
 * derived-allele frequencies under infinite sites is (Wright 1938; Sawyer & Hartl 1992 for h = 1/2)
 *
 *   phi(x) = theta / (x (1 - x)) * int_x^1 exp(G(x) - G(y)) dy / int_0^1 exp(-G(y)) dy,
 *
 * which gives theta / x without selection. The sample SFS is
 *   xi_i = C(n, i) int_0^1 x^i (1 - x)^(n - i) phi(x) dx,  i = 1..n-1,
 * computed here by Gauss-Legendre quadrature on many sub-intervals. This shares no code with the
 * moment equations; it tests the selection convention and measures the jackknife closure error.
 */

// 20-point Gauss-Legendre nodes and weights on [-1, 1]
const GL_X = [
  -0.9931285991850949, -0.9639719272779138, -0.9122344282513259, -0.8391169718222188, -0.7463319064601508,
  -0.636053680726515, -0.5108670019508271, -0.3737060887154195, -0.2277858511416451, -0.0765265211334973,
  0.0765265211334973, 0.2277858511416451, 0.3737060887154195, 0.5108670019508271, 0.636053680726515,
  0.7463319064601508, 0.8391169718222188, 0.9122344282513259, 0.9639719272779138, 0.9931285991850949,
];
const GL_W = [
  0.0176140071391521, 0.0406014298003869, 0.0626720483341091, 0.0832767415767048, 0.1019301198172404,
  0.1181945319615184, 0.1316886384491766, 0.1420961093183820, 0.1491729864726037, 0.1527533871307258,
  0.1527533871307258, 0.1491729864726037, 0.1420961093183820, 0.1316886384491766, 0.1181945319615184,
  0.1019301198172404, 0.0832767415767048, 0.0626720483341091, 0.0406014298003869, 0.0176140071391521,
];

function integrate(f: (x: number) => number, a: number, b: number, pieces: number): number {
  let s = 0;
  const h = (b - a) / pieces;
  for (let p = 0; p < pieces; p++) {
    const lo = a + p * h;
    for (let k = 0; k < 20; k++) s += GL_W[k] * f(lo + (h / 2) * (GL_X[k] + 1));
  }
  return (s * h) / 2;
}

/** Equilibrium sample SFS (entries 0..n, theta = 1) under selection gamma and dominance h. */
export function equilibriumSelectionSFS(n: number, gamma: number, h: number, pieces = 400): Float64Array {
  const G = (x: number) => 4 * gamma * (h * x + ((1 - 2 * h) * x * x) / 2);
  // R(x) = int_x^1 exp(G(x) - G(y)) dy, computed with a stable exponent difference
  const R = (x: number) => integrate((y) => Math.exp(G(x) - G(y)), x, 1, 40);
  const Z = integrate((y) => Math.exp(-G(y)), 0, 1, 400); // = R(0)
  // tabulate x^(i-1) (1-x)^(n-i-1) * R(x) / Z on the quadrature nodes, for all i at once
  const xi = new Float64Array(n + 1);
  const hstep = 1 / pieces;
  const lnC = (k: number) => {
    let s = 0;
    for (let j = 1; j <= k; j++) s += Math.log(n - k + j) - Math.log(j);
    return s;
  };
  for (let p = 0; p < pieces; p++) {
    const lo = p * hstep;
    for (let k = 0; k < 20; k++) {
      const x = lo + (hstep / 2) * (GL_X[k] + 1);
      const w = (GL_W[k] * hstep) / 2;
      const r = R(x) / Z;
      const lx = Math.log(x);
      const l1x = Math.log(1 - x);
      for (let i = 1; i < n; i++) xi[i] += w * r * Math.exp(lnC(i) + (i - 1) * lx + (n - i - 1) * l1x);
    }
  }
  return xi;
}
