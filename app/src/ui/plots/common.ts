/**
 * Shared plotting helpers: theme colours (from CSS custom properties, so light and dark themes
 * work), a single tooltip, SVG creation, and export of a figure as SVG or PNG.
 *
 * Colours: Okabe–Ito for categories (validated with the colour-vision checks of the dataviz
 * guidance, light and dark steps); cividis for sequential heatmaps; a two-hue diverging scale
 * with a grey midpoint for signed weights and residuals.
 */

import { select, type Selection } from "d3";

export type SVGSel = Selection<SVGSVGElement, unknown, null, undefined>;
export type GSel = Selection<SVGGElement, unknown, null, undefined>;

export interface Theme {
  surface: string;
  ink: string;
  ink2: string;
  ink3: string;
  grid: string;
  axis: string;
  pop1: string;
  pop2: string;
  anc: string;
  pulse: string;
  ghost: string;
  obs: string;
  neutral: string;
  divNeg: string;
  divPos: string;
  divMid: string;
  font: string;
}

export function theme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
  return {
    surface: v("--surface", "#fcfcfb"),
    ink: v("--ink", "#1d1d1b"),
    ink2: v("--ink-2", "#4a4a46"),
    ink3: v("--ink-3", "#6b6b66"),
    grid: v("--grid", "#e6e5e0"),
    axis: v("--axis", "#8a8984"),
    pop1: v("--c-pop1", "#0072B2"),
    pop2: v("--c-pop2", "#E69F00"),
    anc: v("--c-anc", "#009E73"),
    pulse: v("--c-pulse", "#D55E00"),
    ghost: v("--c-ghost", "#a3a29c"),
    obs: v("--c-obs", "#D55E00"),
    neutral: v("--c-neutral", "#1d1d1b"),
    divNeg: v("--c-div-neg", "#0072B2"),
    divPos: v("--c-div-pos", "#D55E00"),
    divMid: v("--c-div-mid", "#d9d8d3"),
    font: v("--font-sans", "system-ui, sans-serif"),
  };
}

// ---------------------------------------------------------------- tooltip

let tipEl: HTMLDivElement | null = null;
function tip(): HTMLDivElement {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "tooltip";
    tipEl.setAttribute("role", "tooltip");
    tipEl.hidden = true;
    document.body.append(tipEl);
  }
  return tipEl;
}

export function showTip(html: string, ev: MouseEvent | PointerEvent): void {
  const t = tip();
  t.innerHTML = html;
  t.hidden = false;
  const pad = 14;
  const { innerWidth: W, innerHeight: H } = window;
  const r = t.getBoundingClientRect();
  let x = ev.clientX + pad;
  let y = ev.clientY + pad;
  if (x + r.width > W - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > H - 8) y = ev.clientY - r.height - pad;
  t.style.left = `${Math.max(4, x)}px`;
  t.style.top = `${Math.max(4, y)}px`;
}

export function hideTip(): void {
  if (tipEl) tipEl.hidden = true;
}

// ---------------------------------------------------------------- svg

export function newSvg(container: HTMLElement, width: number, height: number, label: string): SVGSel {
  container.querySelector("svg.plot")?.remove();
  const svg = select(container)
    .append("svg")
    .attr("class", "plot")
    .attr("xmlns", "http://www.w3.org/2000/svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", width)
    .attr("height", height)
    .attr("role", "img")
    .attr("aria-label", label)
    .style("max-width", "100%")
    .style("height", "auto");
  const T = theme();
  svg.attr("font-family", T.font).attr("font-size", 12).attr("fill", T.ink);
  return svg;
}

/** Width available in a container (falls back to a default in tests). */
export function widthOf(el: HTMLElement, fallback = 560): number {
  const w = el.clientWidth;
  return w > 50 ? Math.floor(w) : fallback;
}

/** Style an axis group: recessive lines, readable tick labels. */
export function styleAxis(g: GSel, T: Theme): void {
  g.selectAll("path.domain").attr("stroke", T.axis);
  g.selectAll(".tick line").attr("stroke", T.axis);
  g.selectAll(".tick text").attr("fill", T.ink2).attr("font-size", 11);
}

/** Bar with rounded top corners (radius r), anchored square on the baseline. */
export function barPath(x: number, y: number, w: number, h: number, r = 3, up = true): string {
  if (h <= 0 || w <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  if (up)
    return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
  return `M${x},${y}V${y + h - rr}Q${x},${y + h} ${x + rr},${y + h}H${x + w - rr}Q${x + w},${y + h} ${x + w},${y + h - rr}V${y}Z`;
}

// ---------------------------------------------------------------- export

function serialise(svgEl: SVGSVGElement): { text: string; width: number; height: number } {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  const vb = (svgEl.getAttribute("viewBox") ?? "0 0 600 400").split(/\s+/).map(Number);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(vb[2]));
  clone.setAttribute("height", String(vb[3]));
  clone.removeAttribute("style");
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", String(vb[0]));
  bg.setAttribute("y", String(vb[1]));
  bg.setAttribute("width", String(vb[2]));
  bg.setAttribute("height", String(vb[3]));
  bg.setAttribute("fill", theme().surface);
  clone.insertBefore(bg, clone.firstChild);
  return { text: new XMLSerializer().serializeToString(clone), width: vb[2], height: vb[3] };
}

export function svgBlob(svgEl: SVGSVGElement): Blob {
  return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${serialise(svgEl).text}`], { type: "image/svg+xml;charset=utf-8" });
}

export async function pngBlob(svgEl: SVGSVGElement, scale = 3): Promise<Blob> {
  const { text, width, height } = serialise(svgEl);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml;charset=utf-8" }));
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("could not render the figure"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("PNG export failed"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** An HTML legend row (legends are HTML, so they wrap on small screens). */
export function legend(items: { label: string; color: string; kind: "bar" | "line" | "dash" | "dot" | "ghost" }[]): HTMLElement {
  const ul = document.createElement("ul");
  ul.className = "legend";
  for (const it of items) {
    const li = document.createElement("li");
    const sw = document.createElement("span");
    sw.className = `swatch swatch-${it.kind}`;
    sw.style.setProperty("--sw", it.color);
    li.append(sw, document.createTextNode(it.label));
    ul.append(li);
  }
  return ul;
}

type LegendItem = { label: string; color: string; kind: "bar" | "line" | "dash" | "dot" | "ghost" };
const itemWidth = (it: LegendItem): number => 18 + it.label.length * 6.1 + 14;

/** Number of rows a legend needs within maxWidth (estimated from the label lengths). */
export function legendRows(items: LegendItem[], maxWidth: number): number {
  let rows = 1;
  let cx = 0;
  for (const it of items) {
    const w = itemWidth(it);
    if (cx > 0 && cx + w > maxWidth) {
      rows++;
      cx = 0;
    }
    cx += w;
  }
  return rows;
}

/** Legend drawn inside an SVG (for exported figures), top-left at (x, y); wraps at maxWidth. Returns the number of rows. */
export function svgLegend(g: GSel, items: LegendItem[], x: number, y: number, T: Theme, maxWidth = Infinity): number {
  let cx = x;
  let cy = y;
  let rows = 1;
  for (const it of items) {
    const w = itemWidth(it);
    if (cx > x && cx - x + w > maxWidth) {
      cx = x;
      cy += 16;
      rows++;
    }
    const gi = g.append("g").attr("transform", `translate(${cx},${cy})`);
    if (it.kind === "bar") gi.append("rect").attr("x", 0).attr("y", -8).attr("width", 12).attr("height", 10).attr("rx", 2).attr("fill", it.color);
    else if (it.kind === "ghost") gi.append("rect").attr("x", 0.5).attr("y", -7.5).attr("width", 11).attr("height", 9).attr("fill", "none").attr("stroke", it.color).attr("stroke-width", 1.5).attr("stroke-dasharray", "3 2");
    else if (it.kind === "dot") gi.append("circle").attr("cx", 6).attr("cy", -3).attr("r", 4).attr("fill", it.color);
    else gi.append("line").attr("x1", 0).attr("x2", 14).attr("y1", -3).attr("y2", -3).attr("stroke", it.color).attr("stroke-width", 2).attr("stroke-dasharray", it.kind === "dash" ? "4 3" : null);
    gi.append("text").attr("x", 18).attr("y", 1).attr("font-size", 11).attr("fill", T.ink2).text(it.label);
    cx += w;
  }
  return rows;
}
