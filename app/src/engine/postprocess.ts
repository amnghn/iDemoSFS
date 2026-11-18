/**
 * Post-processing of the expected sample spectrum.
 *
 * Inbreeding (diploids; Blischak et al. 2020): each sampled individual is autozygous with
 * probability F (its two copies are one draw from the population); otherwise it carries two
 * independent draws. Given k individuals of which a are autozygous, the sample consists of
 * m = 2k - a independent draws, a of which are counted twice. The expected inbred spectrum is
 * therefore an exact mixture over a ~ Binomial(k, F) of the outbred spectrum projected to m,
 * with a hypergeometric choice of which draws are doubled. This is the genotype model of
 * dadi's `Spectrum.from_phi_inbreeding` (beta-binomial with alpha = x(1-F)/F per individual).
 * It changes the sampling step only; the population-level frequency distribution is unchanged.
 */

import { NDArray, zeros, strides, projectAxis, lnComb } from "./ndarray.ts";

/** Apply the inbreeding sampling transform along one axis (sample size must be even). */
export function inbreedAxis(a: NDArray, axis: number, F: number): NDArray {
  const n = a.shape[axis] - 1;
  if (n % 2 !== 0) throw new Error("inbreeding needs an even (diploid) sample size");
  if (F === 0) return { shape: [...a.shape], data: new Float64Array(a.data) };
  const k = n / 2;
  const out = zeros(a.shape);
  const outSt = strides(a.shape);
  const outer = a.shape.slice(0, axis).reduce((x, y) => x * y, 1);
  const inner = outSt[axis];
  for (let az = 0; az <= k; az++) {
    const lw = lnComb(k, az) + (az > 0 ? az * Math.log(F) : 0) + (k - az > 0 ? (k - az) * Math.log(1 - F) : 0);
    const w = F === 1 ? (az === k ? 1 : 0) : Math.exp(lw);
    if (w === 0) continue;
    const m = 2 * k - az;
    const proj = projectAxis(a, axis, m);
    const pSt = strides(proj.shape);
    for (let j = 0; j <= m; j++) {
      const lo = Math.max(0, j - (m - az));
      const hi = Math.min(az, j);
      for (let l = lo; l <= hi; l++) {
        const p = Math.exp(lnComb(az, l) + lnComb(m - az, j - l) - lnComb(m, j));
        const i = j + l;
        const c = w * p;
        for (let o = 0; o < outer; o++)
          for (let r = 0; r < inner; r++)
            out.data[o * inner * (n + 1) + i * inner + r] += c * proj.data[o * pSt[axis] * (m + 1) + j * inner + r];
      }
    }
  }
  return out;
}

/** Inbreeding in every population (F per axis). */
export function inbreed(a: NDArray, F: number[]): NDArray {
  let out = a;
  F.forEach((f, axis) => {
    out = inbreedAxis(out, axis, f);
  });
  return out;
}
