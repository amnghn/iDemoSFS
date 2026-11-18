/**
 * The Statistics tab (prompt Section 3A): statistics of the expected SFS of the current model
 * (model mode) or of an observed SFS (calculator mode), estimator weights, 2D weight heatmaps,
 * Hudson and Weir & Cockerham F_ST with their teaching plots, a parameter sweep, statistic
 * cards and the list of statistics that the SFS cannot give.
 */

import { Store, effectiveModel, theta as thetaOf, WcModelMode } from "./state.ts";
import { Engine } from "../engine/client.ts";
import { Model } from "../engine/model.ts";
import { NDArray, marginalize, fold, cornerMask } from "../engine/ndarray.ts";
import { LIMITS } from "../engine/limits.ts";
import type { ModelViewHandle } from "./modelView.ts";
import { onePopStats, OnePopStats, weights1D, FOLDED_OK, Estimator } from "../stats/onepop.ts";
import { twoPopStats, TwoPopStats, HetMode, weights2D, wcFromGenotypeCounts } from "../stats/twopop.ts";
import { parseDadi, parseRealSFS, parseMatrix, looksLikeDadi, looksFolded, cornerTotal, ParsedSFS } from "../stats/parsers.ts";
import { optimalScaling, poissonResidual, anscombeResidual, llMultinom } from "../stats/residuals.ts";
import { parsePopmap, parseGenotypeTable, parseHweFiles, GenotypeCounts } from "../stats/vcf.ts";
import { asND, scale, mafFilterJoint, projectJoint, neutralSFS, polyBins } from "../stats/sfsutil.ts";
import { hetModeOf, hetLabel, NEEDS_UNFOLDED } from "./modelStats.ts";
import { drawSfs1D } from "./plots/sfs1d.ts";
import { drawHeatmap } from "./plots/sfs2d.ts";
import { drawLines, tableLines, LineSeries } from "./plots/lines.ts";
import { theme } from "./plots/common.ts";
import { segmented, select, numberField, toggle } from "./widgets.ts";
import { DOCS } from "../generated/content.ts";
import { h, fmt, fixed, pct, setChildren, infoTip } from "./dom.ts";

// ---------------------------------------------------------------- data set

interface DataSet {
  label: string;
  shape: number[];
  data: Float64Array; // counts
  mask: Uint8Array;
  folded: boolean;
  L: number | null;
  notes: string[];
}

type DataWcMode = "hwe" | "fis" | "hobs" | "exact" | "haploid";

interface StatsUi {
  source: "model" | "data";
  data: DataSet | null;
  dataWc: DataWcMode;
  fis: [number, number];
  hobs: [number, number];
  genotypes: GenotypeCounts | null;
  residual: "anscombe" | "poisson";
  weightsView: "weights" | "contribution";
  estimators: Set<Estimator>;
  fstShow: "both" | "hudson" | "wc";
}

// ---------------------------------------------------------------- helpers

const doc = (file: string, id: string): string => DOCS[file]?.sections.find((s) => s.id === id)?.html ?? "";
const docTitle = (file: string, id: string): string => DOCS[file]?.sections.find((s) => s.id === id)?.title ?? id;

function card(title: string, ...body: (Node | null)[]): HTMLElement {
  return h("section", { class: "card" }, h("header", { class: "card-head" }, h("h2", {}, title)), ...body);
}

function oneStatsFor(shape: number[], data: Float64Array): { label: string; key: string; n: number; s: OnePopStats }[] {
  if (shape.length === 1) return [{ label: "Sample", key: "sample", n: shape[0] - 1, s: onePopStats(data) }];
  const nd = asND(shape, data);
  return [
    { label: "Pop 1", key: "pop1", n: shape[0] - 1, s: onePopStats(marginalize(nd, 1).data) },
    { label: "Pop 2", key: "pop2", n: shape[1] - 1, s: onePopStats(marginalize(nd, 0).data) },
  ];
}

const ONE_ROWS: { key: keyof OnePopStats; label: string; theta: boolean; needsUnfolded: boolean; tip: string }[] = [
  { key: "S", label: "Segregating sites S", theta: true, needsUnfolded: false, tip: "Σ ξᵢ" },
  { key: "thetaW", label: "Watterson's θ_W", theta: true, needsUnfolded: false, tip: "S / aₙ (Watterson 1975)" },
  { key: "thetaPi", label: "θ_π (nucleotide diversity π)", theta: true, needsUnfolded: false, tip: "Σ i(n−i) ξᵢ / C(n,2) (Tajima 1983)" },
  { key: "thetaH", label: "θ_H", theta: true, needsUnfolded: true, tip: "Σ i² ξᵢ / C(n,2) (Fay & Wu 2000)" },
  { key: "thetaL", label: "θ_L", theta: true, needsUnfolded: true, tip: "Σ i ξᵢ / (n−1) (Zeng et al. 2006)" },
  { key: "thetaXi1", label: "θ_ξ₁ (derived singletons)", theta: true, needsUnfolded: true, tip: "ξ₁ (Fu & Li 1993)" },
  { key: "thetaEta", label: "θ_η (folded singletons)", theta: true, needsUnfolded: false, tip: "(n−1)/n · (ξ₁ + ξₙ₋₁) (Fu & Li 1993)" },
  { key: "tajimaD", label: "Tajima's D", theta: false, needsUnfolded: false, tip: "(θ_π − θ_W) / sd (Tajima 1989)" },
  { key: "fuLiD", label: "Fu & Li's D", theta: false, needsUnfolded: true, tip: "With an outgroup (Fu & Li 1993)" },
  { key: "fuLiF", label: "Fu & Li's F", theta: false, needsUnfolded: true, tip: "With an outgroup; corrected variance (Simonsen et al. 1995)" },
  { key: "fuLiDstar", label: "Fu & Li's D*", theta: false, needsUnfolded: false, tip: "Without an outgroup (Fu & Li 1993)" },
  { key: "fuLiFstar", label: "Fu & Li's F*", theta: false, needsUnfolded: false, tip: "Without an outgroup; corrected variance (Simonsen et al. 1995)" },
  { key: "fayWuH", label: "Fay & Wu's H (raw)", theta: true, needsUnfolded: true, tip: "θ_π − θ_H (Fay & Wu 2000)" },
  { key: "zengH", label: "Fay & Wu's H (normalised)", theta: false, needsUnfolded: true, tip: "(θ_π − θ_L) / sd (Zeng et al. 2006)" },
  { key: "zengE", label: "Zeng's E", theta: false, needsUnfolded: true, tip: "(θ_L − θ_W) / sd (Zeng et al. 2006)" },
];

// ---------------------------------------------------------------- view

export function mountStatsView(root: HTMLElement, store: Store, engine: Engine, model: ModelViewHandle): void {
  const ui: StatsUi = {
    source: "model",
    data: null,
    dataWc: "hwe",
    fis: [0, 0],
    hobs: [NaN, NaN],
    genotypes: null,
    residual: "anscombe",
    weightsView: "weights",
    estimators: new Set<Estimator>(["thetaW", "thetaPi", "thetaH", "thetaL"]),
    fstShow: "both",
  };
  const sweepEngine = new Engine();

  const left = h("div", { class: "stack" });
  const right = h("div", { class: "stack" });
  root.append(
    h("div", { class: "prose" }, h("h2", { style: "margin-top:0" }, "Statistics from the SFS"), h("div", { html: DOCS.stats?.intro ?? "" })),
    h("div", { class: "stats-grid" }, left, right),
  );

  // left column cards
  const sourceBody = h("div");
  const wcBody = h("div");
  left.append(card("Source of the spectrum", sourceBody), card("Weir & Cockerham: heterozygosity", wcBody), h("section", { class: "card box warn prose", id: "stats-cannot", html: `<h3>${docTitle("stats", "cannot")}</h3>${doc("stats", "cannot")}` }));

  // right column cards
  const tableBody = h("div");
  const compareCard = card("Model and data", h("div"));
  const weightsBody = h("div");
  const w2Body = h("div");
  const fstBody = h("div");
  const sweepBody = h("div");
  const cardsBody = h("div", { class: "cards" });
  const w2Card = card("Which parts of the joint SFS drive each statistic?", h("div", { class: "prose", html: doc("stats", "weights-2d") }), w2Body);
  const fstCard = card("Two F_ST estimators: Hudson and Weir & Cockerham", fstBody);
  right.append(
    card("Statistics", tableBody),
    compareCard,
    card("Estimator weights", h("div", { class: "prose", html: doc("stats", "weights") }), weightsBody),
    w2Card,
    fstCard,
    card("Parameter sweep", h("div", { class: "prose", html: doc("stats", "sweep") }), sweepBody),
    card("What does this statistic tell me?", cardsBody),
  );

  // statistic cards (static)
  for (const s of DOCS.stats?.sections ?? []) if (s.id.startsWith("card-")) cardsBody.append(h("article", { class: "stat-card", id: `stats-${s.id}` }, h("h3", { html: s.title }), h("div", { html: s.html })));

  // ---------------------------------------------------------------- current spectrum
  interface Current {
    mode: "model" | "data";
    shape: number[];
    counts: Float64Array; // counts (model: theta × spectrum)
    mask: Uint8Array;
    folded: boolean;
    L: number | null;
    hm: HetMode;
    hmLabel: string;
    model: Model | null;
    thetaModel: number;
  }

  function dataHetMode(d: DataSet): { hm: HetMode; label: string; exact: boolean } {
    if (ui.dataWc === "haploid") return { hm: { kind: "haploid" }, label: hetLabel({ kind: "haploid" }), exact: false };
    if (ui.dataWc === "fis") return { hm: { kind: "fis", F: ui.fis }, label: hetLabel({ kind: "fis", F: ui.fis }), exact: false };
    if (ui.dataWc === "hobs") {
      // F_IS = 1 - H_obs / H_exp, with H_exp from the data (expected heterozygosity per site, averaged over polymorphic sites)
      const F = [0, 1].map((q) => {
        const he = expectedHet(d, q as 0 | 1);
        return Number.isFinite(ui.hobs[q]) && he > 0 ? 1 - ui.hobs[q] / he : 0;
      }) as [number, number];
      return { hm: { kind: "fis", F }, label: `HWE off: F_IS from H_obs (${fmt(F[0], 2)}, ${fmt(F[1], 2)})`, exact: false };
    }
    return { hm: { kind: "hwe" }, label: hetLabel({ kind: "hwe" }), exact: ui.dataWc === "exact" };
  }

  /** Mean expected heterozygosity per site (all L sites, or per segregating site without L). */
  function expectedHet(d: DataSet, q: 0 | 1): number {
    const nd = asND(d.shape, d.data);
    const x = d.shape.length === 1 ? nd.data : marginalize(nd, q === 0 ? 1 : 0).data;
    const n = x.length - 1;
    let num = 0;
    let den = 0;
    for (let i = 1; i < n; i++) {
      const p = i / n;
      num += x[i] * 2 * p * (1 - p) * (n / (n - 1));
      den += x[i];
    }
    return d.L ? num / d.L : den > 0 ? num / den : NaN;
  }

  function current(): Current | null {
    const s = store.get();
    if (ui.source === "data") {
      if (!ui.data) return null;
      const d = ui.data;
      const { hm, label } = dataHetMode(d);
      return { mode: "data", shape: d.shape, counts: d.data, mask: d.mask, folded: d.folded, L: d.L, hm, hmLabel: label, model: null, thetaModel: NaN };
    }
    const last = model.latest();
    if (!last) return null;
    const th = thetaOf(s.units);
    const hm = hetModeOf(s.wcMode, last.model);
    const counts = scale(last.result.data, th);
    let mask = cornerMask(last.result.shape);
    let c = counts;
    if (s.display.folded) {
      const f = fold(asND(last.result.shape, counts), mask);
      c = f.data;
      mask = f.mask;
    }
    return { mode: "model", shape: last.result.shape, counts: c, mask, folded: s.display.folded, L: s.units.L, hm, hmLabel: hetLabel(hm), model: last.model, thetaModel: th };
  }

  // ---------------------------------------------------------------- source panel
  const fileInput = h("input", { type: "file", accept: ".fs,.sfs,.txt,.csv,.tsv,.ml,.obs", "aria-label": "Spectrum file" }) as HTMLInputElement;
  const paste = h("textarea", { placeholder: "…or paste a spectrum here (dadi/moments .fs, easySFS output, ANGSD realSFS or a plain matrix)", "aria-label": "Spectrum text" }) as HTMLTextAreaElement;
  let fmtChoice: "auto" | "dadi" | "realsfs" | "matrix" = "auto";
  let npops: "1" | "2" = "2";
  let nIn: [number, number] = [20, 20];
  let foldedIn = false;
  let realUse: "first" | "mean" = "first";
  let Lin: number | null = null;
  let useCornersForL = true;
  let lastParsed: ParsedSFS | null = null;
  const msg = h("div", { class: "hint", "aria-live": "polite" });

  function readData(text: string, label: string): void {
    try {
      let p: ParsedSFS;
      const fmtUse = fmtChoice === "auto" ? (looksLikeDadi(text) ? "dadi" : null) : fmtChoice;
      if (fmtUse === null) throw new Error("the format could not be recognised; please choose it (realSFS needs the sample sizes)");
      if (fmtUse === "dadi") p = parseDadi(text);
      else if (fmtUse === "realsfs") p = parseRealSFS(text, npops === "1" ? [nIn[0]] : nIn, realUse);
      else p = parseMatrix(text);
      if (p.format !== "dadi") {
        p.folded = foldedIn || looksFolded(p);
        if (p.folded) {
          const f = fold(asND(p.shape, p.data), p.mask);
          p.data = f.data;
          p.mask = f.mask;
        }
      }
      lastParsed = p;
      const corners = cornerTotal(p);
      let L: number | null = Lin;
      const notes = [...p.notes];
      if (corners > 0 && useCornersForL && Lin === null) {
        L = p.data.reduce((a, v) => a + v, 0);
        notes.push(`L is taken from the file: the sum of all bins, including the monomorphic bins, is ${fmt(L)}.`);
      }
      if (L === null) notes.push("Without L (the total number of sites, including monomorphic sites), only per-dataset values are shown; per-site values need L.");
      ui.data = { label, shape: p.shape, data: p.data, mask: p.mask, folded: p.folded, L, notes };
      ui.source = "data";
      buildSource();
      refresh();
    } catch (e) {
      msg.replaceChildren(h("p", { class: "error" }, `The spectrum could not be read: ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) {
      msg.replaceChildren(h("p", { class: "error" }, "This file is larger than 20 MB; an SFS file is usually much smaller."));
      return;
    }
    readData(await f.text(), f.name);
  });

  function buildSource(): void {
    const s = store.get();
    const parts: (Node | null)[] = [
      segmented("src", "Statistics of", [{ value: "model", label: "the current model" }, { value: "data", label: "my data (calculator)" }], ui.source, (v) => {
        ui.source = v;
        buildSource();
        buildWc();
        refresh();
      }),
    ];
    if (ui.source === "model") {
      parts.push(
        h(
          "p",
          { class: "hint" },
          `Expected SFS of the current model × θ = ${fmt(thetaOf(s.units))} (θ = 4·N_ref·μ·L with L = ${fmt(s.units.L)} sites; change these under "Physical units and θ" in the Model tab). `,
          h("a", { href: "#model" }, "Change the model"),
        ),
      );
    } else {
      parts.push(
        h("div", { class: "file-row" }, fileInput),
        paste,
        h("div", { class: "file-row" }, h("button", { type: "button", class: "btn primary", onclick: () => paste.value.trim() && readData(paste.value, "pasted spectrum") }, "Read the pasted text")),
        select(
          "fmt",
          "Format",
          [
            { value: "auto", label: "Detect (dadi/moments .fs header)" },
            { value: "dadi", label: "dadi/moments .fs or easySFS (dadi format)" },
            { value: "realsfs", label: "ANGSD realSFS (one spectrum per line)" },
            { value: "matrix", label: "Plain matrix (rows = pop 1, columns = pop 2)" },
          ],
          fmtChoice,
          (v) => {
            fmtChoice = v;
            buildSource();
          },
        ),
        fmtChoice === "realsfs"
          ? h(
              "div",
              {},
              segmented("npops", "Populations", [{ value: "1", label: "One" }, { value: "2", label: "Two" }], npops, (v) => {
                npops = v;
                buildSource();
              }),
              h(
                "div",
                { class: "grid2" },
                numberField("n1", "n, pop 1 (haploid)", nIn[0], (v) => (nIn[0] = Math.round(v)), { min: 2 }),
                npops === "2" ? numberField("n2", "n, pop 2 (haploid)", nIn[1], (v) => (nIn[1] = Math.round(v)), { min: 2 }) : null,
              ),
              segmented("realuse", "Several lines (bootstrap replicates)", [{ value: "first", label: "Use the first" }, { value: "mean", label: "Use the mean" }], realUse, (v) => (realUse = v)),
              h("p", { class: "hint" }, "realSFS writes (n₁ + 1)(n₂ + 1) numbers per line, row-major with pop 1 as rows (as moments.Spectrum.from_angsd). If the ancestral state was the reference genome (-anc ref), fold the spectrum."),
            )
          : null,
        fmtChoice !== "dadi" && fmtChoice !== "auto" ? toggle("foldedin", "The spectrum is folded", foldedIn, (v) => (foldedIn = v)) : null,
        numberField("Lin", "Total number of sites L (optional)", Lin ?? NaN, (v) => (Lin = v > 0 ? v : null), {
          min: 0,
          info: "All sites that could have been polymorphic, including monomorphic sites. If the file has the monomorphic corner bins (as realSFS output does), L can be taken from it.",
        }),
        toggle("useCorners", "Use the monomorphic bins of the file for L", useCornersForL, (v) => (useCornersForL = v)),
        msg,
      );
      if (ui.data) {
        const d = ui.data;
        const S = d.data.reduce((a, v, k) => a + (d.mask[k] ? 0 : v), 0);
        msg.replaceChildren(
          h("p", {}, h("strong", {}, d.label), `: ${d.shape.length === 1 ? `1D, n = ${d.shape[0] - 1}` : `2D, n₁ = ${d.shape[0] - 1}, n₂ = ${d.shape[1] - 1}`}, ${d.folded ? "folded" : "unfolded"}, ${fmt(S)} sites in unmasked bins${d.L ? `, L = ${fmt(d.L)}` : ""}.`),
          ...d.notes.map((n) => h("p", {}, n)),
        );
      }
      if (lastParsed?.popNames) msg.append(h("p", {}, `Population names in the file: ${lastParsed.popNames.join(", ")}.`));
    }
    sourceBody.replaceChildren(...parts.filter((x): x is Node => x !== null));
  }

  // ---------------------------------------------------------------- WC options
  function buildWc(): void {
    const s = store.get();
    const parts: (Node | null)[] = [];
    if (ui.source === "model") {
      parts.push(
        segmented<WcModelMode>(
          "wc-model",
          "Heterozygosity term h̄",
          [
            { value: "hwe", label: "Assume HWE" },
            { value: "fis", label: "F_IS from the inbreeding toggle" },
            { value: "haploid", label: "Haploid" },
          ],
          s.wcMode,
          (v) => store.update((st) => (st.wcMode = v), { source: "display" }),
        ),
        h("p", { class: "hint" }, s.wcMode === "fis" ? (s.model.inbreeding.on ? `F_IS = F of the model (${fmt(s.model.inbreeding.F[0], 2)}${s.model.mode === 2 ? `, ${fmt(s.model.inbreeding.F[1], 2)}` : ""}).` : "Inbreeding is off in the model, so F_IS = 0 (the same as HWE).") : ""),
      );
    } else {
      parts.push(
        select<DataWcMode>(
          "wc-data",
          "Heterozygosity term h̄",
          [
            { value: "hwe", label: "Assume Hardy–Weinberg proportions" },
            { value: "fis", label: "HWE off: give F_IS per population" },
            { value: "hobs", label: "HWE off: give the observed heterozygosity H_obs" },
            { value: "exact", label: "HWE off, exact: per-site genotype counts or a VCF" },
            { value: "haploid", label: "Haploid or pooled data (no h̄ term)" },
          ],
          ui.dataWc,
          (v) => {
            ui.dataWc = v;
            buildWc();
            refresh();
          },
        ),
      );
      if (ui.dataWc === "fis")
        parts.push(
          h(
            "div",
            { class: "grid2" },
            numberField("fis1", "F_IS, pop 1", ui.fis[0], (v) => ((ui.fis[0] = v), refresh()), { min: -1, max: 1 }),
            numberField("fis2", "F_IS, pop 2", ui.fis[1], (v) => ((ui.fis[1] = v), refresh()), { min: -1, max: 1 }),
          ),
        );
      if (ui.dataWc === "hobs")
        parts.push(
          h(
            "div",
            { class: "grid2" },
            numberField("hobs1", "H_obs per site, pop 1", ui.hobs[0], (v) => ((ui.hobs[0] = v), refresh()), { min: 0, max: 1 }),
            numberField("hobs2", "H_obs per site, pop 2", ui.hobs[1], (v) => ((ui.hobs[1] = v), refresh()), { min: 0, max: 1 }),
          ),
          h("p", { class: "hint" }, "F_IS = 1 − H_obs / H_exp, with H_exp the mean expected heterozygosity per site computed from the spectrum (per L sites when L is given)."),
        );
      if (ui.dataWc === "exact") parts.push(exactPanel());
    }
    parts.push(
      h(
        "div",
        { class: "prose", html: doc("stats", "hwe-note") },
      ),
    );
    wcBody.replaceChildren(...parts.filter((x): x is Node => x !== null));
  }

  function exactPanel(): HTMLElement {
    const vcfIn = h("input", { type: "file", accept: ".vcf,.vcf.gz,.gz", "aria-label": "VCF file" }) as HTMLInputElement;
    const popmapIn = h("textarea", { placeholder: "Population map: one line per sample, 'sample<TAB>population' (two population labels)", "aria-label": "Population map" }) as HTMLTextAreaElement;
    const tableIn = h("input", { type: "file", accept: ".txt,.tsv,.csv", "aria-label": "Genotype count table" }) as HTMLInputElement;
    const hwe1 = h("input", { type: "file", accept: ".hwe,.txt", "aria-label": "vcftools --hardy output for pop 1" }) as HTMLInputElement;
    const hwe2 = h("input", { type: "file", accept: ".hwe,.txt", "aria-label": "vcftools --hardy output for pop 2" }) as HTMLInputElement;
    const out = h("div", { class: "hint", "aria-live": "polite" });
    const show = (g: GenotypeCounts, how: string): void => {
      ui.genotypes = g;
      const sk = Object.entries(g.skipped)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${v} ${k}`)
        .join(", ");
      out.replaceChildren(h("p", {}, `${how}: ${g.sites} sites${Number.isFinite(g.samples[0]) ? ` (${g.samples[0]} and ${g.samples[1]} individuals)` : ""}.${sk ? ` Skipped: ${sk}.` : ""}`));
      refresh();
    };
    const fail = (e: unknown): void => {
      out.replaceChildren(h("p", { class: "error" }, e instanceof Error ? e.message : String(e)));
    };
    vcfIn.addEventListener("change", async () => {
      const f = vcfIn.files?.[0];
      if (!f) return;
      if (f.size > 50 * 1024 * 1024) return fail(new Error("The VCF is larger than 50 MB. Please make a smaller file (for example one chromosome, or thinned sites)."));
      try {
        const pm = parsePopmap(popmapIn.value);
        out.replaceChildren(h("p", {}, "Reading the VCF in the background…"));
        const r = await engine.vcf(await f.arrayBuffer(), /\.gz$/i.test(f.name), pm.map);
        show(r, `VCF (${pm.labels[0]} = pop 1, ${pm.labels[1]} = pop 2)`);
      } catch (e) {
        fail(e);
      }
    });
    tableIn.addEventListener("change", async () => {
      const f = tableIn.files?.[0];
      if (!f) return;
      try {
        show(parseGenotypeTable(await f.text()), "Genotype table");
      } catch (e) {
        fail(e);
      }
    });
    const tryHwe = async (): Promise<void> => {
      const a = hwe1.files?.[0];
      const b = hwe2.files?.[0];
      if (!a || !b) return;
      try {
        show(parseHweFiles(await a.text(), await b.text()), "vcftools --hardy files");
      } catch (e) {
        fail(e);
      }
    };
    hwe1.addEventListener("change", tryHwe);
    hwe2.addEventListener("change", tryHwe);
    if (ui.genotypes) show(ui.genotypes, "Loaded");
    return h(
      "div",
      {},
      h("p", { class: "hint" }, "The exact option uses genotypes, not the SFS alone. Give one of:"),
      h("p", {}, h("strong", {}, "A VCF"), " (at most 50 MB; .vcf or .vcf.gz; read in your browser only) and a population map:"),
      vcfIn,
      popmapIn,
      h("p", {}, h("strong", {}, "A genotype count table"), ": one line per site with hom-ref, het and hom-alt counts for pop 1, then for pop 2 (6 numbers)."),
      tableIn,
      h("p", {}, h("strong", {}, "Two vcftools --hardy files"), " (one per population, made with --keep):"),
      h("div", { class: "file-row" }, hwe1, hwe2),
      out,
    );
  }

  // ---------------------------------------------------------------- statistics table
  function renderTable(c: Current): void {
    const ones = oneStatsFor(c.shape, c.counts);
    const L = c.L;
    const pops = ones;
    const cellOf = (v: number, isTheta: boolean, na: boolean): HTMLElement[] => {
      if (na) return [h("td", { class: "na", title: NEEDS_UNFOLDED }, "n/a"), ...(L ? [h("td", { class: "na", title: NEEDS_UNFOLDED }, "n/a")] : [])];
      if (!isTheta) return [h("td", {}, fixed(v, 3)), ...(L ? [h("td", {}, "")] : [])];
      return [h("td", {}, fmt(v, 4)), ...(L ? [h("td", {}, fmt(v / L, 3))] : [])];
    };
    const head = h(
      "tr",
      {},
      h("th", { scope: "col" }, "Statistic"),
      ...pops.flatMap((p) => [h("th", { scope: "col" }, `${p.label}${L ? ", per dataset" : ""}`), ...(L ? [h("th", { scope: "col" }, "per site")] : [])]),
    );
    const rows = ONE_ROWS.map((r) =>
      h(
        "tr",
        {},
        h("th", { scope: "row", title: r.tip }, r.label),
        ...pops.flatMap((p) => cellOf(p.s[r.key] as number, r.theta, c.folded && r.needsUnfolded)),
      ),
    );
    const parts: Node[] = [h("div", { class: "table-wrap", style: "max-height:none" }, h("table", { class: "stats-table" }, h("thead", {}, head), h("tbody", {}, ...rows)))];
    if (c.shape.length === 2) {
      const t = twoPopStats({ n1: c.shape[0] - 1, n2: c.shape[1] - 1, data: c.counts }, c.hm);
      const exact = ui.source === "data" && ui.dataWc === "exact" && ui.genotypes ? wcFromGenotypeCounts(chunk(ui.genotypes.counts)) : null;
      parts.push(twoTable(t, L, c.hmLabel, exact));
    }
    if (!L) parts.push(h("p", { class: "warning" }, "No L given: values are per dataset (θ, not θ per site)."));
    parts.push(
      h(
        "p",
        { class: "footnote" },
        c.mode === "model"
          ? "Model mode: expected values under the model. Normalised statistics (tests, F_ST) are ratios of expectations, not expected values over loci. Linkage and sampling variance are ignored."
          : "Calculator mode: values from the observed spectrum. No p-values are given: the expected values of the model ignore linkage and sampling variance.",
      ),
    );
    setChildren(tableBody, ...parts);
  }

  function chunk(a: Float64Array): Float64Array[] {
    const out: Float64Array[] = [];
    for (let k = 0; k + 6 <= a.length; k += 6) out.push(a.subarray(k, k + 6));
    return out;
  }

  function twoTable(t: TwoPopStats, L: number | null, hmLabel: string, exact: { fstWC: number; fisWC: number; fitWC: number } | null): HTMLElement {
    const ps = (x: number): string => (L ? `${fmt(x, 4)} (${fmt(x / L, 3)} per site)` : fmt(x, 4));
    const seg = t.segregating;
    const rows: [string, string, string][] = [
      ["π₁ / π₂", `${ps(t.pi1)} / ${ps(t.pi2)}`, "Diversity within each population (θ_π of each margin)."],
      ["d_xy", ps(t.dxy), "Σ ξᵢⱼ [i(n₂−j) + j(n₁−i)] / (n₁n₂) (Nei & Li 1979; Nei 1987)."],
      ["d_a", ps(t.da), "d_xy − (π₁ + π₂)/2 (Nei & Li 1979)."],
      ["F_ST, Hudson", fixed(t.fstHudson, 4), "1 − [(π₁+π₂)/2] / d_xy as a ratio of averages (Hudson et al. 1992; Bhatia et al. 2013). The HWE option does not change it."],
      ["F_ST, tskit definition", fixed(t.fstTskit, 4), "1 − 2(π₁ + π₂)/(π₁ + 2d_xy + π₂), as tskit's Fst (Ralph et al. 2020). Shown for comparison."],
      ["F_ST, Weir & Cockerham θ", `${fixed(t.fstWC, 4)}`, `Σa / Σ(a+b+c) over sites (Weir & Cockerham 1984). ${hmLabel}.`],
      ["F_IS, Weir & Cockerham", Number.isFinite(t.fisWC) ? fixed(t.fisWC, 4) : "–", "1 − Σc / Σ(b+c). Defined when h̄ is known."],
      ["F_IT, Weir & Cockerham", Number.isFinite(t.fitWC) ? fixed(t.fitWC, 4) : "–", "1 − Σc / Σ(a+b+c)."],
      ["f₂", ps(t.f2), "Mean squared allele-frequency difference, bias-corrected (Peter 2016)."],
      ["Fixed differences", `${fmt(t.fixed)} (${pct(t.fixed / seg, 1)})`, "ξ(n₁,0) + ξ(0,n₂). The direction is lost when folded."],
      ["Shared polymorphisms", `${fmt(t.shared)} (${pct(t.shared / seg, 1)})`, "Sites polymorphic in both samples."],
      ["Private to pop 1 / pop 2", `${fmt(t.private1)} / ${fmt(t.private2)} (${pct((t.private1 + t.private2) / seg, 1)})`, "Polymorphic in one sample only (Wakeley & Hey 1997)."],
    ];
    const body = rows.map(([a, v, tip]) => h("tr", {}, h("th", { scope: "row" }, a, infoTip(tip)), h("td", {}, v)));
    if (exact)
      body.push(
        h("tr", {}, h("th", { scope: "row" }, "WC θ, exact (genotypes)", infoTip("From the per-site genotype counts; this option no longer uses the SFS alone.")), h("td", {}, fixed(exact.fstWC, 4))),
        h("tr", {}, h("th", { scope: "row" }, "WC F_IS / F_IT, exact (genotypes)"), h("td", {}, `${fixed(exact.fisWC, 4)} / ${fixed(exact.fitWC, 4)}`)),
      );
    return h("div", {}, h("h3", { class: "mode-label" }, "Two populations"), h("table", { class: "stats-table" }, h("tbody", {}, ...body)), h("p", { class: "footnote" }, `Weir & Cockerham option in use: ${hmLabel}.`));
  }

  // ---------------------------------------------------------------- model vs data
  function renderCompare(c: Current | null): void {
    const body = compareCard.lastElementChild as HTMLElement;
    compareCard.hidden = ui.source !== "data";
    if (ui.source !== "data" || !c) return;
    const s = store.get();
    const last = model.latest();
    if (!last) return;
    const mShape = last.result.shape;
    const same = mShape.length === c.shape.length && mShape.every((d, k) => d === c.shape[k]);
    if (!same) {
      const nMax = c.shape.length === 1 ? LIMITS.n1D.max : LIMITS.n2D.max;
      const fits = c.shape.every((d) => d - 1 <= nMax);
      setChildren(
        body,
        h("p", {}, `The model's spectrum has shape ${mShape.map((d) => d - 1).join(" × ")} (sample sizes); the data have ${c.shape.map((d) => d - 1).join(" × ")}.`),
        fits
          ? h(
              "button",
              {
                type: "button",
                class: "btn",
                onclick: () =>
                  store.update((st) => {
                    st.model.mode = c.shape.length as 1 | 2;
                    st.model.n = [c.shape[0] - 1, c.shape.length === 2 ? c.shape[1] - 1 : st.model.n[1]];
                  }, { structural: true, source: "stats" }),
              },
              "Use the data's sample sizes in the model",
            )
          : h("p", { class: "hint" }, `The data's sample sizes are above the app's limit (${nMax} per population), so the model cannot be compared directly. Project the data to smaller sample sizes first (for example with moments or easySFS).`),
      );
      return;
    }
    // model in counts, folded like the data
    let mdl: Float64Array = Float64Array.from(last.result.data);
    let mmask = cornerMask(mShape);
    if (c.folded) {
      const f = fold(asND(mShape, mdl), mmask);
      mdl = f.data;
      mmask = f.mask;
    }
    const mask = new Uint8Array(mdl.length);
    for (let k = 0; k < mask.length; k++) mask[k] = mmask[k] || c.mask[k] ? 1 : 0;
    const k0 = optimalScaling(mdl, c.counts, mask);
    const scaled = scale(mdl, k0);
    const resid = ui.residual === "anscombe" ? anscombeResidual(scaled, c.counts, mask) : poissonResidual(scaled, c.counts, mask);
    const ll = llMultinom(mdl, c.counts, mask);
    const T = theme();
    const parts: Node[] = [
      h(
        "div",
        { class: "file-row" },
        segmented("resid", "Residuals", [{ value: "anscombe", label: "Anscombe" }, { value: "poisson", label: "Poisson" }], ui.residual, (v) => {
          ui.residual = v;
          refresh();
        }, "As in dadi and moments: the model is first scaled optimally to the data. Positive residual: the model is higher than the data."),
      ),
      h("p", { class: "hint" }, `Optimal scaling: θ̂ = ${fmt(k0)} (the model's θ that fits the data's total). Multinomial log-likelihood (moments ll_multinom): ${fmt(ll, 6)}. No p-values are given.`),
    ];
    if (c.shape.length === 1) {
      const plotEl = h("div", { class: "plot-box" });
      const resEl = h("div", { class: "plot-box" });
      parts.push(plotEl, resEl);
      setChildren(body, ...parts);
      drawSfs1D(
        plotEl,
        {
          model: { x: scaled, scale: 1, label: "model (scaled to the data)" },
          modelColor: T.pop1,
          folded: c.folded,
          yUnit: s.display.yUnit,
          yLog: s.display.yLog,
          neutral: s.display.neutral,
          ratio: s.display.ratio,
          theta: k0,
          observed: { x: c.counts, scale: 1, label: "data" },
          title: "Model and data",
        },
        Math.min(640, plotEl.clientWidth || 560),
      );
      const bins = polyBins(resid, false).bins.filter((i) => !c.folded || i <= Math.floor((c.shape[0] - 1) / 2));
      drawLines(
        resEl,
        { title: `${ui.residual === "anscombe" ? "Anscombe" : "Poisson"} residuals`, xLabel: c.folded ? "Minor allele count" : "Derived allele count", yLabel: "Residual", series: [{ label: "residual", color: T.ink2, points: bins.map((i) => ({ x: i, y: resid[i] })) }], refLine: 0, legend: false },
        Math.min(640, resEl.clientWidth || 560),
      );
    } else {
      const grid = h("div", { class: "multiples" });
      const boxes = [h("div"), h("div"), h("div")];
      grid.append(...boxes);
      parts.push(grid);
      setChildren(body, ...parts);
      const sh = c.shape as [number, number];
      drawHeatmap(boxes[0], { shape: sh, values: c.counts, mask, kind: "log", title: "Data", valueLabel: "sites", compact: true, size: 220 }, 300);
      drawHeatmap(boxes[1], { shape: sh, values: scaled, mask, kind: "log", title: "Model (scaled)", valueLabel: "sites", compact: true, size: 220 }, 300);
      drawHeatmap(boxes[2], { shape: sh, values: resid, mask: Uint8Array.from(resid, (v, k) => (mask[k] || !Number.isFinite(v) ? 1 : 0)), kind: "diverging", title: "Residuals", valueLabel: "residual", compact: true, size: 220 }, 300);
    }
    // statistics: observed vs expected (model scaled to the data)
    const obs = oneStatsFor(c.shape, c.counts);
    const exp = oneStatsFor(c.shape, scale(last.result.data, k0));
    const rows = ONE_ROWS.filter((r) => ["thetaW", "thetaPi", "thetaH", "tajimaD", "fuLiDstar", "zengH", "zengE"].includes(r.key as string));
    const tb = h("tbody");
    for (const r of rows)
      for (let q = 0; q < obs.length; q++) {
        const na = c.folded && r.needsUnfolded;
        tb.append(
          h(
            "tr",
            {},
            h("th", { scope: "row" }, `${r.label}${obs.length > 1 ? `, ${obs[q].label}` : ""}`),
            h("td", {}, na ? "n/a" : r.theta ? fmt(obs[q].s[r.key] as number, 4) : fixed(obs[q].s[r.key] as number, 3)),
            h("td", {}, na ? "n/a" : r.theta ? fmt(exp[q].s[r.key] as number, 4) : fixed(exp[q].s[r.key] as number, 3)),
          ),
        );
      }
    if (c.shape.length === 2) {
      const to = twoPopStats({ n1: c.shape[0] - 1, n2: c.shape[1] - 1, data: c.counts }, c.hm);
      const te = twoPopStats({ n1: c.shape[0] - 1, n2: c.shape[1] - 1, data: scale(last.result.data, k0) }, c.hm);
      for (const [lab, a, b] of [
        ["d_xy", to.dxy, te.dxy],
        ["F_ST, Hudson", to.fstHudson, te.fstHudson],
        ["F_ST, WC θ", to.fstWC, te.fstWC],
      ] as [string, number, number][])
        tb.append(h("tr", {}, h("th", { scope: "row" }, lab), h("td", {}, fmt(a, 4)), h("td", {}, fmt(b, 4))));
    }
    body.append(
      h("h3", { class: "mode-label" }, "Observed and expected statistics"),
      h("table", { class: "stats-table" }, h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Statistic"), h("th", { scope: "col" }, "Observed"), h("th", { scope: "col" }, "Expected (model × θ̂)"))), tb),
      h("p", { class: "footnote" }, "The expected values ignore linkage and sampling variance, so a difference here is not a test."),
    );
  }

  // ---------------------------------------------------------------- weights
  function renderWeights(c: Current): void {
    const T = theme();
    const x: Float64Array = c.shape.length === 1 ? c.counts : marginalize(asND(c.shape, c.counts), store.get().display.view1D === "pop2" ? 0 : 1).data;
    const n = x.length - 1;
    const W = weights1D(n);
    const ests: { key: Estimator; label: string; color: string; dash?: string }[] = [
      { key: "thetaW", label: "θ_W", color: T.pop1 },
      { key: "thetaPi", label: "θ_π", color: T.pop2 },
      { key: "thetaH", label: "θ_H", color: T.anc },
      { key: "thetaL", label: "θ_L", color: T.pulse },
      { key: "thetaXi1", label: "θ_ξ₁ (singletons)", color: T.ink2, dash: "2 3" },
      { key: "thetaEta", label: "θ_η (folded singletons)", color: T.ink3, dash: "6 3" },
    ];
    const chooser = h(
      "div",
      { class: "chips" },
      ...ests.map((e) => {
        const id = `est-${e.key}`;
        const disabled = c.folded && !FOLDED_OK[e.key];
        const cb = h("input", { type: "checkbox", id, checked: ui.estimators.has(e.key) && !disabled, disabled }) as HTMLInputElement;
        cb.addEventListener("change", () => {
          if (cb.checked) ui.estimators.add(e.key);
          else ui.estimators.delete(e.key);
          renderWeights(c);
        });
        return h("span", {}, cb, h("label", { for: id, title: disabled ? NEEDS_UNFOLDED : "" }, ` ${e.label}`));
      }),
    );
    const shown = ests.filter((e) => ui.estimators.has(e.key) && (!c.folded || FOLDED_OK[e.key]));
    const bins = Array.from({ length: n - 1 }, (_, k) => k + 1);
    const binsShown = c.folded ? bins.filter((i) => i <= Math.floor(n / 2)) : bins;
    const xs = c.folded ? polyBins(x, true) : null;
    const xi = (i: number): number => (xs ? xs.values[i - 1] : x[i]);
    const series: LineSeries[] = shown.map((e) => {
      const w = W[e.key];
      const pts = binsShown.map((i) => {
        // folded weights: w_i + w_{n-i} for symmetric estimators (equal), so use w_i
        const wi = c.folded && i !== n - i ? w[i] : w[i];
        const y = ui.weightsView === "weights" ? wi : wi * xi(i);
        return { x: i, y };
      });
      const maxv = Math.max(...pts.map((p) => Math.abs(p.y)), 1e-300);
      return { label: e.label, color: e.color, dash: e.dash ?? null, points: ui.weightsView === "weights" ? pts.map((p) => ({ x: p.x, y: p.y / maxv })) : pts };
    });
    const sfsEl = h("div", { class: "plot-box" });
    const wEl = h("div", { class: "plot-box" });
    const tbl = h("details", { class: "data-box" }, h("summary", {}, "Data table"));
    setChildren(
      weightsBody,
      chooser,
      segmented("wview", "Show", [{ value: "weights", label: "Weight per SNP (scaled to max 1)" }, { value: "contribution", label: "Contribution wᵢ·ξᵢ" }], ui.weightsView, (v) => {
        ui.weightsView = v;
        renderWeights(c);
      }),
      sfsEl,
      wEl,
      tbl,
    );
    const width = Math.min(640, weightsBody.clientWidth || 560);
    drawSfs1D(sfsEl, { model: { x, scale: 1, label: c.mode === "model" ? "expected SFS" : "observed SFS" }, modelColor: T.ghost, folded: c.folded, yUnit: "proportion", yLog: false, neutral: true, ratio: false, theta: 1, title: `Spectrum (n = ${n})` }, width);
    const inp = {
      title: ui.weightsView === "weights" ? "Weight of each bin in each estimator" : "Contribution of each bin to each estimator (sums to the estimate)",
      xLabel: c.folded ? "Minor allele count" : "Derived allele count i",
      yLabel: ui.weightsView === "weights" ? "Weight (max = 1)" : "wᵢ · ξᵢ",
      series,
      yZero: true,
      height: 240,
    };
    drawLines(wEl, inp, width);
    tbl.append(tableLines(inp));
    void neutralSFS;
  }

  function renderWeights2D(c: Current): void {
    w2Card.hidden = c.shape.length !== 2;
    if (c.shape.length !== 2) return;
    const [d1, d2] = c.shape;
    const W = weights2D(d1 - 1, d2 - 1);
    const mask = cornerMask(c.shape);
    const grid = h("div", { class: "multiples" });
    const items: [string, Float64Array, "linear" | "diverging"][] = [
      ["π₁", W.pi1, "linear"],
      ["π₂", W.pi2, "linear"],
      ["d_xy", W.dxy, "linear"],
      ["Hudson F_ST numerator", W.hudsonNum, "diverging"],
    ];
    const boxes = items.map(() => h("div"));
    grid.append(...boxes);
    setChildren(w2Body, grid);
    items.forEach(([t, w, kind], k) => drawHeatmap(boxes[k], { shape: [d1, d2], values: w, mask, kind, title: `Weights: ${t}`, valueLabel: "weight", compact: true, size: 200 }, 280));
  }

  // ---------------------------------------------------------------- F_ST teaching plots
  function renderFst(c: Current): void {
    fstCard.hidden = c.shape.length !== 2;
    if (c.shape.length !== 2) return;
    const T = theme();
    const [d1, d2] = c.shape;
    const N1 = d1 - 1;
    const N2 = d2 - 1;
    const joint: NDArray = asND(c.shape, c.counts);
    const diploidOK = c.hm.kind === "haploid" || (N1 % 2 === 0 && N2 % 2 === 0);
    const series = (pts: { x: number; hud: number; wc: number }[], xlab: string): LineSeries[] => {
      const out: LineSeries[] = [];
      if (ui.fstShow !== "wc") out.push({ label: "Hudson", color: T.pop1, points: pts.map((p) => ({ x: p.x, y: p.hud })) });
      if (ui.fstShow !== "hudson") out.push({ label: "Weir & Cockerham", color: T.pulse, dash: "5 3", points: pts.map((p) => ({ x: p.x, y: p.wc })) });
      void xlab;
      return out;
    };
    const boxes = [h("div"), h("div"), h("div")];
    const grid = h("div", { class: "multiples" }, ...boxes);
    setChildren(
      fstBody,
      h("div", { class: "prose", html: doc("stats", "fst-two") }),
      segmented("fstshow", "Show", [{ value: "both", label: "Both" }, { value: "hudson", label: "Hudson" }, { value: "wc", label: "Weir & Cockerham" }], ui.fstShow, (v) => {
        ui.fstShow = v;
        renderFst(c);
      }),
      grid,
      h("div", { class: "prose", html: doc("stats", "fst-plots") }),
    );
    if (c.folded && c.mode === "data") {
      boxes[0].append(h("p", { class: "hint" }, "The sample-size plot needs an unfolded spectrum (projection of a folded joint spectrum is not supported)."));
    } else if (diploidOK) {
      // 1. sample size ratio: one population at its full (even) size, the other varied
      const full1 = N1 - (N1 % 2);
      const full2 = N2 - (N2 % 2);
      const pts: { x: number; hud: number; wc: number }[] = [];
      for (let a = 4; a <= full1; a += 2) pts.push(fstAt(joint, a, full2, c.hm));
      for (let b = full2 - 2; b >= 4; b -= 2) pts.push(fstAt(joint, full1, b, c.hm));
      pts.sort((p, q) => p.x - q.x);
      drawLines(boxes[0], { title: "F_ST and the sample size ratio", xLabel: "n₁ / n₂", yLabel: "F_ST", series: series(pts, "ratio"), xLog: true, height: 230 }, 320);
    }
    // 2. MAF filter
    const mafs = [0, 0.01, 0.05, 0.1, 0.2];
    const mpts = mafs.map((f) => {
      const filt = mafFilterJoint(joint, f);
      const t = twoPopStats({ n1: N1, n2: N2, data: filt.data }, c.hm);
      return { x: f * 100, hud: t.fstHudson, wc: t.fstWC };
    });
    drawLines(boxes[1], { title: "F_ST and a minor allele frequency filter", xLabel: "MAF filter (%)", yLabel: "F_ST", series: series(mpts, "maf"), xTicks: [0, 5, 10, 20], height: 230 }, 320);
    // 3. F_IS used by WC
    if (c.hm.kind !== "haploid" && N1 % 2 === 0 && N2 % 2 === 0) {
      const fs = Array.from({ length: 10 }, (_, k) => k / 10);
      const fpts = fs.map((F) => {
        const t = twoPopStats({ n1: N1, n2: N2, data: c.counts }, { kind: "fis", F: [F, F] });
        return { x: F, hud: t.fstHudson, wc: t.fstWC };
      });
      drawLines(boxes[2], { title: "F_ST and the F_IS assumed by WC", xLabel: "F_IS (both populations)", yLabel: "F_ST", series: series(fpts, "fis"), height: 230 }, 320);
    } else boxes[2].append(h("p", { class: "hint" }, "The F_IS plot needs diploid data (even sample sizes, not the haploid option)."));
  }

  function fstAt(joint: NDArray, a: number, b: number, hm: HetMode): { x: number; hud: number; wc: number } {
    const p = projectJoint(joint, a, b);
    const t = twoPopStats({ n1: a, n2: b, data: p.data }, hm);
    return { x: a / b, hud: t.fstHudson, wc: t.fstWC };
  }

  // ---------------------------------------------------------------- parameter sweep
  type ParamId = string;
  interface Param {
    id: ParamId;
    label: string;
    min: number;
    max: number;
    log: boolean;
    apply: (m: Model, v: number) => void;
  }
  function paramsFor(m: Model): Param[] {
    const P: Param[] = [];
    if (m.mode === 2) {
      const Tpost = m.post.reduce((a, e) => a + e.T, 0);
      P.push({
        id: "tsplit",
        label: "Split time (all epochs after the split scaled together)",
        min: Math.max(0.005, Tpost / 20),
        max: Math.min(LIMITS.T.max, Tpost * 10),
        log: true,
        apply: (mm, v) => {
          const f = v / mm.post.reduce((a, e) => a + e.T, 0);
          mm.post.forEach((e) => (e.T *= f));
          if (mm.pulse.on) mm.pulse.time *= f;
        },
      });
      P.push({
        id: "M",
        label: "Migration rate M (all epochs, both directions; migration on)",
        min: 0.01,
        max: 20,
        log: true,
        apply: (mm, v) => {
          mm.migration = true;
          mm.post.forEach((e) => {
            e.m12 = v;
            e.m21 = v;
          });
        },
      });
      if (m.pulse.on) P.push({ id: "f", label: "Admixture fraction f", min: 0, max: 0.9, log: false, apply: (mm, v) => (mm.pulse.f = v) });
      P.push({ id: "nu1", label: "Pop 1 size in the last epoch (ν)", min: 0.05, max: 20, log: true, apply: (mm, v) => (mm.post[mm.post.length - 1].nu[0] = v) });
      P.push({ id: "nu2", label: "Pop 2 size in the last epoch (ν)", min: 0.05, max: 20, log: true, apply: (mm, v) => (mm.post[mm.post.length - 1].nu[1] = v) });
    }
    m.ancestral.forEach((_e, k) => {
      P.push({ id: `anu${k}`, label: `${m.mode === 2 ? "Ancestral" : "Population"} epoch ${k + 1}: size ν`, min: 0.01, max: 100, log: true, apply: (mm, v) => (mm.ancestral[k].nu = v) });
      P.push({ id: `aT${k}`, label: `${m.mode === 2 ? "Ancestral" : "Population"} epoch ${k + 1}: duration T`, min: 0.001, max: 5, log: true, apply: (mm, v) => (mm.ancestral[k].T = v) });
    });
    if (m.selection.on) {
      const g = m.mode === 1 ? LIMITS.gamma1D : LIMITS.gamma2D;
      P.push({ id: "gamma", label: "Selection γ", min: -g, max: g, log: false, apply: (mm, v) => (mm.selection.gamma = v) });
    }
    return P;
  }
  interface StatDef {
    id: string;
    label: string;
    two: boolean;
    get: (one: OnePopStats[], two: TwoPopStats | null, L: number) => number;
  }
  const STATS: StatDef[] = [
    { id: "fstH", label: "F_ST (Hudson)", two: true, get: (_o, t) => t!.fstHudson },
    { id: "fstWC", label: "F_ST (WC θ)", two: true, get: (_o, t) => t!.fstWC },
    { id: "dxy", label: "d_xy per site", two: true, get: (_o, t, L) => t!.dxy / L },
    { id: "da", label: "d_a per site", two: true, get: (_o, t, L) => t!.da / L },
    { id: "pi1", label: "π₁ per site", two: true, get: (o, _t, L) => o[0].thetaPi / L },
    { id: "pi2", label: "π₂ per site", two: true, get: (o, _t, L) => o[1].thetaPi / L },
    { id: "D1", label: "Tajima's D (pop 1)", two: true, get: (o) => o[0].tajimaD },
    { id: "pi", label: "θ_π per site", two: false, get: (o, _t, L) => o[0].thetaPi / L },
    { id: "tw", label: "θ_W per site", two: false, get: (o, _t, L) => o[0].thetaW / L },
    { id: "D", label: "Tajima's D", two: false, get: (o) => o[0].tajimaD },
    { id: "Dstar", label: "Fu & Li's D*", two: false, get: (o) => o[0].fuLiDstar },
    { id: "H", label: "Fay & Wu's H (normalised)", two: false, get: (o) => o[0].zengH },
    { id: "E", label: "Zeng's E", two: false, get: (o) => o[0].zengE },
  ];
  const sweep = { param: "", min: NaN, max: NaN, points: 12, chosen: new Set<string>(["fstH", "fstWC", "dxy", "da", "pi1", "pi2", "D"]), compareNoMig: false, token: 0, running: false };

  function buildSweep(): void {
    const s = store.get();
    const m = effectiveModel(s);
    const ps = paramsFor(m);
    if (!ps.find((p) => p.id === sweep.param)) {
      sweep.param = ps[0]?.id ?? "";
      sweep.min = NaN;
      sweep.max = NaN;
    }
    const p = ps.find((q) => q.id === sweep.param)!;
    if (!Number.isFinite(sweep.min)) sweep.min = p.min;
    if (!Number.isFinite(sweep.max)) sweep.max = p.max;
    const stats = STATS.filter((d) => d.two === (m.mode === 2));
    const chips = h(
      "div",
      { class: "chips" },
      ...stats.map((d) => {
        const id = `sw-${d.id}`;
        const cb = h("input", { type: "checkbox", id, checked: sweep.chosen.has(d.id) }) as HTMLInputElement;
        cb.addEventListener("change", () => (cb.checked ? sweep.chosen.add(d.id) : sweep.chosen.delete(d.id)));
        return h("span", {}, cb, h("label", { for: id }, ` ${d.label}`));
      }),
    );
    const out = h("div", { class: "multiples", id: "sweep-plots" });
    const status = h("p", { class: "hint", "aria-live": "polite" });
    const runBtn = h("button", { type: "button", class: "btn primary" }, "Run the sweep") as HTMLButtonElement;
    const stopBtn = h("button", { type: "button", class: "btn" }, "Stop") as HTMLButtonElement;
    runBtn.addEventListener("click", () => void runSweep(p, stats.filter((d) => sweep.chosen.has(d.id)), out, status));
    stopBtn.addEventListener("click", () => {
      sweep.token++;
      status.textContent = "Stopped.";
    });
    setChildren(
      sweepBody,
      select(
        "sw-param",
        "Parameter",
        ps.map((q) => ({ value: q.id, label: q.label })),
        sweep.param,
        (v) => {
          sweep.param = v;
          sweep.min = NaN;
          sweep.max = NaN;
          buildSweep();
        },
      ),
      h(
        "div",
        { class: "grid2" },
        numberField("sw-min", "From", sweep.min, (v) => (sweep.min = v)),
        numberField("sw-max", "To", sweep.max, (v) => (sweep.max = v)),
        numberField("sw-n", "Points (3–25)", sweep.points, (v) => (sweep.points = Math.max(3, Math.min(25, Math.round(v)))), { min: 3, max: 25 }),
      ),
      chips,
      m.mode === 2 && p.id !== "M" ? toggle("sw-nomig", "Also show the same model without migration (dashed)", sweep.compareNoMig, (v) => (sweep.compareNoMig = v)) : null,
      h("div", { class: "file-row" }, runBtn, stopBtn),
      status,
      out,
    );
  }

  async function runSweep(p: Param, stats: StatDef[], out: HTMLElement, status: HTMLElement): Promise<void> {
    const token = ++sweep.token;
    const s = store.get();
    const base = effectiveModel(s);
    const L = s.units.L;
    const th = thetaOf(s.units);
    const hm = hetModeOf(s.wcMode, base);
    const npts = sweep.points;
    const lo = Math.min(sweep.min, sweep.max);
    const hi = Math.max(sweep.min, sweep.max);
    if (p.log && lo <= 0) {
      status.textContent = "A log-spaced parameter needs a positive lower bound.";
      return;
    }
    const xs = Array.from({ length: npts }, (_, k) => (p.log ? Math.exp(Math.log(lo) + (k / (npts - 1)) * (Math.log(hi) - Math.log(lo))) : lo + (k / (npts - 1)) * (hi - lo)));
    const variants: { label: string; dash: string | null; mk: (v: number) => Model }[] = [
      {
        label: "model",
        dash: null,
        mk: (v) => {
          const mm = structuredClone(base);
          p.apply(mm, v);
          return mm;
        },
      },
    ];
    if (sweep.compareNoMig && base.mode === 2 && p.id !== "M")
      variants.push({
        label: "no migration",
        dash: "5 3",
        mk: (v) => {
          const mm = structuredClone(base);
          p.apply(mm, v);
          mm.migration = false;
          return mm;
        },
      });
    const results = variants.map(() => new Map<number, { one: OnePopStats[]; two: TwoPopStats | null }>());
    const T = theme();
    const draw = (): void => {
      out.replaceChildren();
      for (const d of stats) {
        const box = h("div");
        out.append(box);
        const series: LineSeries[] = variants.map((vv, k) => ({
          label: vv.label,
          color: T.pop1,
          dash: vv.dash,
          points: xs.filter((x) => results[k].has(x)).map((x) => ({ x, y: d.get(results[k].get(x)!.one, results[k].get(x)!.two, L) })),
        }));
        drawLines(box, { title: d.label, xLabel: p.label.split(" (")[0], yLabel: "", series, xLog: p.log, height: 210, legend: variants.length > 1 }, 300);
      }
    };
    sweep.running = true;
    const t0 = performance.now();
    let done = 0;
    for (const x of xs) {
      for (let k = 0; k < variants.length; k++) {
        if (token !== sweep.token) return;
        try {
          const mm = variants[k].mk(x);
          const r = await sweepEngine.compute(mm, 0.02);
          const counts = scale(r.data, th);
          const one = r.shape.length === 1 ? [onePopStats(counts)] : [onePopStats(marginalize(asND(r.shape, counts), 1).data), onePopStats(marginalize(asND(r.shape, counts), 0).data)];
          const two = r.shape.length === 2 ? twoPopStats({ n1: r.shape[0] - 1, n2: r.shape[1] - 1, data: counts }, hm) : null;
          results[k].set(x, { one, two });
        } catch (e) {
          status.textContent = `Point ${fmt(x)} could not be computed: ${e instanceof Error ? e.message : e}`;
        }
      }
      done++;
      if (token !== sweep.token) return;
      status.textContent = `${done} of ${npts} points (${Math.round(performance.now() - t0)} ms).`;
      draw();
    }
    sweep.running = false;
    status.textContent = `Done: ${npts} points in ${Math.round(performance.now() - t0)} ms. θ = ${fmt(th)}, L = ${fmt(L)}; WC: ${hetLabel(hm)}.`;
  }

  // ---------------------------------------------------------------- refresh
  function refresh(): void {
    const c = current();
    if (!c) {
      setChildren(tableBody, h("p", { class: "hint" }, ui.source === "data" ? "Load a spectrum to see its statistics." : "The model is being computed…"));
      compareCard.hidden = ui.source !== "data";
      return;
    }
    renderTable(c);
    renderCompare(c);
    renderWeights(c);
    renderWeights2D(c);
    renderFst(c);
  }

  buildSource();
  buildWc();
  buildSweep();
  refresh();
  model.onResult(() => {
    if (!root.hidden) refresh();
  });
  store.subscribe((_s, info) => {
    if (info.source !== "display") {
      if (sweep.running) {
        sweep.token++;
        sweep.running = false;
      }
      if (info.structural) buildSweep();
    }
    if (info.source === "display" || info.structural) {
      buildWc();
      buildSource();
    }
    if (!root.hidden) refresh();
  });
  // refresh when the tab becomes visible
  new MutationObserver(() => {
    if (!root.hidden) refresh();
  }).observe(root, { attributes: true, attributeFilter: ["hidden"] });
}
