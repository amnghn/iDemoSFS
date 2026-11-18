/**
 * Parameter limits of the app (decisions of 2026-11-18, STOP 1 and STOP 2; see docs/PROMPT.md).
 * The same numbers drive the sliders and the model check, so the UI cannot produce a model
 * that the engine rejects.
 */

import type { Model } from "./model.ts";

export const LIMITS = {
  nu: { min: 0.01, max: 100 }, // relative size nu = N / N_ref
  T: { min: 0.001, max: 10 }, // epoch duration (2 N_ref generations); ancestral epochs may be 0 (skipped)
  n1D: { min: 2, max: 100 }, // haploid sample size, one population
  n2D: { min: 2, max: 40 }, // haploid sample size per population, two populations
  M: { min: 0, max: 50 }, // scaled migration rate 2 N_ref m
  gamma1D: 50, // |gamma| limit, one population
  gamma2D: 20, // |gamma| limit, two populations
  gammaWarn2D: 10, // warning above this |gamma| in two populations
  gammaWarn1DStrongDominant: 30, // warning for gamma > 30 with h > 0.5 in one population
  F: { min: 0, max: 1 },
  eps: { min: 0, max: 0.5 },
  f: { min: 0, max: 1 }, // admixture proportion
} as const;

/** Hard errors for values outside the limits (used by validateModel). */
export function limitErrors(m: Model): string[] {
  const errs: string[] = [];
  const nus: number[] = m.ancestral.map((e) => e.nu);
  if (m.mode === 2) {
    for (const e of m.post) nus.push(e.nu[0], e.nu[1]);
    if (!m.split.useFraction) nus.push(m.split.nu1, m.split.nu2);
  }
  // a small tolerance, so that values typed with rounding (for example 0.0099999) are accepted
  if (nus.some((x) => x < LIMITS.nu.min * (1 - 1e-9) || x > LIMITS.nu.max * (1 + 1e-9)))
    errs.push(`relative sizes must be between ${LIMITS.nu.min} and ${LIMITS.nu.max}`);
  if (m.selection.on) {
    const g = m.mode === 1 ? LIMITS.gamma1D : LIMITS.gamma2D;
    if (!(Math.abs(m.selection.gamma) <= g)) errs.push(`|gamma| must be at most ${g} in ${m.mode === 1 ? "one" : "two"}-population mode`);
    if (!(m.selection.h >= 0 && m.selection.h <= 1)) errs.push("the dominance coefficient h must be between 0 and 1");
  }
  return errs;
}

/** Warnings (the model runs, but the result is less accurate). Plain-language text for the UI. */
export function modelWarnings(m: Model): string[] {
  const w: string[] = [];
  if (m.selection.on) {
    const g = m.selection.gamma;
    if (m.mode === 2 && Math.abs(g) > LIMITS.gammaWarn2D)
      w.push(
        `Strong selection in two populations (|γ| > ${LIMITS.gammaWarn2D}): the expected spectrum has an error of about 1–3 % in the main bins (see the validation report).`,
      );
    if (m.mode === 1 && g > LIMITS.gammaWarn1DStrongDominant && m.selection.h > 0.5)
      w.push(
        `Strong positive selection on a dominant allele (γ > ${LIMITS.gammaWarn1DStrongDominant}, h > 0.5): the closure error of the method grows; treat small bins with care.`,
      );
  }
  if (m.mode === 2 && m.migration) {
    const active = m.post.flatMap((e) => [...(e.mig12On ? [e.m12] : []), ...(e.mig21On ? [e.m21] : [])]);
    if (active.length > 0 && active.every((x) => x === 0))
      w.push("Migration is switched on with all rates at 0. The result can differ from 'migration off' by the small time-step error of the method.");
  }
  return w;
}
