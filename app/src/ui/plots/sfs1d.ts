/**
 * 1D SFS bar plot: model bars, optional standard neutral overlay (E[xi_i] ∝ 1/i), a pinned
 * "ghost" spectrum, observed data points, and a ratio panel (spectrum / neutral) below.
 * Ratios are taken on proportions, so they compare shapes, not totals.
 */

import { scaleBand, scaleLinear, scaleLog, axisBottom, axisLeft, max as d3max, min as d3min } from "d3";
import { newSvg, theme, showTip, hideTip, styleAxis, barPath, svgLegend, legendRows, GSel } from "./common.ts";
import { polyBins, neutralSFS } from "../../stats/sfsutil.ts";
import { fmt, h } from "../dom.ts";

export interface Series1D {
  x: ArrayLike<number>; // unfolded spectrum, length n + 1 (theta = 1 or counts)
  scale: number; // multiply by this for counts (theta for a model; 1 for data)
  label: string;
}

export interface Sfs1DInput {
  model: Series1D | null;
  modelColor: string;
  folded: boolean;
  yUnit: "proportion" | "count";
  yLog: boolean;
  neutral: boolean;
  ratio: boolean;
  theta: number; // scale of the neutral overlay in count mode
  ghost?: Series1D | null;
  observed?: Series1D | null;
  title: string;
}

interface Prepared {
  bins: number[];
  model: number[] | null;
  neutral: number[];
  ghost: number[] | null;
  observed: number[] | null;
  n: number;
}

function prepare(inp: Sfs1DInput): Prepared {
  const n = (inp.model ?? inp.observed ?? inp.ghost)!.x.length - 1;
  const norm = (s: Series1D | null | undefined): number[] | null => {
    if (!s || s.x.length !== n + 1) return null;
    const b = polyBins(s.x, inp.folded);
    if (inp.yUnit === "count") return b.values.map((v) => v * s.scale);
    const tot = b.values.reduce((a, v) => a + v, 0);
    return b.values.map((v) => (tot > 0 ? v / tot : 0));
  };
  const neu = norm({ x: neutralSFS(n), scale: inp.theta, label: "" })!;
  return { bins: polyBins(new Float64Array(n + 1), inp.folded).bins, model: norm(inp.model), neutral: neu, ghost: norm(inp.ghost), observed: norm(inp.observed), n };
}

export function drawSfs1D(container: HTMLElement, inp: Sfs1DInput, width = 560): SVGSVGElement {
  const T = theme();
  const P = prepare(inp);
  const showRatio = inp.ratio;
  const leg: Parameters<typeof svgLegend>[1] = [];
  if (P.model) leg.push({ label: inp.model!.label, color: inp.modelColor, kind: "bar" });
  if (inp.neutral) leg.push({ label: "standard neutral (∝ 1/i)", color: T.neutral, kind: "dash" });
  if (P.ghost) leg.push({ label: inp.ghost!.label, color: T.ghost, kind: "ghost" });
  if (P.observed) leg.push({ label: inp.observed!.label, color: T.obs, kind: "dot" });
  const rows = legendRows(leg, width - 70);
  const mainH = 230;
  const ratioH = showRatio ? 110 : 0;
  const margin = { top: 30 + 16 * rows, right: 14, bottom: 40, left: 62 };
  const gap = showRatio ? 34 : 0;
  const height = margin.top + mainH + gap + ratioH + margin.bottom;
  const svg = newSvg(container, width, height, inp.title);
  const PW = width - margin.left - margin.right;

  svg.append("text").attr("x", margin.left).attr("y", 16).attr("font-size", 13).attr("font-weight", 600).attr("fill", T.ink).text(inp.title);
  svgLegend(svg as unknown as GSel, leg, margin.left, 36, T, width - 70);

  const x = scaleBand<number>().domain(P.bins).range([margin.left, margin.left + PW]).paddingInner(P.bins.length > 40 ? 0.08 : 0.18).paddingOuter(0.1);
  const all = [...(P.model ?? []), ...(inp.neutral ? P.neutral : []), ...(P.ghost ?? []), ...(P.observed ?? [])].filter((v) => v > 0);
  const yMax = (d3max(all) ?? 1) * 1.08;
  const y0 = margin.top + mainH;
  const y = inp.yLog
    ? scaleLog()
        .domain([Math.max((d3min(all) ?? 1e-3) / 1.5, yMax * 1e-6), yMax])
        .range([y0, margin.top])
        .clamp(true)
    : scaleLinear().domain([0, yMax]).range([y0, margin.top]).nice();

  // grid
  const gGrid = svg.append("g");
  for (const t of (y as { ticks: (n: number) => number[] }).ticks(inp.yLog ? 4 : 5))
    gGrid.append("line").attr("x1", margin.left).attr("x2", margin.left + PW).attr("y1", y(t)).attr("y2", y(t)).attr("stroke", T.grid);

  // ghost (outline bars, behind)
  const bw = x.bandwidth();
  if (P.ghost)
    svg
      .append("g")
      .selectAll("rect")
      .data(P.bins)
      .join("rect")
      .attr("x", (b) => x(b)! - 1)
      .attr("y", (_b, k) => y(Math.max(P.ghost![k], y.domain()[0])))
      .attr("width", bw + 2)
      .attr("height", (_b, k) => Math.max(0, y0 - y(Math.max(P.ghost![k], y.domain()[0]))))
      .attr("fill", "none")
      .attr("stroke", T.ghost)
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "3 2");
  // model bars
  if (P.model)
    svg
      .append("g")
      .selectAll("path")
      .data(P.bins)
      .join("path")
      .attr("d", (b, k) => {
        const v = Math.max(P.model![k], y.domain()[0]);
        return barPath(x(b)!, y(v), bw, y0 - y(v), Math.min(3, bw / 3));
      })
      .attr("fill", inp.modelColor);
  // neutral overlay
  if (inp.neutral) {
    const pts = P.bins.map((b, k) => [x(b)! + bw / 2, y(Math.max(P.neutral[k], y.domain()[0]))]);
    svg.append("path").attr("d", `M${pts.map((p) => p.join(",")).join("L")}`).attr("fill", "none").attr("stroke", T.neutral).attr("stroke-width", 1.5).attr("stroke-dasharray", "4 3");
    if (P.bins.length <= 40)
      svg.append("g").selectAll("circle").data(pts).join("circle").attr("cx", (p) => p[0]).attr("cy", (p) => p[1]).attr("r", 2.6).attr("fill", T.neutral);
  }
  // observed points
  if (P.observed)
    svg
      .append("g")
      .selectAll("circle")
      .data(P.bins)
      .join("circle")
      .attr("cx", (b) => x(b)! + bw / 2)
      .attr("cy", (_b, k) => y(Math.max(P.observed![k], y.domain()[0])))
      .attr("r", 4)
      .attr("fill", T.obs)
      .attr("stroke", T.surface)
      .attr("stroke-width", 1.5);

  // axes
  const every = Math.ceil(P.bins.length / Math.max(4, Math.floor(PW / 28)));
  const lastBin = P.bins[P.bins.length - 1];
  const xAxis = axisBottom(x).tickValues(P.bins.filter((b) => b === 1 || (b % every === 0 && lastBin - b >= every / 2) || b === lastBin));
  const gx = svg.append("g").attr("transform", `translate(0,${y0})`).call(xAxis) as unknown as GSel;
  styleAxis(gx, T);
  const gy = svg
    .append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(axisLeft(y).ticks(inp.yLog ? 4 : 5, inp.yLog ? "~g" : undefined).tickFormat((d) => fmt(Number(d), 2))) as unknown as GSel;
  styleAxis(gy, T);
  svg
    .append("text")
    .attr("transform", `translate(14,${(margin.top + y0) / 2}) rotate(-90)`)
    .attr("text-anchor", "middle")
    .attr("font-size", 11)
    .attr("fill", T.ink2)
    .text(inp.yUnit === "proportion" ? "Proportion of SNPs" : "Expected number of sites");

  // ratio panel
  if (showRatio) {
    const ry0 = y0 + gap + ratioH;
    // ratios of proportions (shape), whatever the y unit
    const propOf = (vals: number[] | null): number[] | null => {
      if (!vals) return null;
      const t = vals.reduce((a, v) => a + v, 0);
      return vals.map((v) => v / t);
    };
    const neuProp = propOf(P.neutral)!;
    const rModel = P.model ? propOf(P.model)!.map((v, k) => v / neuProp[k]) : null;
    const rGhost = P.ghost ? propOf(P.ghost)!.map((v, k) => v / neuProp[k]) : null;
    const rObs = P.observed ? propOf(P.observed)!.map((v, k) => v / neuProp[k]) : null;
    const rv = [...(rModel ?? []), ...(rGhost ?? []), ...(rObs ?? [])].filter((v) => v > 0 && Number.isFinite(v));
    const lo = Math.min(0.5, (d3min(rv) ?? 1) / 1.15);
    const hi = Math.max(2, (d3max(rv) ?? 1) * 1.15);
    const yR = scaleLog().base(2).domain([lo, hi]).range([ry0, ry0 - ratioH]).clamp(true);
    svg.append("line").attr("x1", margin.left).attr("x2", margin.left + PW).attr("y1", yR(1)).attr("y2", yR(1)).attr("stroke", T.neutral).attr("stroke-dasharray", "4 3");
    const line = (vals: number[] | null, col: string, dash: string | null, dots: boolean): void => {
      if (!vals) return;
      const pts = P.bins.map((b, k) => [x(b)! + bw / 2, yR(Math.max(lo, Math.min(hi, vals[k])))]);
      svg.append("path").attr("d", `M${pts.map((p) => p.join(",")).join("L")}`).attr("fill", "none").attr("stroke", col).attr("stroke-width", 2).attr("stroke-dasharray", dash);
      if (dots && P.bins.length <= 50)
        svg.append("g").selectAll("circle").data(pts).join("circle").attr("cx", (p) => p[0]).attr("cy", (p) => p[1]).attr("r", 3).attr("fill", col);
    };
    line(rGhost, T.ghost, "3 2", false);
    line(rModel, inp.modelColor, null, true);
    if (rObs)
      svg
        .append("g")
        .selectAll("circle")
        .data(P.bins)
        .join("circle")
        .attr("cx", (b) => x(b)! + bw / 2)
        .attr("cy", (_b, k) => yR(Math.max(lo, Math.min(hi, rObs[k]))))
        .attr("r", 3.5)
        .attr("fill", T.obs);
    const ticks = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16].filter((t) => t >= lo && t <= hi);
    const gyr = svg
      .append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .call(axisLeft(yR).tickValues(ticks).tickFormat((d) => fmt(Number(d), 3))) as unknown as GSel;
    styleAxis(gyr, T);
    const gxr = svg.append("g").attr("transform", `translate(0,${ry0})`).call(xAxis) as unknown as GSel;
    styleAxis(gxr, T);
    svg
      .append("text")
      .attr("transform", `translate(14,${ry0 - ratioH / 2}) rotate(-90)`)
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .attr("fill", T.ink2)
      .text("Ratio to neutral");
  }
  svg
    .append("text")
    .attr("x", margin.left + PW / 2)
    .attr("y", height - 6)
    .attr("text-anchor", "middle")
    .attr("font-size", 11)
    .attr("fill", T.ink2)
    .text(inp.folded ? `Minor allele count (of n = ${P.n})` : `Derived allele count i (of n = ${P.n})`);

  // hover targets (bigger than the marks)
  svg
    .append("g")
    .selectAll("rect")
    .data(P.bins)
    .join("rect")
    .attr("x", (b) => x(b)! - (x.step() - bw) / 2)
    .attr("y", margin.top)
    .attr("width", x.step())
    .attr("height", y0 - margin.top + (showRatio ? gap + ratioH : 0))
    .attr("fill", "transparent")
    .on("mousemove", (ev: MouseEvent, b) => {
      const k = P.bins.indexOf(b);
      const f = (v: number | undefined) => (v === undefined ? "–" : fmt(v));
      const neuProp = P.neutral[k] / P.neutral.reduce((a, v) => a + v, 0);
      const mProp = P.model ? P.model[k] / P.model.reduce((a, v) => a + v, 0) : NaN;
      const rows = [
        `<strong>${inp.folded ? "Minor" : "Derived"} allele count ${b}</strong> of ${P.n}`,
        P.model ? `${inp.model!.label}: ${f(P.model[k])}` : "",
        inp.neutral ? `neutral: ${f(P.neutral[k])}` : "",
        P.model ? `ratio to neutral: ${fmt(mProp / neuProp)}` : "",
        P.ghost ? `${inp.ghost!.label}: ${f(P.ghost[k])}` : "",
        P.observed ? `${inp.observed!.label}: ${f(P.observed[k])}` : "",
      ].filter(Boolean);
      showTip(rows.join("<br>"), ev);
    })
    .on("mouseleave", hideTip);
  return svg.node()!;
}

/** Accessible data table for the same series. */
export function table1D(inp: Sfs1DInput): HTMLTableElement {
  const P = prepare(inp);
  const head = [inp.folded ? "Minor count" : "Derived count", inp.model ? inp.model.label : null, "Neutral", inp.ghost && P.ghost ? inp.ghost.label : null, inp.observed && P.observed ? inp.observed.label : null].filter(
    (x): x is string => x !== null,
  );
  const t = h("table", { class: "data-table" }, h("thead", {}, h("tr", {}, ...head.map((c) => h("th", { scope: "col" }, c)))));
  const tb = h("tbody");
  P.bins.forEach((b, k) => {
    const cells = [String(b), P.model ? fmt(P.model[k], 4) : null, fmt(P.neutral[k], 4), P.ghost ? fmt(P.ghost[k], 4) : null, P.observed ? fmt(P.observed[k], 4) : null].filter((x): x is string => x !== null);
    tb.append(h("tr", {}, ...cells.map((c, j) => (j === 0 ? h("th", { scope: "row" }, c) : h("td", {}, c)))));
  });
  t.append(tb);
  return t;
}
