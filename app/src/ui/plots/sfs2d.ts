/**
 * Joint (2D) SFS heatmap with the two marginal spectra on the sides. Rows (vertical axis) are
 * population 1 (i of n1), columns (horizontal axis) population 2 (j of n2), as in moments'
 * `plot_single_2d_sfs`. Log colour scale (cividis) for spectra; a diverging scale with a grey
 * midpoint for signed values (weights, residuals). Masked entries (corners, folded-out half)
 * are hatched.
 */

import { scaleBand, scaleLinear, scaleSequential, scaleSequentialLog, scaleDiverging, interpolateCividis, interpolateRgb, axisBottom, axisLeft, axisTop, axisRight, max as d3max } from "d3";
import { newSvg, theme, showTip, hideTip, styleAxis, GSel } from "./common.ts";
import { fmt, h } from "../dom.ts";

export interface HeatInput {
  shape: [number, number];
  values: ArrayLike<number>;
  mask: Uint8Array;
  kind: "log" | "diverging" | "linear";
  title: string;
  valueLabel: string;
  margins?: { pop1: number[]; pop2: number[]; label: string } | null; // polymorphic marginal bins 1..n-1 (or folded)
  size?: number;
  compact?: boolean; // small multiples: no marginals, short labels
}

export function drawHeatmap(container: HTMLElement, inp: HeatInput, width = 560): SVGSVGElement {
  const T = theme();
  const [d1, d2] = inp.shape;
  const n1 = d1 - 1;
  const n2 = d2 - 1;
  const compact = Boolean(inp.compact);
  const margW = inp.margins && !compact ? 64 : 0;
  const margin = { top: compact ? 26 : 34 + margW, right: (compact ? 10 : 18) + margW, bottom: compact ? 54 : 74, left: compact ? 44 : 56 };
  const S = Math.max(120, Math.min(inp.size ?? 380, width - margin.left - margin.right));
  const height = margin.top + S + margin.bottom;
  const W = margin.left + S + margin.right;
  const svg = newSvg(container, W, height, inp.title);
  svg.append("text").attr("x", 2).attr("y", 15).attr("font-size", compact ? 12 : 13).attr("font-weight", 600).attr("fill", T.ink).text(inp.title);

  const xs = scaleBand<number>().domain(Array.from({ length: d2 }, (_, j) => j)).range([margin.left, margin.left + S]).padding(0);
  const ys = scaleBand<number>().domain(Array.from({ length: d1 }, (_, i) => i)).range([margin.top + S, margin.top]).padding(0);

  const vals: number[] = [];
  for (let k = 0; k < inp.values.length; k++) if (!inp.mask[k] && Number.isFinite(inp.values[k])) vals.push(inp.values[k]);
  let color: (v: number) => string;
  let legendScale: { domain: number[]; kind: HeatInput["kind"] };
  if (inp.kind === "log") {
    const pos = vals.filter((v) => v > 0);
    const hi = d3max(pos) ?? 1;
    const lo = Math.max(pos.length ? Math.min(...pos) : hi * 1e-4, hi * 1e-5);
    const sc = scaleSequentialLog(interpolateCividis).domain([lo, hi]).clamp(true);
    color = (v) => (v > 0 ? sc(v) : T.surface);
    legendScale = { domain: [lo, hi], kind: "log" };
  } else if (inp.kind === "linear") {
    const hi = d3max(vals) ?? 1;
    const lo = Math.min(0, ...vals);
    const sc = scaleSequential(interpolateCividis).domain([lo, hi]);
    color = (v) => sc(v);
    legendScale = { domain: [lo, hi], kind: "linear" };
  } else {
    const M = d3max(vals.map(Math.abs)) || 1;
    const neg = interpolateRgb(T.divNeg, T.divMid);
    const pos = interpolateRgb(T.divMid, T.divPos);
    const sc = scaleDiverging((t: number) => (t < 0.5 ? neg(t * 2) : pos((t - 0.5) * 2))).domain([-M, 0, M]);
    color = (v) => sc(v);
    legendScale = { domain: [-M, M], kind: "diverging" };
  }

  // hatch pattern for masked entries
  const pid = `hatch-${Math.random().toString(36).slice(2, 8)}`;
  const pat = svg.append("defs").append("pattern").attr("id", pid).attr("patternUnits", "userSpaceOnUse").attr("width", 6).attr("height", 6).attr("patternTransform", "rotate(45)");
  pat.append("rect").attr("width", 6).attr("height", 6).attr("fill", T.surface);
  pat.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6).attr("stroke", T.grid).attr("stroke-width", 2);

  const cells: { i: number; j: number; v: number; m: boolean }[] = [];
  for (let i = 0; i < d1; i++) for (let j = 0; j < d2; j++) cells.push({ i, j, v: inp.values[i * d2 + j], m: Boolean(inp.mask[i * d2 + j]) });
  svg
    .append("g")
    .selectAll("rect")
    .data(cells)
    .join("rect")
    .attr("x", (c) => xs(c.j)!)
    .attr("y", (c) => ys(c.i)!)
    .attr("width", xs.bandwidth() + 0.3)
    .attr("height", ys.bandwidth() + 0.3)
    .attr("fill", (c) => (c.m || !Number.isFinite(c.v) ? `url(#${pid})` : color(c.v)))
    .on("mousemove", (ev: MouseEvent, c) =>
      showTip(`<strong>pop 1: ${c.i} of ${n1}; pop 2: ${c.j} of ${n2}</strong><br>${c.m ? "masked" : `${inp.valueLabel}: ${fmt(c.v)}`}`, ev),
    )
    .on("mouseleave", hideTip);
  svg.append("rect").attr("x", margin.left).attr("y", margin.top).attr("width", S).attr("height", S).attr("fill", "none").attr("stroke", T.axis);

  const tickEvery = (n: number): number[] => {
    const step = n <= 10 ? 1 : n <= 20 ? 5 : 10;
    return Array.from({ length: n + 1 }, (_, k) => k).filter((k) => k % step === 0 || k === n);
  };
  const gx = svg.append("g").attr("transform", `translate(0,${margin.top + S})`).call(axisBottom(xs).tickValues(tickEvery(n2)).tickSizeOuter(0)) as unknown as GSel;
  styleAxis(gx, T);
  const gy = svg.append("g").attr("transform", `translate(${margin.left},0)`).call(axisLeft(ys).tickValues(tickEvery(n1)).tickSizeOuter(0)) as unknown as GSel;
  styleAxis(gy, T);
  svg.append("text").attr("x", margin.left + S / 2).attr("y", margin.top + S + 30).attr("text-anchor", "middle").attr("font-size", 11).attr("fill", T.pop2 === "" ? T.ink2 : T.ink2).text(compact ? "pop 2" : `Derived count in pop 2 (j of ${n2})`);
  svg
    .append("text")
    .attr("transform", `translate(${margin.left - (compact ? 32 : 38)},${margin.top + S / 2}) rotate(-90)`)
    .attr("text-anchor", "middle")
    .attr("font-size", 11)
    .attr("fill", T.ink2)
    .text(compact ? "pop 1" : `Derived count in pop 1 (i of ${n1})`);

  // marginals
  if (inp.margins && !compact) {
    const top = inp.margins.pop2;
    const right = inp.margins.pop1;
    const mt = scaleLinear().domain([0, d3max(top) || 1]).range([0, margW - 10]);
    const mr = scaleLinear().domain([0, d3max(right) || 1]).range([0, margW - 10]);
    const gTop = svg.append("g");
    top.forEach((v, k) => {
      const j = k + 1;
      if (j >= d2) return;
      const hh = mt(v);
      gTop.append("rect").attr("x", xs(j)! + 0.5).attr("y", margin.top - 4 - hh).attr("width", Math.max(1, xs.bandwidth() - 1)).attr("height", hh).attr("fill", T.pop2);
    });
    const gRight = svg.append("g");
    right.forEach((v, k) => {
      const i = k + 1;
      if (i >= d1) return;
      const ww = mr(v);
      gRight.append("rect").attr("x", margin.left + S + 4).attr("y", ys(i)! + 0.5).attr("width", ww).attr("height", Math.max(1, ys.bandwidth() - 1)).attr("fill", T.pop1);
    });
    if (inp.margins.label) svg.append("text").attr("x", margin.left + S + 6).attr("y", margin.top - 8).attr("font-size", 10).attr("fill", T.ink3).text(inp.margins.label);
    void axisTop;
    void axisRight;
  }

  // colour legend (horizontal bar under the x axis label)
  const lgW = Math.min(220, S - 70);
  const lgY = margin.top + S + (compact ? 38 : 46);
  const lgX = margin.left + (S - lgW) / 2;
  const gid = `lg-${Math.random().toString(36).slice(2, 8)}`;
  const grad = svg.append("defs").append("linearGradient").attr("id", gid);
  for (let k = 0; k <= 20; k++) {
    const t = k / 20;
    let v: number;
    if (legendScale.kind === "log") v = Math.exp(Math.log(legendScale.domain[0]) + t * (Math.log(legendScale.domain[1]) - Math.log(legendScale.domain[0])));
    else v = legendScale.domain[0] + t * (legendScale.domain[1] - legendScale.domain[0]);
    grad.append("stop").attr("offset", `${t * 100}%`).attr("stop-color", color(v));
  }
  svg.append("rect").attr("x", lgX).attr("y", lgY).attr("width", lgW).attr("height", 9).attr("fill", `url(#${gid})`).attr("rx", 2);
  svg.append("text").attr("x", lgX - 4).attr("y", lgY + 8).attr("text-anchor", "end").attr("font-size", 10).attr("fill", T.ink2).text(fmt(legendScale.domain[0], 2));
  svg.append("text").attr("x", lgX + lgW + 4).attr("y", lgY + 8).attr("font-size", 10).attr("fill", T.ink2).text(fmt(legendScale.domain[1], 2));
  if (!compact) svg.append("text").attr("x", lgX + lgW / 2).attr("y", lgY + 21).attr("text-anchor", "middle").attr("font-size", 10).attr("fill", T.ink3).text(`${inp.valueLabel}${legendScale.kind === "log" ? " (log scale)" : ""}`);
  return svg.node()!;
}

/** Accessible data table of a joint spectrum (rows = pop 1, columns = pop 2). */
export function table2D(shape: [number, number], values: ArrayLike<number>, mask: Uint8Array): HTMLTableElement {
  const [d1, d2] = shape;
  const t = h("table", { class: "data-table matrix" }, h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "i \\ j"), ...Array.from({ length: d2 }, (_, j) => h("th", { scope: "col" }, String(j))))));
  const tb = h("tbody");
  for (let i = 0; i < d1; i++)
    tb.append(h("tr", {}, h("th", { scope: "row" }, String(i)), ...Array.from({ length: d2 }, (_, j) => h("td", {}, mask[i * d2 + j] ? "masked" : fmt(values[i * d2 + j], 3)))));
  t.append(tb);
  return t;
}
