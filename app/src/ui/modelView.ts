/**
 * The Model tab: controls | history diagram + "What changed?" | SFS plots + compact statistics.
 * The diagram is redrawn at once on every change; the spectrum comes from the worker (draft
 * accuracy while a slider moves, full accuracy when it is released). The old plot stays visible
 * while a new spectrum is computed; a spinner appears after 200 ms.
 */

import { onThemeChange } from "./theme.ts";
import { Store, effectiveModel, theta as thetaOf } from "./state.ts";
import { Engine, LiveRunner, SfsResult } from "../engine/client.ts";
import { Model } from "../engine/model.ts";
import { NDArray } from "../engine/ndarray.ts";
import { mountControls, Action, ControlsHandle } from "./controls.ts";
import { drawDiagram } from "./plots/diagram.ts";
import { drawSfs1D, table1D, Sfs1DInput, Series1D } from "./plots/sfs1d.ts";
import { drawHeatmap, table2D } from "./plots/sfs2d.ts";
import { theme, svgBlob, pngBlob } from "./plots/common.ts";
import { modelStats, renderCompact, StatsBundle } from "./modelStats.ts";
import { explain, summarise, compare, Summary } from "./whatChanged.ts";
import { views, foldJoint, polyBins, asND } from "../stats/sfsutil.ts";
import { sfsCsv, sfsFs, demesYaml } from "./exports.ts";
import { shareUrl } from "./url.ts";
import { h, download, fmt, setChildren } from "./dom.ts";

export interface ModelViewHandle {
  latest(): { result: SfsResult; model: Model; stats: StatsBundle } | null;
  onResult(fn: (r: SfsResult, model: Model) => void): void;
}

interface Pinned {
  label: string;
  one: Record<string, Float64Array>; // 1D spectra by view key ("sample", "pop1", "pop2", "pooled")
}

export function mountModelView(root: HTMLElement, store: Store, engine: Engine): ModelViewHandle {
  const controlsEl = h("div", { class: "controls-inner" });
  const drawerBtn = h("button", { type: "button", class: "btn drawer-btn", "aria-expanded": "false", "aria-controls": "controls-panel" }, "Model controls");
  const controlsAside = h("aside", { class: "controls", id: "controls-panel", "aria-label": "Model controls" }, controlsEl);
  drawerBtn.addEventListener("click", () => {
    const openNow = controlsAside.classList.toggle("open");
    drawerBtn.setAttribute("aria-expanded", String(openNow));
  });
  const diagramEl = h("div", { class: "plot-box", id: "diagram" });
  const whatEl = h("div", { class: "what-text", "aria-live": "polite" });
  const sfsMainEl = h("div", { class: "plot-box", id: "sfs-main" });
  const sfs1dEl = h("div", { class: "plot-box", id: "sfs-1d" });
  const statusEl = h("div", { class: "status", "aria-live": "polite" });
  const spinner = h("span", { class: "spinner", hidden: true, role: "status", "aria-label": "Computing" });
  const errorEl = h("p", { class: "error", hidden: true, role: "alert" });
  const tableBox = h("details", { class: "data-box" }, h("summary", {}, "Data table"), h("div", { class: "table-wrap" }));
  const statsEl = h("div", { class: "compact-stats" });
  const plotTools = (getSvg: () => SVGSVGElement | null, name: string): HTMLElement =>
    h(
      "span",
      { class: "plot-tools" },
      h("button", { type: "button", class: "link small", onclick: () => exportFig(getSvg(), name, "svg"), "aria-label": `Download ${name} as SVG` }, "SVG"),
      h("button", { type: "button", class: "link small", onclick: () => exportFig(getSvg(), name, "png"), "aria-label": `Download ${name} as PNG` }, "PNG"),
    );

  root.append(
    h(
      "div",
      { class: "model-grid" },
      drawerBtn,
      controlsAside,
      h(
        "div",
        { class: "col-center" },
        h("section", { class: "card" }, h("header", { class: "card-head" }, h("h2", {}, "Demographic history"), plotTools(() => diagramEl.querySelector("svg"), "history_diagram")), diagramEl),
        h("section", { class: "card what" }, h("header", { class: "card-head" }, h("h2", {}, "What changed?")), whatEl),
      ),
      h(
        "div",
        { class: "col-right" },
        h(
          "section",
          { class: "card" },
          h("header", { class: "card-head" }, h("h2", {}, "Expected SFS"), spinner, plotTools(() => sfsMainEl.querySelector("svg"), "expected_sfs")),
          errorEl,
          sfsMainEl,
          sfs1dEl,
          statusEl,
          tableBox,
        ),
        h(
          "section",
          { class: "card" },
          h("header", { class: "card-head" }, h("h2", {}, "Summary statistics")),
          statsEl,
          h("p", { class: "hint card-foot" }, "More statistics and plots are in the ", h("a", { href: "#stats" }, "Statistics tab"), ". Have your own SFS? ", h("a", { href: "#stats-upload" }, "Upload it"), " to compare it with this model."),
        ),
      ),
    ),
  );

  let last: { result: SfsResult; model: Model; stats: StatsBundle } | null = null;
  let prevSummary: Summary | null = null;
  let pinned: Pinned | null = null;
  const listeners: ((r: SfsResult, m: Model) => void)[] = [];
  let controls: ControlsHandle;

  function exportFig(svg: SVGSVGElement | null, name: string, kind: "svg" | "png"): void {
    if (!svg) return;
    if (kind === "svg") download(`${name}.svg`, svgBlob(svg));
    else void pngBlob(svg).then((b) => download(`${name}.png`, b));
  }

  function renderDiagram(): void {
    const s = store.get();
    const m = effectiveModel(s);
    try {
      drawDiagram(diagramEl, m, s.display, s.units, (t) => controls.focusTarget(t), Math.min(560, Math.max(320, diagramEl.clientWidth || 420)), 380);
    } catch (e) {
      diagramEl.textContent = `The diagram could not be drawn: ${e instanceof Error ? e.message : e}`;
    }
  }

  function oneDFor(r: SfsResult, key: string): Float64Array | null {
    if (r.shape.length === 1) return key === "sample" ? r.data : null;
    const v = views(asND(r.shape, r.data));
    return key === "pop1" ? v.pop1.data : key === "pop2" ? v.pop2.data : key === "pooled" ? v.pooled.data : null;
  }

  function renderPlots(): void {
    if (!last) return;
    const s = store.get();
    const T = theme();
    const { result: r } = last;
    const th = thetaOf(s.units);
    const two = r.shape.length === 2;
    const viewKey = two ? s.display.view1D : "sample";
    const color = !two ? T.pop1 : viewKey === "pop1" ? T.pop1 : viewKey === "pop2" ? T.pop2 : T.anc;
    const x = oneDFor(r, viewKey)!;
    const labelOf: Record<string, string> = { sample: "Expected SFS", pop1: "Pop 1 (marginal)", pop2: "Pop 2 (marginal)", pooled: "Pooled sample" };
    const ghostX = pinned?.one[viewKey];
    const inp: Sfs1DInput = {
      model: { x, scale: th, label: labelOf[viewKey] },
      modelColor: color,
      folded: s.display.folded,
      yUnit: s.display.yUnit,
      yLog: s.display.yLog,
      neutral: s.display.neutral,
      ratio: s.display.ratio,
      theta: th,
      ghost: ghostX && ghostX.length === x.length ? ({ x: ghostX, scale: th, label: pinned!.label } as Series1D) : null,
      title: two ? `${labelOf[viewKey]}, n = ${x.length - 1}` : `Expected SFS, n = ${x.length - 1}${s.display.folded ? " (folded)" : ""}`,
    };
    const tableWrap = tableBox.querySelector(".table-wrap")!;
    if (!two) {
      sfs1dEl.replaceChildren();
      drawSfs1D(sfsMainEl, inp, Math.max(320, Math.min(640, sfsMainEl.clientWidth || 560)));
      setChildren(tableWrap, table1D(inp));
    } else {
      const joint: NDArray = asND(r.shape, r.data);
      const [d1, d2] = r.shape;
      let data: Float64Array;
      let mask: Uint8Array;
      if (s.display.folded) ({ data, mask } = foldJoint(joint));
      else {
        data = joint.data;
        mask = new Uint8Array(data.length);
        mask[0] = 1;
        mask[data.length - 1] = 1;
      }
      const vals = new Float64Array(data.length);
      let tot = 0;
      for (let k = 0; k < data.length; k++) if (!mask[k]) tot += data[k];
      for (let k = 0; k < data.length; k++) vals[k] = s.display.yUnit === "count" ? data[k] * th : data[k] / tot;
      const v = views(joint);
      const marg = (a: Float64Array): number[] => {
        const b = polyBins(a, s.display.folded);
        return b.values;
      };
      drawHeatmap(
        sfsMainEl,
        {
          shape: [d1, d2],
          values: vals,
          mask,
          kind: "log",
          title: `Joint SFS, n₁ = ${d1 - 1}, n₂ = ${d2 - 1}${s.display.folded ? " (folded)" : ""}; margins: pop 2 (top), pop 1 (right)`,
          valueLabel: s.display.yUnit === "count" ? "expected number of sites" : "proportion of SNPs",
          margins: { pop1: marg(v.pop1.data), pop2: marg(v.pop2.data), label: "" },
          size: 360,
        },
        Math.max(320, Math.min(620, sfsMainEl.clientWidth || 560)),
      );
      drawSfs1D(sfs1dEl, inp, Math.max(320, Math.min(640, sfs1dEl.clientWidth || 560)));
      setChildren(tableWrap, h("p", { class: "muted" }, "Joint spectrum (rows: pop 1; columns: pop 2):"), table2D([d1, d2], vals, mask), h("p", { class: "muted" }, "1D panel:"), table1D(inp));
    }
    const st = last.result;
    const simNote = st.simN.some((n, k) => n !== (two ? r.shape[k] - 1 : r.shape[0] - 1)) ? ` · computed at n = ${st.simN.join(" × ")} and projected` : "";
    statusEl.textContent = `Computed in ${st.ms < 10 ? st.ms.toFixed(1) : Math.round(st.ms)} ms${st.dtFac > 0.05 ? " (draft accuracy while you drag)" : ""}${simNote}${engine.usesWorker ? "" : " · main thread"}.`;
  }

  function renderStatsAndText(final: boolean): void {
    if (!last) return;
    const s = store.get();
    renderCompact(statsEl, last.stats, s.display.folded);
    const sentences = explain(last.model, last.stats, s.display);
    const sum = summarise(last.stats, s.display.view1D);
    const cmp = final ? compare(prevSummary, sum) : null;
    setChildren(whatEl, ...sentences.map((t) => h("p", { html: t })), cmp ? h("p", { class: "delta" }, cmp) : null);
    if (final) prevSummary = sum;
  }

  const runner = new LiveRunner(
    engine,
    (r, model) => {
      errorEl.hidden = true;
      const s = store.get();
      last = { result: r, model, stats: modelStats(asND(r.shape, r.data), model, s) };
      renderPlots();
      renderStatsAndText(r.dtFac <= 0.02);
      for (const l of listeners) l(r, model);
    },
    (msg) => {
      errorEl.hidden = false;
      errorEl.textContent = `This model cannot be computed: ${msg}. The previous result is shown.`;
    },
    (busy) => {
      spinner.hidden = !busy;
    },
  );

  function onAction(a: Action): void {
    const s = store.get();
    const m = effectiveModel(s);
    if (a === "pin" && last) {
      const r = last.result;
      const one: Record<string, Float64Array> = {};
      for (const k of ["sample", "pop1", "pop2", "pooled"]) {
        const x = oneDFor(r, k);
        if (x) one[k] = Float64Array.from(x);
      }
      pinned = { label: `pinned (${s.preset ? s.preset.replace(/_/g, " ") : "earlier model"})`, one };
      controls.setPinned(true);
      renderPlots();
    } else if (a === "unpin") {
      pinned = null;
      controls.setPinned(false);
      renderPlots();
    } else if (a === "share") {
      const url = shareUrl(s);
      void navigator.clipboard?.writeText(url).then(
        () => flash("Link copied to the clipboard."),
        () => prompt("Copy this link:", url),
      );
      if (!navigator.clipboard) prompt("Copy this link:", url);
    } else if (a === "csv" && last) download("expected_sfs.csv", sfsCsv(asND(last.result.shape, last.result.data), m, s), "text/csv");
    else if (a === "fs" && last) download("expected_sfs.fs", sfsFs(asND(last.result.shape, last.result.data), m, s));
    else if (a === "demes") download("model_demes.yaml", demesYaml(m, s), "application/yaml");
    else if (a === "diagram-svg" || a === "diagram-png") exportFig(diagramEl.querySelector("svg"), "history_diagram", a.endsWith("svg") ? "svg" : "png");
    else if (a === "sfs-svg" || a === "sfs-png") exportFig(sfsMainEl.querySelector("svg"), "expected_sfs", a.endsWith("svg") ? "svg" : "png");
  }

  function flash(msg: string): void {
    const t = h("div", { class: "toast", role: "status" }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), 2200);
  }

  controls = mountControls(controlsEl, store, onAction);

  const request = (draft: boolean): void => {
    renderDiagram();
    runner.request(effectiveModel(store.get()), draft);
  };
  store.subscribe((_s, info) => {
    if (info.source === "display") {
      renderDiagram();
      if (last) {
        last.stats = modelStats(asND(last.result.shape, last.result.data), last.model, store.get());
        renderPlots();
        renderStatsAndText(false);
      }
      return;
    }
    request(info.draft);
  });
  request(false);

  // redraw at the new width when the layout changes
  let rw = 0;
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => {
    const w = sfsMainEl.clientWidth;
    if (Math.abs(w - rw) < 8) return;
    rw = w;
    renderDiagram();
    renderPlots();
  }) : null;
  ro?.observe(sfsMainEl);
  // new colours after a theme change (a hidden tab is drawn again when it is shown)
  onThemeChange(() => {
    if (root.hidden) return;
    renderDiagram();
    renderPlots();
  });
  void fmt;

  return {
    latest: () => last,
    onResult: (fn) => listeners.push(fn),
  };
}
