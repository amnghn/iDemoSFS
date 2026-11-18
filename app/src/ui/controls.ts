/**
 * The model builder (left column of the Model tab). The panel is rebuilt when its structure
 * changes (mode, number of epochs, toggles, preset); while a slider moves, only the model is
 * updated. The open/closed state of sections and the keyboard focus survive a rebuild.
 */

import { Store, AppState, DYNAMICS, structureText, postSplitTime, theta } from "./state.ts";
import { Dynamics, SplitEpoch } from "../engine/model.ts";
import { LIMITS, modelWarnings } from "../engine/limits.ts";
import { PRESETS, applyPreset, presetById } from "./presets.ts";
import { effectiveModel } from "./state.ts";
import { slider, toggle, segmented, select, stepper, numberField } from "./widgets.ts";
import { h, fmt, intFmt } from "./dom.ts";
import type { DiagramTarget } from "./plots/diagram.ts";

export type Action = "pin" | "unpin" | "share" | "csv" | "fs" | "demes" | "diagram-svg" | "diagram-png" | "sfs-svg" | "sfs-png";

const DYN_NAME: Record<Dynamics, string> = { sudden: "Sudden", linear: "Linear", exponential: "Exponential" };

export interface ControlsHandle {
  focusTarget(t: DiagramTarget): void;
  setPinned(on: boolean): void;
}

export function mountControls(root: HTMLElement, store: Store, onAction: (a: Action) => void): ControlsHandle {
  const open = new Set<string>(["structure", "toggles", "ancestral", "split", "post", "pulse", "selection", "inbreeding", "misid", "sampling"]);
  let pinned = false;

  const upd = (fn: (s: AppState) => void, final: boolean, structural = false): void =>
    store.update(fn, { draft: !final, structural, source: "controls" });

  const section = (id: string, title: string, ...body: (HTMLElement | null)[]): HTMLElement => {
    const d = h("details", { class: "ctrl-section", "data-section": id, open: open.has(id) }, h("summary", {}, title), ...body);
    d.addEventListener("toggle", () => (d.open ? open.add(id) : open.delete(id)));
    return d;
  };

  const dynSelect = (key: string, label: string, value: Dynamics, s: AppState, onChange: (d: Dynamics) => void): HTMLElement => {
    const allowed = DYNAMICS.filter((d) => s.dynOn[d]);
    const v = allowed.includes(value) ? value : allowed[0];
    return select(key, label, allowed.map((d) => ({ value: d, label: DYN_NAME[d] })), v, onChange);
  };

  function build(): void {
    const s = store.get();
    const m = s.model;
    const two = m.mode === 2;
    const children: HTMLElement[] = [];

    // ---- mode and presets
    const preset = presetById(s.preset);
    children.push(
      h(
        "div",
        { class: "ctrl-top" },
        segmented("mode", "Mode", [{ value: "1", label: "One population" }, { value: "2", label: "Two populations" }], String(m.mode) as "1" | "2", (v) =>
          upd((st) => (st.model.mode = Number(v) as 1 | 2), true, true),
        ),
        select(
          "preset",
          "Preset",
          [{ value: "", label: "— choose a preset —" }, ...PRESETS.map((p) => ({ value: p.id, label: p.label, group: p.group }))],
          s.preset,
          (id) => {
            const p = presetById(id);
            if (p) store.update((st) => applyPreset(st, p), { structural: true, source: "preset" });
          },
        ),
        preset ? h("p", { class: "preset-note" }, preset.note) : h("p", { class: "preset-note muted" }, "Custom model."),
      ),
    );

    // ---- structure
    children.push(
      section(
        "structure",
        `Structure: ${structureText(m)}`,
        h(
          "div",
          { class: "row2" },
          stepper("n-anc", two ? "Epochs before the split" : "Epochs", m.ancestral.length, 1, 3, (v) =>
            upd(
              (st) => {
                const a = st.model.ancestral;
                while (a.length < v) a.push({ ...a[a.length - 1], T: 0.05 });
                a.length = v;
              },
              true,
              true,
            ),
          ),
          two
            ? stepper("n-post", "Epochs after the split", m.post.length, 1, 3, (v) =>
                upd(
                  (st) => {
                    const p = st.model.post;
                    while (p.length < v) p.push({ ...structuredClone(p[p.length - 1]), T: 0.05 });
                    p.length = v;
                  },
                  true,
                  true,
                ),
              )
            : null,
        ),
        h("p", { class: "hint" }, "Epochs run from the past (top) to the present (bottom). Each epoch has its own size at its end, duration and type of size change, as in GADMA."),
      ),
    );

    // ---- toggles (GADMA "additional controls")
    const tg = (key: string, label: string, val: boolean, fn: (st: AppState, v: boolean) => void, opts: { disabled?: boolean; info?: string } = {}): HTMLElement =>
      toggle(key, label, val, (v) => upd((st) => fn(st, v), true, true), opts);
    children.push(
      section(
        "toggles",
        "Features",
        h(
          "div",
          { class: "toggles" },
          tg("t-mig", "Migration", two && m.migration, (st, v) => (st.model.migration = v), { disabled: !two, info: "Continuous gene flow between the two populations after the split." }),
          tg("t-sym", "Symmetric migration", s.symMig, (st, v) => (st.symMig = v), { disabled: !two || !m.migration, info: "One rate sets both directions." }),
          tg("t-mask", "Migration masks", s.masksOn, (st, v) => (st.masksOn = v), {
            disabled: !two || !m.migration,
            info: "Switch off migration in a given direction and epoch (for example secondary contact, or ancient migration only).",
          }),
          tg("t-pulse", "Admixture pulse", two && m.pulse.on, (st, v) => (st.model.pulse.on = v), { disabled: !two, info: "A single, instantaneous movement of lineages from one population into the other." }),
          tg("t-sel", "Selection", m.selection.on, (st, v) => (st.model.selection.on = v), { info: "Every site is under the same selection, γ = 2·N_ref·s." }),
          tg("t-dom", "Dominance", s.dominanceOn, (st, v) => (st.dominanceOn = v), { disabled: !m.selection.on, info: "Dominance coefficient h. Off means additive selection (h = 0.5)." }),
          tg("t-inb", "Inbreeding", m.inbreeding.on, (st, v) => (st.model.inbreeding.on = v), { info: "Inbreeding coefficient F (Blischak et al. 2020 model). Needs an even sample size." }),
          tg("t-mis", "Ancestral misidentification", m.misid.on, (st, v) => (st.model.misid.on = v), { info: "A fraction ε of sites has the wrong ancestral allele, so bin i moves to bin n − i." }),
          h(
            "div",
            { class: "dyn-toggles" },
            h("span", { class: "lbl" }, "Dynamics:"),
            ...DYNAMICS.map((d) =>
              tg(`t-dyn-${d}`, DYN_NAME[d], s.dynOn[d], (st, v) => {
                st.dynOn[d] = v;
              }, { disabled: s.dynOn[d] && DYNAMICS.filter((x) => s.dynOn[x]).length === 1 }),
            ),
          ),
        ),
      ),
    );

    // ---- ancestral epochs
    const nuSlider = (key: string, label: string, value: number, set: (st: AppState, v: number) => void): HTMLElement =>
      slider({ key, label, sub: "(ν = N/N_ref)", min: LIMITS.nu.min, max: LIMITS.nu.max, log: true, value, onInput: (v, f) => upd((st) => set(st, v), f) });
    const tSlider = (key: string, label: string, value: number, set: (st: AppState, v: number) => void): HTMLElement =>
      slider({ key, label, sub: "(2N_ref gen.)", min: LIMITS.T.min, max: LIMITS.T.max, log: true, value: Math.max(value, LIMITS.T.min), onInput: (v, f) => upd((st) => set(st, v), f) });
    children.push(
      section(
        "ancestral",
        two ? "Ancestral population (before the split)" : "Population history",
        ...m.ancestral.map((e, k) =>
          h(
            "fieldset",
            { class: "epoch", "data-target": `ancestral-${k}` },
            h("legend", {}, `Epoch ${k + 1}${m.ancestral.length > 1 ? (k === 0 ? " (oldest)" : k === m.ancestral.length - 1 ? " (most recent)" : "") : ""}`),
            nuSlider(`anc${k}-nu`, "Size at the end", e.nu, (st, v) => (st.model.ancestral[k].nu = v)),
            tSlider(`anc${k}-T`, "Duration T", e.T, (st, v) => (st.model.ancestral[k].T = v)),
            dynSelect(`anc${k}-dyn`, "Size change", e.dyn, s, (d) => upd((st) => (st.model.ancestral[k].dyn = d), true)),
          ),
        ),
      ),
    );

    if (two) {
      // ---- split
      const sp = m.split;
      children.push(
        section(
          "split",
          "Split",
          h(
            "div",
            { "data-target": "split-0" },
            segmented("split-mode", "Start sizes of the daughters", [{ value: "fraction", label: "Split fraction s" }, { value: "sizes", label: "Set sizes" }], sp.useFraction ? "fraction" : "sizes", (v) =>
              upd((st) => (st.model.split.useFraction = v === "fraction"), true, true),
              "With a split fraction, pop 1 starts with s and pop 2 with 1 − s of the ancestral size.",
            ),
            sp.useFraction
              ? slider({ key: "split-s", label: "Split fraction s", min: 0.01, max: 0.99, value: sp.s, step: 0.01, onInput: (v, f) => upd((st) => (st.model.split.s = v), f) })
              : h(
                  "div",
                  {},
                  nuSlider("split-nu1", "Pop 1 size at the split", sp.nu1, (st, v) => (st.model.split.nu1 = v)),
                  nuSlider("split-nu2", "Pop 2 size at the split", sp.nu2, (st, v) => (st.model.split.nu2 = v)),
                ),
            h("p", { class: "hint" }, `Split time: ${fmt(postSplitTime(m))} × 2N_ref generations before present (the sum of the durations below).`),
          ),
        ),
      );
      // ---- post-split epochs
      children.push(
        section(
          "post",
          "After the split",
          ...m.post.map((e, k) => postEpoch(e, k, s)),
        ),
      );
      // ---- pulse
      if (m.pulse.on) {
        const Tpost = postSplitTime(m);
        children.push(
          section(
            "pulse",
            "Admixture pulse",
            h(
              "div",
              { "data-target": "pulse-0" },
              slider({
                key: "pulse-t",
                label: "Time of the pulse",
                sub: "(before present)",
                min: Math.max(1e-4, Tpost * 0.001),
                max: Tpost * 0.999,
                log: true,
                value: Math.min(m.pulse.time, Tpost * 0.999),
                onInput: (v, f) => upd((st) => (st.model.pulse.time = v), f),
              }),
              select("pulse-dir", "Direction (forward in time)", [{ value: "1", label: "pop 1 → pop 2" }, { value: "2", label: "pop 2 → pop 1" }], String(m.pulse.source) as "1" | "2", (v) =>
                upd((st) => (st.model.pulse.source = Number(v) as 1 | 2), true),
              ),
              slider({
                key: "pulse-f",
                label: "Admixture fraction f",
                min: LIMITS.f.min,
                max: LIMITS.f.max,
                step: 0.01,
                value: m.pulse.f,
                info: "The fraction of the receiving population that comes from the source population at the time of the pulse.",
                onInput: (v, f) => upd((st) => (st.model.pulse.f = v), f),
              }),
            ),
          ),
        );
      }
    }

    // ---- selection
    if (m.selection.on) {
      const gmax = two ? LIMITS.gamma2D : LIMITS.gamma1D;
      const warn = modelWarnings(effectiveModel(s)).filter((w) => w.includes("selection") || w.includes("γ"));
      children.push(
        section(
          "selection",
          "Selection",
          slider({
            key: "sel-g",
            label: "Scaled selection coefficient γ",
            sub: "(2·N_ref·s)",
            min: -gmax,
            max: gmax,
            step: 0.5,
            value: m.selection.gamma,
            info: "Negative values: purifying selection against the derived allele. Positive values: positive selection. Genotype fitnesses are 1, 1 + 2hs and 1 + 2s.",
            onInput: (v, f) => upd((st) => (st.model.selection.gamma = v), f),
          }),
          s.dominanceOn
            ? slider({
                key: "sel-h",
                label: "Dominance coefficient h",
                min: 0,
                max: 1,
                step: 0.05,
                value: m.selection.h,
                info: "0 = recessive, 0.5 = additive, 1 = dominant.",
                onInput: (v, f) => upd((st) => (st.model.selection.h = v), f),
              })
            : null,
          warn.length ? h("p", { class: "warning", role: "status" }, warn.join(" ")) : null,
          h("p", { class: "hint" }, `Limit in ${two ? "two-population" : "one-population"} mode: |γ| ≤ ${gmax}. The engine integrates selection at a larger internal sample size and projects down (see the validation report).`),
        ),
      );
    }
    if (m.inbreeding.on)
      children.push(
        section(
          "inbreeding",
          "Inbreeding",
          slider({ key: "inb-F1", label: two ? "F in pop 1" : "Inbreeding coefficient F", min: 0, max: 1, step: 0.01, value: m.inbreeding.F[0], onInput: (v, f) => upd((st) => (st.model.inbreeding.F[0] = v), f) }),
          two ? slider({ key: "inb-F2", label: "F in pop 2", min: 0, max: 1, step: 0.01, value: m.inbreeding.F[1], onInput: (v, f) => upd((st) => (st.model.inbreeding.F[1] = v), f) }) : null,
          h("p", { class: "hint" }, "Inbreeding changes how the alleles of a sample are grouped into individuals, so it changes the sampled SFS (Blischak et al. 2020). The sample size must be even."),
        ),
      );
    if (m.misid.on)
      children.push(
        section(
          "misid",
          "Ancestral misidentification",
          slider({ key: "mis-eps", label: "Misidentification rate ε", min: LIMITS.eps.min, max: LIMITS.eps.max, step: 0.005, value: m.misid.eps, onInput: (v, f) => upd((st) => (st.model.misid.eps = v), f) }),
        ),
      );

    // ---- sampling and display
    const d = s.display;
    const nMax = two ? LIMITS.n2D.max : LIMITS.n1D.max;
    const dispUpd = (fn: (st: AppState) => void): void => store.update(fn, { source: "display", structural: true });
    children.push(
      section(
        "sampling",
        "Sample and display",
        slider({
          key: "n1",
          label: two ? "Sample size, pop 1" : "Sample size n",
          sub: "(haploid chromosomes)",
          min: 2,
          max: nMax,
          integer: true,
          step: m.inbreeding.on ? 2 : 1,
          value: m.n[0],
          onInput: (v, f) => upd((st) => (st.model.n[0] = v), f),
        }),
        two
          ? slider({ key: "n2", label: "Sample size, pop 2", sub: "(haploid chromosomes)", min: 2, max: nMax, integer: true, step: m.inbreeding.on ? 2 : 1, value: m.n[1], onInput: (v, f) => upd((st) => (st.model.n[1] = v), f) })
          : null,
        segmented("folded", "Spectrum", [{ value: "unfolded", label: "Unfolded" }, { value: "folded", label: "Folded" }], d.folded ? "folded" : "unfolded", (v) => dispUpd((st) => (st.display.folded = v === "folded")), "Folding needs no outgroup: it counts the minor allele instead of the derived allele."),
        segmented("yunit", "Y axis", [{ value: "proportion", label: "Proportion" }, { value: "count", label: "Count (θ)" }], d.yUnit, (v) => dispUpd((st) => (st.display.yUnit = v))),
        h(
          "div",
          { class: "toggles compact" },
          toggle("ylog", "Log y axis", d.yLog, (v) => dispUpd((st) => (st.display.yLog = v))),
          toggle("neutral", "Neutral overlay", d.neutral, (v) => dispUpd((st) => (st.display.neutral = v))),
          toggle("ratio", "Ratio to neutral", d.ratio, (v) => dispUpd((st) => (st.display.ratio = v))),
        ),
        two
          ? segmented("view1d", "1D panel shows", [{ value: "pop1", label: "Pop 1" }, { value: "pop2", label: "Pop 2" }, { value: "pooled", label: "Pooled" }], d.view1D, (v) => dispUpd((st) => (st.display.view1D = v)), "Pooled: both samples are treated as one sample of n1 + n2 chromosomes.")
          : null,
        segmented("wscale", "Diagram width", [{ value: "log", label: "Log size" }, { value: "linear", label: "Linear size" }], d.widthScale, (v) => dispUpd((st) => (st.display.widthScale = v))),
        segmented("tscale", "Diagram time axis", [{ value: "compressed", label: "Compressed" }, { value: "linear", label: "Linear" }], d.timeScale, (v) => dispUpd((st) => (st.display.timeScale = v)), "Compressed: recent times get more space (a symmetric log scale)."),
      ),
    );

    // ---- physical units
    const u = s.units;
    children.push(
      section(
        "units",
        "Physical units and θ",
        toggle("phys", "Show years and numbers of individuals", u.physical, (v) => dispUpd((st) => (st.units.physical = v))),
        h(
          "div",
          { class: "grid2" },
          numberField("Nref", "N_ref (individuals)", u.Nref, (v) => dispUpd((st) => (st.units.Nref = v)), { min: 1, info: "Reference effective population size (diploid individuals)." }),
          numberField("gen", "Generation time (years)", u.gen, (v) => dispUpd((st) => (st.units.gen = v)), { min: 0.001 }),
          numberField("mu", "Mutation rate μ", u.mu, (v) => dispUpd((st) => (st.units.mu = v)), { min: 0, info: "Per site and per generation." }),
          numberField("L", "Sites L", u.L, (v) => dispUpd((st) => (st.units.L = v)), { min: 1, info: "Number of sites, including monomorphic sites." }),
        ),
        h(
          "p",
          { class: "hint" },
          `θ = 4·N_ref·μ·L = ${fmt(theta(u))} (θ per site = ${fmt(4 * u.Nref * u.mu)}). One time unit (2N_ref generations) = ${intFmt(2 * u.Nref * u.gen)} years.`,
        ),
      ),
    );

    // ---- actions
    children.push(
      h(
        "div",
        { class: "actions" },
        h("button", { type: "button", class: "btn", "data-key": "pin", onclick: () => onAction(pinned ? "unpin" : "pin") }, pinned ? "Clear pinned spectrum" : "Pin this spectrum"),
        h("button", { type: "button", class: "btn", "data-key": "share", onclick: () => onAction("share") }, "Copy link to this model"),
        h(
          "details",
          { class: "downloads" },
          h("summary", { class: "btn" }, "Download…"),
          h(
            "div",
            { class: "dl-menu" },
            ...(
              [
                ["csv", "Spectrum (CSV)"],
                ["fs", "Spectrum (dadi/moments .fs)"],
                ["demes", "Model (Demes YAML)"],
                ["diagram-svg", "Diagram (SVG)"],
                ["diagram-png", "Diagram (PNG)"],
                ["sfs-svg", "SFS plot (SVG)"],
                ["sfs-png", "SFS plot (PNG)"],
              ] as [Action, string][]
            ).map(([a, l]) => h("button", { type: "button", class: "link", onclick: () => onAction(a) }, l)),
          ),
        ),
      ),
    );

    // rebuild with focus restore
    const active = document.activeElement as HTMLElement | null;
    const key = active && root.contains(active) ? active.getAttribute("data-key") : null;
    root.replaceChildren(...children);
    if (key) (root.querySelector(`[data-key="${CSS.escape(key)}"]`) as HTMLElement | null)?.focus();
  }

  function postEpoch(e: SplitEpoch, k: number, s: AppState): HTMLElement {
    const m = s.model;
    const nuS = (q: 0 | 1): HTMLElement =>
      slider({
        key: `post${k}-nu${q}`,
        label: `Pop ${q + 1} size at the end`,
        sub: "(ν)",
        min: LIMITS.nu.min,
        max: LIMITS.nu.max,
        log: true,
        value: e.nu[q],
        onInput: (v, f) => upd((st) => (st.model.post[k].nu[q] = v), f),
      });
    const migRows: (HTMLElement | null)[] = [];
    if (m.migration) {
      if (s.symMig)
        migRows.push(
          slider({
            key: `post${k}-M`,
            label: "Migration rate M (both directions)",
            sub: "(2N_ref·m)",
            min: LIMITS.M.min,
            max: 10,
            step: 0.05,
            value: e.m12,
            onInput: (v, f) =>
              upd((st) => {
                st.model.post[k].m12 = v;
                st.model.post[k].m21 = v;
              }, f),
          }),
        );
      else {
        migRows.push(
          slider({ key: `post${k}-M12`, label: "M₁₂: into pop 1 from pop 2", sub: "(2N_ref·m)", min: 0, max: 10, step: 0.05, value: e.m12, onInput: (v, f) => upd((st) => (st.model.post[k].m12 = v), f) }),
          slider({ key: `post${k}-M21`, label: "M₂₁: into pop 2 from pop 1", sub: "(2N_ref·m)", min: 0, max: 10, step: 0.05, value: e.m21, onInput: (v, f) => upd((st) => (st.model.post[k].m21 = v), f) }),
        );
      }
      if (s.masksOn)
        migRows.push(
          h(
            "div",
            { class: "toggles compact" },
            toggle(`post${k}-on12`, "Migration into pop 1 in this epoch", e.mig12On, (v) => upd((st) => (st.model.post[k].mig12On = v), true)),
            toggle(`post${k}-on21`, "Migration into pop 2 in this epoch", e.mig21On, (v) => upd((st) => (st.model.post[k].mig21On = v), true)),
          ),
        );
    }
    return h(
      "fieldset",
      { class: "epoch", "data-target": `post-${k}` },
      h("legend", {}, `Epoch ${k + 1} after the split${m.post.length > 1 ? (k === 0 ? " (oldest)" : k === m.post.length - 1 ? " (most recent)" : "") : ""}`),
      slider({
        key: `post${k}-T`,
        label: "Duration T",
        sub: "(2N_ref gen.)",
        min: LIMITS.T.min,
        max: LIMITS.T.max,
        log: true,
        value: e.T,
        onInput: (v, f) => upd((st) => (st.model.post[k].T = v), f),
      }),
      h(
        "div",
        { class: "pop-pair" },
        h("div", { class: "pop pop1" }, nuS(0), dynSelect(`post${k}-dyn0`, "Pop 1 size change", e.dyn[0], s, (d) => upd((st) => (st.model.post[k].dyn[0] = d), true))),
        h("div", { class: "pop pop2" }, nuS(1), dynSelect(`post${k}-dyn1`, "Pop 2 size change", e.dyn[1], s, (d) => upd((st) => (st.model.post[k].dyn[1] = d), true))),
      ),
      h("div", { "data-target": `migration-${k}` }, ...migRows),
    );
  }

  build();
  store.subscribe((_s, info) => {
    if (info.structural || info.source !== "controls") build();
  });

  return {
    focusTarget(t: DiagramTarget) {
      const id = t.kind === "post" ? `post-${t.index}` : `${t.kind}-${t.index}`;
      const sec = t.kind === "post" || t.kind === "migration" ? "post" : t.kind === "split" ? "split" : t.kind;
      open.add(sec);
      const det = root.querySelector(`details[data-section="${sec}"]`) as HTMLDetailsElement | null;
      if (det) det.open = true;
      const el = root.querySelector(`[data-target="${id}"]`) as HTMLElement | null;
      if (!el) return;
      el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1200);
      const focusable = (t.kind === "post" && t.pop !== undefined ? el.querySelector(`.pop${t.pop + 1} input`) : el.querySelector("input, select")) as HTMLElement | null;
      focusable?.focus({ preventScroll: true });
    },
    setPinned(on: boolean) {
      pinned = on;
      const b = root.querySelector('[data-key="pin"]');
      if (b) b.textContent = on ? "Clear pinned spectrum" : "Pin this spectrum";
    },
  };
}
