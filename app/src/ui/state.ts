/**
 * Application state: the raw model (keeps values that are hidden by a toggle, so they come back
 * when the toggle is switched on again), the global toggles, the display settings and the
 * physical units. `effectiveModel` turns this into the model that the engine computes.
 */

import { Model, Dynamics, defaultModel } from "../engine/model.ts";
import { LIMITS } from "../engine/limits.ts";

export const DYNAMICS: Dynamics[] = ["sudden", "linear", "exponential"];

export interface DisplayState {
  folded: boolean;
  yUnit: "proportion" | "count";
  yLog: boolean;
  neutral: boolean;
  ratio: boolean;
  view1D: "pop1" | "pop2" | "pooled"; // which 1D spectrum is shown in two-population mode
  widthScale: "log" | "linear"; // tube width in the history diagram
  timeScale: "compressed" | "linear"; // time axis of the history diagram
}

export interface UnitsState {
  physical: boolean; // show years and individuals in the diagram
  Nref: number; // reference effective size (diploid individuals)
  gen: number; // generation time in years
  mu: number; // mutation rate per site per generation
  L: number; // number of sites (including monomorphic sites)
}

export type WcModelMode = "hwe" | "fis" | "haploid";

export interface AppState {
  model: Model;
  dynOn: Record<Dynamics, boolean>;
  symMig: boolean;
  masksOn: boolean;
  dominanceOn: boolean;
  display: DisplayState;
  units: UnitsState;
  wcMode: WcModelMode;
  preset: string; // id of the last loaded preset ("" = changed by the user)
}

export function defaultState(): AppState {
  return {
    model: defaultModel(),
    dynOn: { sudden: true, linear: true, exponential: true },
    symMig: false,
    masksOn: false,
    dominanceOn: false,
    display: {
      folded: false,
      yUnit: "proportion",
      yLog: false,
      neutral: true,
      ratio: true,
      view1D: "pop1",
      widthScale: "log",
      timeScale: "compressed",
    },
    units: { physical: false, Nref: 10000, gen: 1, mu: 1e-8, L: 1e6 },
    wcMode: "hwe",
    preset: "snm",
  };
}

export const theta = (u: UnitsState): number => 4 * u.Nref * u.mu * u.L;

/** Total time after the split (2 N_ref generations). */
export const postSplitTime = (m: Model): number => m.post.reduce((a, e) => a + e.T, 0);

/**
 * Keep the state consistent after any change: sample sizes within the limits (and even when
 * inbreeding is on), the pulse inside the post-split period, at least one dynamics type on.
 */
export function normalise(s: AppState): AppState {
  const m = s.model;
  const nMax = m.mode === 1 ? LIMITS.n1D.max : LIMITS.n2D.max;
  m.n = m.n.map((n) => {
    let v = Math.round(Math.min(nMax, Math.max(LIMITS.n1D.min, n)));
    if (m.inbreeding.on && v % 2 === 1) v = v + 1 <= nMax ? v + 1 : v - 1;
    return v;
  }) as [number, number];
  if (!DYNAMICS.some((d) => s.dynOn[d])) s.dynOn.sudden = true;
  const Tpost = postSplitTime(m);
  if (m.pulse.time >= Tpost) m.pulse.time = Tpost * 0.5;
  if (m.pulse.time <= 0) m.pulse.time = Tpost * 0.5;
  const g = m.mode === 1 ? LIMITS.gamma1D : LIMITS.gamma2D;
  m.selection.gamma = Math.max(-g, Math.min(g, m.selection.gamma));
  return s;
}

/** The model that is computed: toggles applied to the raw model. */
export function effectiveModel(s: AppState): Model {
  const m: Model = structuredClone(s.model);
  const allowed = DYNAMICS.filter((d) => s.dynOn[d]);
  const fixDyn = (d: Dynamics): Dynamics => (allowed.includes(d) ? d : allowed[0]);
  for (const e of m.ancestral) e.dyn = fixDyn(e.dyn);
  for (const e of m.post) {
    e.dyn = [fixDyn(e.dyn[0]), fixDyn(e.dyn[1])];
    if (s.symMig) e.m21 = e.m12;
    if (!s.masksOn) {
      e.mig12On = true;
      e.mig21On = true;
    }
  }
  if (m.mode === 1) {
    m.migration = false;
    m.pulse.on = false;
  }
  if (!s.dominanceOn) m.selection.h = 0.5;
  return m;
}

/** Structure text, as in GADMA: "(2)" for one population, "(2, 1)" for two. */
export function structureText(m: Model): string {
  return m.mode === 1 ? `(${m.ancestral.length})` : `(${m.ancestral.length}, ${m.post.length})`;
}

// ---------------------------------------------------------------- store

export type Listener = (s: AppState, info: ChangeInfo) => void;
export interface ChangeInfo {
  draft: boolean; // true while a slider is being dragged
  structural: boolean; // controls must be rebuilt (mode, epoch counts, toggles, preset)
  source: string;
}

export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();
  constructor(initial: AppState) {
    this.state = normalise(initial);
  }
  get(): AppState {
    return this.state;
  }
  /** Change the state in place through `fn`, then notify the listeners. */
  update(fn: (s: AppState) => void, info: Partial<ChangeInfo> = {}): void {
    fn(this.state);
    normalise(this.state);
    if (info.source !== "preset") this.state.preset = info.source === "display" ? this.state.preset : "";
    const full: ChangeInfo = { draft: false, structural: false, source: "", ...info };
    for (const l of this.listeners) l(this.state, full);
  }
  replace(s: AppState, info: Partial<ChangeInfo> = {}): void {
    this.state = normalise(s);
    const full: ChangeInfo = { draft: false, structural: true, source: "replace", ...info };
    for (const l of this.listeners) l(this.state, full);
  }
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}
