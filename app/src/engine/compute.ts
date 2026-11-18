/**
 * Expected SFS of a model: run the compiled plan (equilibrium start, integration intervals,
 * split and pulse events), project to the requested sample sizes, then apply inbreeding and
 * ancestral misidentification. The output is the unfolded spectrum for theta = 1 (multiply by
 * theta = 4 N_ref mu L for counts). Corner entries (monomorphic) are kept but are meaningless.
 */

import { Model, Plan, compileModel, nuSpecOf, PlanOptions, PlanEvent } from "./model.ts";
import { integrate, steadyState1D, IntegrateStats } from "./integrate.ts";
import { NDArray, project, split1Dto2D, pulse2D, flipAncestralMisid, marginalize, merge2Dto1D } from "./ndarray.ts";
import { inbreed } from "./postprocess.ts";

export interface ComputeOptions extends PlanOptions {
  dtFac?: number; // default 0.02 (moments default); 0.1 for a fast draft
}

export interface ComputeResult {
  sfs: NDArray; // unfolded, theta = 1, after inbreeding and misidentification
  plan: Plan;
  stats: IntegrateStats & { ms: number };
}

/**
 * Defaults. Selection: integrate at n = max(n, 100) in 1D and max(n, 40) per population in 2D,
 * then project (measured against the exact equilibrium of the diffusion). Migration: integrate
 * each population at max(n, 20) (measured against msprime). See docs/VALIDATION.md.
 */
export const DEFAULT_OPTIONS: Required<ComputeOptions> = {
  dtFac: 0.02,
  selectionMinN1D: 100,
  selectionMinN2D: 40,
  selectionBoostAbove: 0,
  migrationMinN2D: 20,
};

function applyEvent(fs: NDArray, ev: PlanEvent, pops: string[]): NDArray {
  if (ev.kind === "split") return split1Dto2D(fs, ev.ns[0], ev.ns[1]);
  const s = pops.indexOf(ev.source);
  const d = pops.indexOf(ev.dest);
  return pulse2D(fs, s, d, ev.f);
}

export function computeSFS(model: Model, options: ComputeOptions = {}): ComputeResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const plan = compileModel(model, opts);
  const stats: IntegrateStats = { steps: 0, factorisations: 0 };
  const nInt = (p: number) => new Array(p).fill(0);
  let fs = steadyState1D(plan.rootN, plan.gamma, plan.h, 1.0);
  const pre = (plan as Plan & { preSplitEvents?: PlanEvent[] }).preSplitEvents ?? [];
  for (const ev of pre) fs = applyEvent(fs, ev, ["pop1", "pop2"]);
  for (const iv of plan.intervals) {
    const T = iv.start - iv.end;
    const p = iv.pops.length;
    if (T > 0) {
      fs = integrate(
        fs,
        nuSpecOf(iv),
        T,
        {
          dtFac: opts.dtFac,
          theta: 1.0,
          gamma: nInt(p).map(() => plan.gamma),
          h: nInt(p).map(() => plan.h),
          m: iv.mig,
        },
        stats,
      );
    }
    for (const ev of iv.eventsAfter) fs = applyEvent(fs, ev, iv.pops);
  }
  // project to the requested sample sizes
  if (plan.simN.some((n, k) => n !== plan.n[k])) fs = project(fs, plan.n);
  if (model.inbreeding.on) fs = inbreed(fs, model.mode === 1 ? [model.inbreeding.F[0]] : model.inbreeding.F);
  if (model.misid.on && model.misid.eps > 0) fs = flipAncestralMisid(fs, model.misid.eps);
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return { sfs: fs, plan, stats: { ...stats, ms: t1 - t0 } };
}

/** Views of a 2D result: the two marginal spectra and the pooled sample. */
export function views2D(sfs: NDArray): { marg1: NDArray; marg2: NDArray; pooled: NDArray } {
  return { marg1: marginalize(sfs, 1), marg2: marginalize(sfs, 0), pooled: merge2Dto1D(sfs) };
}
