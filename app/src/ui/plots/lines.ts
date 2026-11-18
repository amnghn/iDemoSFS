/**
 * Line chart with markers, a crosshair and a tooltip; used for the parameter sweep (one small
 * chart per statistic, never two y axes), the F_ST teaching plots and the estimator weights.
 */

import { scaleLinear, scaleLog, axisBottom, axisLeft, extent, line as d3line, pointer } from "d3";
import { newSvg, theme, showTip, hideTip, styleAxis, svgLegend, legendRows, GSel } from "./common.ts";
import { fmt, h } from "../dom.ts";

export interface LineSeries {
  label: string;
  color: string;
  dash?: string | null;
  points: { x: number; y: number }[];
  bars?: boolean; // draw as thin bars instead of a line (for a background spectrum)
}

export interface LineInput {
  title: string;
  xLabel: string;
  yLabel: string;
  series: LineSeries[];
  xLog?: boolean;
  yZero?: boolean; // include 0 in the y domain
  yDomain?: [number, number];
  height?: number;
  markers?: boolean;
  xFormat?: (x: number) => string;
  xTicks?: number[];
  refLine?: number | null; // horizontal reference line (for example 0 or 1)
  legend?: boolean;
}

/** Readable ticks for a log axis: powers of ten, adding 2 and 5 when the range is short. */
function logTicks([lo, hi]: [number, number]): number[] {
  const out: number[] = [];
  const mants = Math.log10(hi / lo) <= 2.5 ? [1, 2, 5] : [1];
  for (let e = Math.floor(Math.log10(lo)) - 1; e <= Math.ceil(Math.log10(hi)); e++) for (const m of mants) {
    const v = m * 10 ** e;
    if (v >= lo * 0.999 && v <= hi * 1.001) out.push(Number(v.toPrecision(3)));
  }
  return out.length >= 2 ? out : [lo, hi];
}

export function drawLines(container: HTMLElement, inp: LineInput, width = 360): SVGSVGElement {
  const T = theme();
  const showLegend = inp.legend !== false && inp.series.length > 1;
  const legItems = inp.series.map((s) => ({ label: s.label, color: s.color, kind: (s.bars ? "bar" : s.dash ? "dash" : "line") as "bar" | "dash" | "line" }));
  const rows = showLegend ? legendRows(legItems, width - 8) : 0;
  const margin = { top: showLegend ? 26 + 16 * rows : 26, right: 14, bottom: 40, left: 58 };
  const height = (inp.height ?? 220) + (rows > 1 ? 16 * (rows - 1) : 0);
  const svg = newSvg(container, width, height, inp.title);
  svg.append("text").attr("x", 2).attr("y", 14).attr("font-size", 12.5).attr("font-weight", 600).attr("fill", T.ink).text(inp.title);
  if (showLegend)
    svgLegend(svg as unknown as GSel, legItems, 4, 32, T, width - 8);
  const pts = inp.series.flatMap((s) => s.points).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const xe = extent(pts, (p) => p.x) as [number, number];
  if (xe[0] === undefined) {
    svg.append("text").attr("x", width / 2).attr("y", height / 2).attr("text-anchor", "middle").attr("fill", T.ink3).text("no values yet");
    return svg.node()!;
  }
  if (xe[0] === xe[1]) {
    xe[0] -= 0.5;
    xe[1] += 0.5;
  }
  const x = (inp.xLog ? scaleLog() : scaleLinear()).domain(xe).range([margin.left, width - margin.right]);
  let ye = inp.yDomain ?? (extent(pts, (p) => p.y) as [number, number]);
  if (inp.yZero) ye = [Math.min(0, ye[0]), Math.max(0, ye[1])];
  if (inp.refLine !== null && inp.refLine !== undefined) ye = [Math.min(ye[0], inp.refLine), Math.max(ye[1], inp.refLine)];
  if (ye[0] === ye[1]) ye = [ye[0] - Math.abs(ye[0] || 1) * 0.1, ye[1] + Math.abs(ye[1] || 1) * 0.1];
  const y = scaleLinear().domain(ye).nice().range([height - margin.bottom, margin.top]);
  for (const t of y.ticks(4)) svg.append("line").attr("x1", margin.left).attr("x2", width - margin.right).attr("y1", y(t)).attr("y2", y(t)).attr("stroke", T.grid);
  if (inp.refLine !== null && inp.refLine !== undefined)
    svg.append("line").attr("x1", margin.left).attr("x2", width - margin.right).attr("y1", y(inp.refLine)).attr("y2", y(inp.refLine)).attr("stroke", T.axis).attr("stroke-dasharray", "4 3");
  const gx = svg
    .append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(
      (inp.xTicks ? axisBottom(x).tickValues(inp.xTicks) : inp.xLog ? axisBottom(x).tickValues(logTicks(xe)) : axisBottom(x).ticks(5)).tickFormat((d) =>
        inp.xFormat ? inp.xFormat(Number(d)) : fmt(Number(d), 2),
      ),
    ) as unknown as GSel;
  styleAxis(gx, T);
  // step-aware tick labels (for example 0.0004, 0.095), with a true minus sign
  const yFmt = y.tickFormat(4);
  const gy = svg.append("g").attr("transform", `translate(${margin.left},0)`).call(axisLeft(y).ticks(4).tickFormat((d) => yFmt(Number(d)).replace("-", "−"))) as unknown as GSel;
  styleAxis(gy, T);
  svg.append("text").attr("x", (margin.left + width - margin.right) / 2).attr("y", height - 6).attr("text-anchor", "middle").attr("font-size", 11).attr("fill", T.ink2).text(inp.xLabel);
  if (inp.yLabel)
    svg
      .append("text")
      .attr("transform", `translate(13,${(margin.top + height - margin.bottom) / 2}) rotate(-90)`)
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .attr("fill", T.ink2)
      .text(inp.yLabel);

  for (const s of inp.series) {
    const p = s.points.filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
    if (s.bars) {
      const bw = Math.max(2, ((width - margin.left - margin.right) / Math.max(1, p.length)) * 0.6);
      svg
        .append("g")
        .selectAll("rect")
        .data(p)
        .join("rect")
        .attr("x", (q) => x(q.x) - bw / 2)
        .attr("y", (q) => Math.min(y(q.y), y(0)))
        .attr("width", bw)
        .attr("height", (q) => Math.abs(y(0) - y(q.y)))
        .attr("fill", s.color)
        .attr("fill-opacity", 0.35)
        .attr("rx", 1.5);
      continue;
    }
    const ln = d3line<{ x: number; y: number }>()
      .x((q) => x(q.x))
      .y((q) => y(q.y));
    svg.append("path").attr("d", ln(p)).attr("fill", "none").attr("stroke", s.color).attr("stroke-width", 2).attr("stroke-dasharray", s.dash ?? null);
    if (inp.markers !== false && p.length <= 40)
      svg
        .append("g")
        .selectAll("circle")
        .data(p)
        .join("circle")
        .attr("cx", (q) => x(q.x))
        .attr("cy", (q) => y(q.y))
        .attr("r", 3)
        .attr("fill", s.dash ? T.surface : s.color)
        .attr("stroke", s.color)
        .attr("stroke-width", 1.5);
  }
  // crosshair + tooltip
  const xs = [...new Set(pts.map((p) => p.x))].sort((a, b) => a - b);
  const cross = svg.append("line").attr("y1", margin.top).attr("y2", height - margin.bottom).attr("stroke", T.axis).attr("stroke-width", 1).style("display", "none");
  svg
    .append("rect")
    .attr("x", margin.left)
    .attr("y", margin.top)
    .attr("width", width - margin.left - margin.right)
    .attr("height", height - margin.top - margin.bottom)
    .attr("fill", "transparent")
    .on("mousemove", (ev: MouseEvent) => {
      const [mx] = pointer(ev);
      const xv = x.invert(mx);
      let best = xs[0];
      for (const v of xs) if (Math.abs(v - xv) < Math.abs(best - xv)) best = v;
      cross.attr("x1", x(best)).attr("x2", x(best)).style("display", null);
      const rows = inp.series
        .map((s) => {
          const q = s.points.find((p) => p.x === best);
          return q ? `<span class="tip-sw" style="--sw:${s.color}"></span>${s.label}: ${fmt(q.y)}` : "";
        })
        .filter(Boolean);
      showTip(`<strong>${inp.xLabel}: ${inp.xFormat ? inp.xFormat(best) : fmt(best)}</strong><br>${rows.join("<br>")}`, ev);
    })
    .on("mouseleave", () => {
      cross.style("display", "none");
      hideTip();
    });
  return svg.node()!;
}

export function tableLines(inp: LineInput): HTMLTableElement {
  const xs = [...new Set(inp.series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
  const t = h("table", { class: "data-table" }, h("thead", {}, h("tr", {}, h("th", { scope: "col" }, inp.xLabel), ...inp.series.map((s) => h("th", { scope: "col" }, s.label)))));
  const tb = h("tbody");
  for (const xv of xs)
    tb.append(
      h(
        "tr",
        {},
        h("th", { scope: "row" }, inp.xFormat ? inp.xFormat(xv) : fmt(xv, 4)),
        ...inp.series.map((s) => h("td", {}, fmt(s.points.find((p) => p.x === xv)?.y ?? NaN, 4))),
      ),
    );
  t.append(tb);
  return t;
}
