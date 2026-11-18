/**
 * Model–data comparison, ported from moments 1.7.1 `moments.Inference` (the same functions
 * exist in dadi.Inference): optimal scaling, Poisson and Anscombe residuals.
 *
 * Arrays are flat and row-major; `mask` marks entries that are excluded (1 = masked), for
 * example the corners and, for folded data, the folded-out half. As in moments, a folded data
 * set is compared with the folded model.
 */

/** data.sum() / model.sum() over entries masked in neither (`optimal_sfs_scaling`). */
export function optimalScaling(model: ArrayLike<number>, data: ArrayLike<number>, mask: Uint8Array): number {
  let sm = 0;
  let sd = 0;
  for (let k = 0; k < model.length; k++) {
    if (mask[k]) continue;
    sm += model[k];
    sd += data[k];
  }
  return sd / sm;
}

/**
 * Poisson residuals (model - data) / sqrt(model) (`linear_Poisson_residual`). Entries where both
 * model and data are <= `maskLevel` are NaN (masked), as with moments' `mask` argument.
 */
export function poissonResidual(model: ArrayLike<number>, data: ArrayLike<number>, mask: Uint8Array, maskLevel: number | null = null): Float64Array {
  const out = new Float64Array(model.length);
  for (let k = 0; k < model.length; k++) {
    if (mask[k] || model[k] <= 0) out[k] = NaN;
    else out[k] = (model[k] - data[k]) / Math.sqrt(model[k]);
    if (maskLevel !== null && model[k] <= maskLevel && data[k] <= maskLevel) out[k] = NaN;
  }
  return out;
}

/**
 * Anscombe residuals (`Anscombe_Poisson_residual`), with moments' sign convention (positive when
 * the model is higher than the data). With `maskLevel`, entries where both model and data are at
 * or below it, and entries with data = 0, are NaN.
 */
export function anscombeResidual(model: ArrayLike<number>, data: ArrayLike<number>, mask: Uint8Array, maskLevel: number | null = null): Float64Array {
  const out = new Float64Array(model.length);
  const tr = (x: number): number => x ** (2 / 3) - x ** (-1 / 3) / 9;
  for (let k = 0; k < model.length; k++) {
    const m = model[k];
    const d = data[k];
    if (mask[k] || m <= 0) {
      out[k] = NaN;
      continue;
    }
    // numpy.ma.power(0, -1/3) is masked in moments, which masks the residual where data = 0
    if (d <= 0) {
      out[k] = NaN;
      continue;
    }
    out[k] = -(1.5 * (tr(d) - tr(m))) / m ** (1 / 6);
    if (maskLevel !== null && m <= maskLevel && d <= maskLevel) out[k] = NaN;
  }
  return out;
}

/** Log-likelihood of the data under a Poisson model with optimal scaling (moments `ll_multinom`). */
export function llMultinom(model: ArrayLike<number>, data: ArrayLike<number>, mask: Uint8Array): number {
  const c = optimalScaling(model, data, mask);
  let ll = 0;
  for (let k = 0; k < model.length; k++) {
    if (mask[k]) continue;
    const m = c * model[k];
    const d = data[k];
    if (m <= 0) continue;
    ll += -m + d * Math.log(m) - lgamma(d + 1);
  }
  return ll;
}

/** log Gamma(x) for x > 0 (Lanczos approximation, g = 7). */
export function lgamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
