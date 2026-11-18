/**
 * Statistics of the expected SFS of the current model (model mode) and the compact panel next
 * to the SFS plot. Expected counts = theta × spectrum (theta = 4 N_ref mu L). Normalised
 * statistics (Tajima's D and the other tests, F_ST) are ratios of expectations.
 */

import { onePopStats, OnePopStats } from "../stats/onepop.ts";
import { twoPopStats, TwoPopStats, HetMode } from "../stats/twopop.ts";
import { NDArray } from "../engine/ndarray.ts";
import { Model } from "../engine/model.ts";
import { views, scale } from "../stats/sfsutil.ts";
import { AppState, theta as thetaOf, WcModelMode } from "./state.ts";
import { h, fmt, fixed, pct } from "./dom.ts";

export interface StatsBundle {
  mode: 1 | 2;
  theta: number;
  L: number;
  one: { key: "sample" | "pop1" | "pop2" | "pooled"; label: string; n: number; s: OnePopStats }[];
  two: TwoPopStats | null;
  hetMode: HetMode;
  hetLabel: string;
}

export function hetModeOf(mode: WcModelMode, m: Model): HetMode {
  if (mode === "haploid") return { kind: "haploid" };
  if (mode === "fis") return { kind: "fis", F: m.inbreeding.on ? [m.inbreeding.F[0], m.mode === 2 ? m.inbreeding.F[1] : 0] : [0, 0] };
  return { kind: "hwe" };
}

export function hetLabel(h: HetMode): string {
  if (h.kind === "hwe") return "HWE assumed: h̄ = 2p(1−p)·2k/(2k−1)";
  if (h.kind === "hwe-plain") return "HWE, h̄ = 2p(1−p)";
  if (h.kind === "haploid") return "haploid / pooled data (no h̄ term)";
  return `HWE off: F_IS = ${fmt(h.F[0], 2)} (pop 1), ${fmt(h.F[1], 2)} (pop 2)`;
}

export function modelStats(sfs: NDArray, model: Model, s: AppState): StatsBundle {
  const th = thetaOf(s.units);
  const L = s.units.L;
  const hm = hetModeOf(s.wcMode, model);
  if (model.mode === 1) {
    const x = scale(sfs.data, th);
    return { mode: 1, theta: th, L, one: [{ key: "sample", label: "Sample", n: x.length - 1, s: onePopStats(x) }], two: null, hetMode: hm, hetLabel: hetLabel(hm) };
  }
  const v = views(sfs);
  const [d1, d2] = sfs.shape;
  const one = [
    { key: "pop1" as const, label: "Pop 1", n: d1 - 1, s: onePopStats(scale(v.pop1.data, th)) },
    { key: "pop2" as const, label: "Pop 2", n: d2 - 1, s: onePopStats(scale(v.pop2.data, th)) },
    { key: "pooled" as const, label: "Pooled", n: d1 + d2 - 2, s: onePopStats(scale(v.pooled.data, th)) },
  ];
  const two = twoPopStats({ n1: d1 - 1, n2: d2 - 1, data: scale(sfs.data, th) }, hm);
  return { mode: 2, theta: th, L, one, two, hetMode: hm, hetLabel: hetLabel(hm) };
}

export const NEEDS_UNFOLDED = "Needs the unfolded SFS (an outgroup to polarise alleles).";

/** Compact statistics panel (next to the SFS plot). */
export function renderCompact(container: HTMLElement, b: StatsBundle, folded: boolean): void {
  const perSite = (x: number): string => fmt(x / b.L, 3);
  const cell = (val: string, needsUnfolded: boolean): HTMLElement =>
    folded && needsUnfolded ? h("td", { class: "na", title: NEEDS_UNFOLDED }, "n/a") : h("td", {}, val);
  const pops = b.mode === 1 ? b.one : b.one.slice(0, 2);
  const rows: [string, (s: OnePopStats) => string, boolean, string][] = [
    ["θ_W per site", (s) => perSite(s.thetaW), false, "Watterson's estimator: segregating sites / a_n."],
    ["θ_π per site", (s) => perSite(s.thetaPi), false, "Nucleotide diversity: mean number of differences between two sequences."],
    ["θ_H per site", (s) => perSite(s.thetaH), true, "Fay and Wu's θ_H: weighs high-frequency derived alleles."],
    ["Tajima's D", (s) => fixed(s.tajimaD), false, "(θ_π − θ_W) / sd. Negative: excess of rare variants."],
    ["Fu & Li's D*", (s) => fixed(s.fuLiDstar), false, "Compares singletons with all segregating sites (no outgroup needed)."],
    ["Fay & Wu's H (norm.)", (s) => fixed(s.zengH), true, "Normalised H of Zeng et al. (2006). Negative: excess of high-frequency derived alleles."],
    ["Zeng's E", (s) => fixed(s.zengE), true, "(θ_L − θ_W) / sd. Sensitive to high-frequency derived alleles relative to rare ones."],
  ];
  const head = h("tr", {}, h("th", { scope: "col" }, "Statistic"), ...pops.map((p) => h("th", { scope: "col" }, b.mode === 1 ? "Value" : p.label)));
  const body = rows.map(([name, f, uf, tip]) => h("tr", {}, h("th", { scope: "row", title: tip }, name), ...pops.map((p) => cell(f(p.s), uf))));
  const tables: HTMLElement[] = [h("table", { class: "stats-table" }, h("thead", {}, head), h("tbody", {}, ...body))];
  if (b.two) {
    const t = b.two;
    const seg = t.segregating;
    const r2: [string, string, string][] = [
      ["π₁, π₂ per site", `${perSite(t.pi1)}, ${perSite(t.pi2)}`, "Diversity within each population."],
      ["d_xy per site", perSite(t.dxy), "Mean number of differences between a sequence from pop 1 and one from pop 2."],
      ["d_a per site", perSite(t.da), "Net divergence: d_xy − (π₁ + π₂)/2."],
      ["F_ST (Hudson)", fixed(t.fstHudson, 3), "1 − mean within-population diversity / between-population diversity (ratio of averages)."],
      ["F_ST (Weir & Cockerham θ)", fixed(t.fstWC, 3), `Analysis-of-variance estimator; ${b.hetLabel}.`],
      ["Shared / private / fixed", `${pct(t.shared / seg, 0)} / ${pct((t.private1 + t.private2) / seg, 0)} / ${pct(t.fixed / seg, 1)}`, "Share of segregating sites in each category (Wakeley & Hey 1997)."],
    ];
    tables.push(h("table", { class: "stats-table" }, h("tbody", {}, ...r2.map(([a, v, tip]) => h("tr", {}, h("th", { scope: "row", title: tip }, a), h("td", {}, v))))));
  }
  container.replaceChildren(
    ...tables,
    h(
      "p",
      { class: "footnote" },
      `Expected values under the model (θ = ${fmt(b.theta)}, L = ${fmt(b.L)} sites). Tests and F_ST are ratios of expectations; linkage and sampling variance are ignored. `,
      h("a", { href: "#stats" }, "All statistics →"),
    ),
  );
}
