/**
 * The Learn tab: teaching text (rendered at build time from src/content/learn.md), a table of
 * contents, buttons that open presets in the Model tab, a schematic of two genealogies, and a
 * live example of two different histories with almost the same expected SFS.
 */

import { onThemeChange } from "./theme.ts";
import { Store } from "./state.ts";
import { Engine } from "../engine/client.ts";
import { computeSFS } from "../engine/compute.ts";
import { modelFromOverrides, Model } from "../engine/model.ts";
import { applyPreset, presetById } from "./presets.ts";
import { DOCS, REFERENCE_LIST } from "../generated/content.ts";
import { drawLines } from "./plots/lines.ts";
import { theme, newSvg } from "./plots/common.ts";
import { h, fmt, pct } from "./dom.ts";

/** The two histories of the "Limits of the SFS" example (found by a grid search; see CHANGELOG). */
export const LIMITS_PAIR: Record<"limits_A" | "limits_B", { label: string; model: Model }> = {
  limits_A: { label: "History A: exponential growth 1 → 10 over T = 0.1", model: modelFromOverrides({ mode: 1, n: [20, 20], ancestral: [{ nu: 10, T: 0.1, dyn: "exponential" }] }) },
  limits_B: { label: "History B: sudden expansion to 5.1, T = 0.075", model: modelFromOverrides({ mode: 1, n: [20, 20], ancestral: [{ nu: 5.1, T: 0.075, dyn: "sudden" }] }) },
};

export function mountLearnView(root: HTMLElement, store: Store, _engine: Engine, goModel: () => void): void {
  const learn = DOCS.learn;
  const toc = h("nav", { class: "toc", "aria-label": "Contents of this page" }, h("strong", {}, "Contents"), h("ol", {}, ...learn.sections.map((s) => h("li", {}, h("a", { href: `#${s.id}`, html: s.title })))), h("p", {}, h("a", { href: "#learn-references" }, "References")));
  const body = h(
    "article",
    { class: "prose" },
    h("h2", { style: "margin-top:0" }, "Learn: why history shapes the SFS"),
    h("div", { html: learn.intro }),
    ...learn.sections.map((s) => h("section", { id: s.id }, h("h2", { html: s.title }), h("div", { html: s.html }))),
    h(
      "section",
      { id: "learn-references" },
      h("h2", {}, "References"),
      h("p", { class: "muted" }, "All references were checked against Crossref (DOI), Open Library (ISBN) or the publisher before use."),
      ...REFERENCE_LIST.map((g) => h("div", {}, h("h3", {}, g.group), h("ul", { class: "refs" }, ...g.items.map((it) => h("li", { id: `ref-${it.key}`, html: it.html }))))),
    ),
  );
  root.append(h("div", { class: "learn-grid" }, toc, body));

  // preset buttons
  root.querySelectorAll<HTMLButtonElement>("button[data-preset]").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.dataset.preset!;
      if (id in LIMITS_PAIR) {
        const m = LIMITS_PAIR[id as keyof typeof LIMITS_PAIR].model;
        store.update((s) => {
          s.model = structuredClone(m);
          s.dynOn.exponential = true;
          s.dynOn.sudden = true;
        }, { structural: true, source: "learn" });
      } else {
        const p = presetById(id);
        if (!p) return;
        store.update((s) => applyPreset(s, p), { structural: true, source: "preset" });
      }
      goModel();
    }),
  );

  // figures (drawn again with the new colours when the theme changes)
  const drawFigures = (): void =>
    root.querySelectorAll<HTMLElement>("[data-figure]").forEach((el) => {
      el.replaceChildren();
      if (el.dataset.figure === "trees") drawTrees(el);
      if (el.dataset.figure === "limits") drawLimits(el);
    });
  drawFigures();
  onThemeChange(drawFigures);
}

/** Two schematic genealogies of 8 samples: star-like (growth) and long internal branches. */
function drawTrees(el: HTMLElement): void {
  const T = theme();
  const W = 620;
  const H = 250;
  const svg = newSvg(el, W, H, "Schematic genealogies: a star-like tree after growth, and a tree with long internal branches after a contraction or with structure.");
  const tips = 8;
  const panel = (x0: number, title: string, nodes: { a: number; b: number; t: number }[]): void => {
    const pw = 270;
    const top = 40;
    const base = H - 40;
    const xs = Array.from({ length: tips }, (_, k) => x0 + 15 + (k * (pw - 30)) / (tips - 1));
    const y = (t: number): number => base - t * (base - top);
    // nodes: merge cluster a and cluster b at time t (0..1); clusters are tracked by index
    const pos = new Map<number, { x: number; t: number; tips: number }>();
    xs.forEach((x, k) => pos.set(k, { x, t: 0, tips: 1 }));
    let id = tips;
    svg.append("text").attr("x", x0 + pw / 2).attr("y", 18).attr("text-anchor", "middle").attr("font-size", 12.5).attr("font-weight", 600).attr("fill", T.ink).text(title);
    for (const nd of nodes) {
      const A = pos.get(nd.a)!;
      const B = pos.get(nd.b)!;
      const xm = (A.x + B.x) / 2;
      for (const C of [A, B]) {
        const ext = C.tips === 1;
        svg
          .append("path")
          .attr("d", `M${C.x},${y(C.t)}V${y(nd.t)}H${xm}`)
          .attr("fill", "none")
          .attr("stroke", ext ? T.pop1 : T.pop2)
          .attr("stroke-width", ext ? 2.2 : 2.6);
      }
      pos.set(id++, { x: xm, t: nd.t, tips: A.tips + B.tips });
    }
    xs.forEach((x) => svg.append("circle").attr("cx", x).attr("cy", base + 6).attr("r", 3).attr("fill", T.ink2));
  };
  // star-like: all coalescences close together near the root
  panel(20, "After growth: star-like", [
    { a: 0, b: 1, t: 0.78 },
    { a: 2, b: 3, t: 0.8 },
    { a: 4, b: 5, t: 0.81 },
    { a: 6, b: 7, t: 0.83 },
    { a: 8, b: 9, t: 0.86 },
    { a: 10, b: 11, t: 0.88 },
    { a: 12, b: 13, t: 0.92 },
  ]);
  // long internal branches: quick coalescence in pairs, then long branches
  panel(330, "After a contraction, or with structure", [
    { a: 0, b: 1, t: 0.08 },
    { a: 2, b: 3, t: 0.1 },
    { a: 4, b: 5, t: 0.07 },
    { a: 6, b: 7, t: 0.11 },
    { a: 8, b: 9, t: 0.22 },
    { a: 10, b: 11, t: 0.25 },
    { a: 12, b: 13, t: 0.92 },
  ]);
  svg.append("line").attr("x1", 40).attr("x2", 56).attr("y1", H - 12).attr("y2", H - 12).attr("stroke", T.pop1).attr("stroke-width", 2.2);
  svg.append("text").attr("x", 60).attr("y", H - 8).attr("font-size", 11).attr("fill", T.ink2).text("external branch: its mutations are singletons");
  svg.append("line").attr("x1", 330).attr("x2", 346).attr("y1", H - 12).attr("y2", H - 12).attr("stroke", T.pop2).attr("stroke-width", 2.6);
  svg.append("text").attr("x", 350).attr("y", H - 8).attr("font-size", 11).attr("fill", T.ink2).text("internal branch: shared by several samples");
  el.append(h("p", { class: "muted", style: "font-size:0.85rem" }, "Time runs upwards (into the past). Mutations on the blue external branches give singletons; mutations on the orange internal branches give variants at higher frequencies."));
}

/** History A and history B, computed live: spectra (proportions) and their relative difference. */
function drawLimits(el: HTMLElement): void {
  const T = theme();
  const prop = (m: Model): number[] => {
    const x = computeSFS(m).sfs.data;
    const n = x.length - 1;
    let s = 0;
    for (let i = 1; i < n; i++) s += x[i];
    return Array.from({ length: n - 1 }, (_, k) => x[k + 1] / s);
  };
  const a = prop(LIMITS_PAIR.limits_A.model);
  const b = prop(LIMITS_PAIR.limits_B.model);
  const maxRel = Math.max(...a.map((v, k) => Math.abs(b[k] - v) / v));
  const box = h("div");
  el.append(box);
  drawLines(
    box,
    {
      title: "Expected SFS of two different histories (n = 20)",
      xLabel: "Derived allele count i",
      yLabel: "Proportion of SNPs",
      series: [
        { label: LIMITS_PAIR.limits_A.label, color: T.pop1, points: a.map((y, k) => ({ x: k + 1, y })) },
        { label: LIMITS_PAIR.limits_B.label, color: T.pulse, dash: "5 3", points: b.map((y, k) => ({ x: k + 1, y })) },
      ],
      yZero: true,
      height: 250,
    },
    Math.min(640, el.clientWidth || 600),
  );
  el.append(
    h(
      "p",
      { class: "muted", style: "font-size:0.85rem" },
      `The largest relative difference between the two spectra, over all bins, is ${pct(maxRel, 2)} (singletons: ${fmt(a[0], 4)} and ${fmt(b[0], 4)}). With thousands of SNPs, such a difference is far smaller than the sampling noise.`,
    ),
  );
}
