/**
 * Demographic model of the app ("model with structure", after GADMA; Noskova et al. 2020, 2023)
 * and its compilation into integration intervals and events.
 *
 * Units (dadi/moments convention): nu = N / N_ref; times in 2 N_ref generations;
 * M = 2 N_ref m (m[i][j] = into population i from population j, forward in time);
 * gamma = 2 N_ref s. Sizes refer to the END of an epoch (GADMA convention).
 *
 * The interval logic mirrors `moments.Demes` (`_get_demographic_events`,
 * `_get_integration_parameters`, `_get_deme_sample_sizes`, `_compute_sfs`), so that the model
 * exported as Demes YAML and run with `moments.Spectrum.from_demes` follows the same steps.
 */

import { NuSpec } from "./integrate.ts";

export type Dynamics = "sudden" | "linear" | "exponential";

export interface AncestralEpoch {
  nu: number; // relative size at the end of the epoch
  T: number; // duration (2 N_ref generations)
  dyn: Dynamics;
}

export interface SplitEpoch {
  T: number;
  nu: [number, number];
  dyn: [Dynamics, Dynamics];
  m12: number; // into pop 1 from pop 2
  m21: number; // into pop 2 from pop 1
  mig12On: boolean; // migration mask (true = this direction is active in this epoch)
  mig21On: boolean;
}

export interface Model {
  mode: 1 | 2;
  ancestral: AncestralEpoch[]; // past -> present; 1-3 epochs
  split: { useFraction: boolean; s: number; nu1: number; nu2: number }; // start sizes of the daughters
  post: SplitEpoch[]; // past -> present; 1-3 shared epochs (two-population mode)
  migration: boolean;
  pulse: { on: boolean; time: number; source: 1 | 2; f: number }; // time before present (2 N_ref gen.)
  selection: { on: boolean; gamma: number; h: number };
  inbreeding: { on: boolean; F: [number, number] };
  misid: { on: boolean; eps: number };
  n: [number, number]; // haploid sample sizes
}

export function defaultModel(): Model {
  return {
    mode: 1,
    ancestral: [{ nu: 1, T: 0.1, dyn: "sudden" }],
    split: { useFraction: true, s: 0.5, nu1: 1, nu2: 1 },
    post: [{ T: 0.2, nu: [1, 1], dyn: ["sudden", "sudden"], m12: 1, m21: 1, mig12On: true, mig21On: true }],
    migration: false,
    pulse: { on: false, time: 0.05, source: 1, f: 0.2 },
    selection: { on: false, gamma: -5, h: 0.5 },
    inbreeding: { on: false, F: [0.5, 0.5] },
    misid: { on: false, eps: 0.02 },
    n: [20, 20],
  };
}

/** Deep-merge partial overrides (for example a JSON model file) into the default model. */
export function modelFromOverrides(over: unknown, base: Model = defaultModel()): Model {
  const merge = (b: unknown, o: unknown): unknown => {
    if (o === null || typeof o !== "object" || Array.isArray(o)) return o === undefined ? b : o;
    const out: Record<string, unknown> = { ...(b as Record<string, unknown>) };
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const bv = (b as Record<string, unknown> | undefined)?.[k];
      out[k] = bv && typeof bv === "object" && !Array.isArray(bv) && v && typeof v === "object" && !Array.isArray(v) ? merge(bv, v) : v;
    }
    return out;
  };
  return merge(base, over) as Model;
}

// ---------------------------------------------------------------- compiled plan

export interface SizeFn {
  kind: "constant" | "linear" | "exponential";
  start: number;
  end: number;
}

export interface Interval {
  start: number; // time before present (older bound), 2 N_ref generations
  end: number; // time before present (younger bound)
  pops: string[]; // live populations, in moments order
  sizes: SizeFn[];
  mig: number[][] | null;
  ns: number[]; // lineages carried per population during this interval
  eventsAfter: PlanEvent[];
}

export type PlanEvent =
  | { kind: "split"; parent: string; children: [string, string]; ns: [number, number] }
  | { kind: "pulse"; source: string; dest: string; f: number };

export interface Plan {
  intervals: Interval[];
  rootN: number; // lineages at the start (equilibrium spectrum)
  simN: number[]; // sample sizes at the end of integration (before projection)
  n: number[]; // requested sample sizes
  pops: string[]; // sampled populations
  gamma: number;
  h: number;
}

export interface PlanOptions {
  /**
   * With selection on and |gamma| > selectionBoostAbove, integrate at least at this sample size
   * per population and project down afterwards. This reduces the jackknife closure error (see
   * docs/VALIDATION.md, "Selection: closure error"). Defaults are set in compute.ts.
   */
  selectionMinN1D?: number;
  selectionMinN2D?: number;
  selectionBoostAbove?: number;
  /**
   * With migration in any epoch (two populations), integrate each population at least at this
   * sample size and project down. The jackknife closure for migration is less accurate for small
   * samples (VALIDATION.md, msprime check of the model with n = 10 and 30).
   */
  migrationMinN2D?: number;
}

const EPS_T = 0; // epochs with T <= EPS_T are skipped (Demes needs positive durations)

function sizeFn(dyn: Dynamics, start: number, end: number): SizeFn {
  if (dyn === "sudden") return { kind: "constant", start: end, end };
  return { kind: dyn, start, end };
}

/**
 * Start and end times (before present) of consecutive epochs with durations Ts (past -> present),
 * as suffix sums from the present, so that the last epoch ends at exactly `offset`.
 */
export function epochBounds(Ts: number[], offset = 0): { start: number; end: number }[] {
  const out = new Array<{ start: number; end: number }>(Ts.length);
  let end = offset;
  for (let k = Ts.length - 1; k >= 0; k--) {
    out[k] = { start: end + Ts[k], end };
    end = end + Ts[k];
  }
  return out;
}

/** Size of an epoch function at fraction `frac` of its duration (moments.Demes `_sizes_at_time`). */
function sizeAt(f: SizeFn, frac: number): number {
  if (f.kind === "constant") return f.start;
  if (f.kind === "linear") return f.start + frac * (f.end - f.start);
  return f.start * Math.exp(Math.log(f.end / f.start) * frac);
}

export function validateModel(m: Model): string[] {
  const errs: string[] = [];
  const pos = (x: number) => Number.isFinite(x) && x > 0;
  if (m.ancestral.length < 1 || m.ancestral.length > 3) errs.push("1-3 ancestral epochs are needed");
  m.ancestral.forEach((e, k) => {
    if (!pos(e.nu)) errs.push(`ancestral epoch ${k + 1}: size must be positive`);
    if (!(e.T >= 0)) errs.push(`ancestral epoch ${k + 1}: duration must be >= 0`);
  });
  if (m.mode === 2) {
    if (m.post.length < 1 || m.post.length > 3) errs.push("1-3 epochs after the split are needed");
    m.post.forEach((e, k) => {
      if (!(e.T > 0)) errs.push(`epoch ${k + 1} after the split: duration must be positive`);
      if (!pos(e.nu[0]) || !pos(e.nu[1])) errs.push(`epoch ${k + 1} after the split: sizes must be positive`);
      if (!(e.m12 >= 0) || !(e.m21 >= 0)) errs.push(`epoch ${k + 1} after the split: migration rates must be >= 0`);
    });
    if (m.split.useFraction && !(m.split.s > 0 && m.split.s < 1)) errs.push("split fraction must be in (0, 1)");
    if (!m.split.useFraction && (!pos(m.split.nu1) || !pos(m.split.nu2))) errs.push("start sizes after the split must be positive");
    if (m.pulse.on) {
      const Ts = m.post.reduce((a, e) => a + e.T, 0);
      if (!(m.pulse.time > 0 && m.pulse.time < Ts)) errs.push("the pulse must happen after the split and before the present");
      if (!(m.pulse.f >= 0 && m.pulse.f <= 1)) errs.push("the pulse proportion must be in [0, 1]");
    }
  }
  const nMax = m.mode === 1 ? 200 : 60;
  for (const n of m.mode === 1 ? [m.n[0]] : m.n)
    if (!Number.isInteger(n) || n < 2 || n > nMax) errs.push(`sample size must be an integer in [2, ${nMax}]`);
  if (m.inbreeding.on) {
    for (const F of m.mode === 1 ? [m.inbreeding.F[0]] : m.inbreeding.F)
      if (!(F >= 0 && F <= 1)) errs.push("inbreeding coefficient F must be in [0, 1]");
    for (const n of m.mode === 1 ? [m.n[0]] : m.n) if (n % 2 !== 0) errs.push("inbreeding needs an even (diploid) sample size");
  }
  if (m.misid.on && !(m.misid.eps >= 0 && m.misid.eps <= 1)) errs.push("misidentification rate must be in [0, 1]");
  return errs;
}

/** Compile a model into integration intervals (past -> present) and events. */
export function compileModel(m: Model, opts: PlanOptions = {}): Plan {
  const errs = validateModel(m);
  if (errs.length) throw new Error(errs.join("; "));
  const gamma = m.selection.on ? m.selection.gamma : 0;
  const h = m.selection.on ? m.selection.h : 0.5;
  const boostAbove = opts.selectionBoostAbove ?? Infinity;
  const minNSel = (m.mode === 1 ? opts.selectionMinN1D : opts.selectionMinN2D) ?? 0;
  const hasMig = m.mode === 2 && m.migration && m.post.some((e) => e.mig12On || e.mig21On);
  const minNMig = hasMig ? opts.migrationMinN2D ?? 0 : 0;
  const simSize = (n: number) => Math.max(n, 4, minNMig, m.selection.on && Math.abs(gamma) > boostAbove ? minNSel : 0);

  const anc = m.ancestral.filter((e) => e.T > EPS_T);
  const intervals: Interval[] = [];

  if (m.mode === 1) {
    const simN = [simSize(m.n[0])];
    const bounds = epochBounds(anc.map((e) => e.T), 0);
    let kept = 0;
    let prevNu = 1;
    for (const e of m.ancestral) {
      if (e.T > EPS_T) {
        const { start, end } = bounds[kept++];
        intervals.push({
          start,
          end,
          pops: ["pop1"],
          sizes: [sizeFn(e.dyn, prevNu, e.nu)],
          mig: null,
          ns: [...simN],
          eventsAfter: [],
        });
      }
      prevNu = e.nu;
    }
    return { intervals, rootN: simN[0], simN, n: [m.n[0]], pops: ["pop1"], gamma, h };
  }

  // ---- two populations
  const post = m.post;
  const simN = [simSize(m.n[0]), simSize(m.n[1])];
  const pulse = m.pulse.on ? m.pulse : null;
  const src = pulse ? pulse.source - 1 : -1;
  const dst = pulse ? 1 - src : -1;

  // lineages after the split, before and after the pulse
  const nAfter = [...simN];
  const nBefore = [...simN];
  if (pulse) nBefore[src] += simN[dst];
  const nAnc = nBefore[0] + nBefore[1];

  // ancestral intervals
  const postBounds = epochBounds(post.map((e) => e.T), 0);
  const Tsplit = postBounds[0].start;
  const ancBounds = epochBounds(anc.map((e) => e.T), Tsplit);
  let kept = 0;
  let prevNu = 1;
  for (const e of m.ancestral) {
    if (e.T > EPS_T) {
      const { start, end } = ancBounds[kept++];
      intervals.push({ start, end, pops: ["ANC"], sizes: [sizeFn(e.dyn, prevNu, e.nu)], mig: null, ns: [nAnc], eventsAfter: [] });
    }
    prevNu = e.nu;
  }
  const splitEvent: PlanEvent = { kind: "split", parent: "ANC", children: ["pop1", "pop2"], ns: [nBefore[0], nBefore[1]] };
  // the split happens at the end of the last ancestral interval; if all ancestral epochs have
  // zero length, it is applied to the equilibrium spectrum directly
  const preSplitEvents: PlanEvent[] = [];
  if (intervals.length) intervals[intervals.length - 1].eventsAfter.push(splitEvent);
  else preSplitEvents.push(splitEvent);

  // start sizes of the daughters
  const nuAncEnd = prevNu;
  const start0 = m.split.useFraction ? [m.split.s * nuAncEnd, (1 - m.split.s) * nuAncEnd] : [m.split.nu1, m.split.nu2];

  let prev = [...start0];
  post.forEach((e, l) => {
    const eStart = postBounds[l].start;
    const eEnd = postBounds[l].end;
    const fns = [sizeFn(e.dyn[0], prev[0], e.nu[0]), sizeFn(e.dyn[1], prev[1], e.nu[1])];
    let mig: number[][] | null = null;
    if (m.migration && (e.mig12On || e.mig21On)) mig = [[0, e.mig12On ? e.m12 : 0], [e.mig21On ? e.m21 : 0, 0]];
    // break points inside this epoch: the pulse
    const cuts: number[] = [eStart];
    if (pulse && pulse.time < eStart && pulse.time > eEnd) cuts.push(pulse.time);
    cuts.push(eEnd);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const a = cuts[k];
      const b = cuts[k + 1];
      const fa = (eStart - a) / e.T;
      const fb = (eStart - b) / e.T;
      const sizes: SizeFn[] = fns.map((f) =>
        f.kind === "constant" ? { ...f } : { kind: f.kind, start: sizeAt(f, fa), end: sizeAt(f, fb) },
      );
      const ns = pulse && b >= pulse.time ? [...nBefore] : [...nAfter];
      const ev: PlanEvent[] = [];
      if (pulse && b === pulse.time) ev.push({ kind: "pulse", source: `pop${src + 1}`, dest: `pop${dst + 1}`, f: pulse.f });
      intervals.push({ start: a, end: b, pops: ["pop1", "pop2"], sizes, mig, ns, eventsAfter: ev });
    }
    // (a pulse exactly at an epoch boundary is attached by the loop above: b === pulse.time)
    prev = [e.nu[0], e.nu[1]];
  });

  const plan: Plan = { intervals, rootN: nAnc, simN, n: [m.n[0], m.n[1]], pops: ["pop1", "pop2"], gamma, h };
  (plan as Plan & { preSplitEvents?: PlanEvent[] }).preSplitEvents = preSplitEvents;
  return plan;
}

/** Size specification for one interval, as moments.Demes `_make_nu_func` builds it. */
export function nuSpecOf(iv: Interval): NuSpec {
  const T = iv.start - iv.end;
  if (iv.sizes.every((s) => s.kind === "constant")) return iv.sizes.map((s) => s.start);
  const fns = iv.sizes.map((s) => {
    if (s.kind === "constant") return (_t: number) => s.start;
    if (s.kind === "linear") return (t: number) => s.start + (t / T) * (s.end - s.start);
    return (t: number) => s.start * Math.exp((Math.log(s.end / s.start) * t) / T);
  });
  return (t: number) => fns.map((f) => f(t));
}
