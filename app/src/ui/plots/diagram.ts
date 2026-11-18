/**
 * Demographic history diagram: "tubes" in the style of demesdraw (Gower et al. 2022) and the
 * GADMA model drawings. Width = population size (log or linear), vertical axis = time before
 * present (present at the bottom), arrows = migration (forward in time), a separate thick arrow
 * for an admixture pulse. Dashed outlines, as in the reference screenshots.
 */

import { scaleLinear, scaleSymlog, axisLeft } from "d3";
import { Model, Dynamics, epochBounds } from "../../engine/model.ts";
import { LIMITS } from "../../engine/limits.ts";
import { DisplayState, UnitsState, structureText } from "../state.ts";
import { newSvg, theme, showTip, hideTip, styleAxis, Theme, GSel } from "./common.ts";
import { fmt, intFmt } from "../dom.ts";

export interface DiagramTarget {
  kind: "ancestral" | "post" | "split" | "migration" | "pulse";
  index: number;
  pop?: 0 | 1;
}

interface Tube {
  label: string;
  pop: "anc" | 0 | 1;
  start: number; // time before present (older)
  end: number; // younger
  startNu: number;
  endNu: number;
  dyn: Dynamics;
  target: DiagramTarget;
}

function sizeAt(dyn: Dynamics, a: number, b: number, f: number): number {
  if (dyn === "sudden") return b;
  if (dyn === "linear") return a + f * (b - a);
  return a * Math.exp(Math.log(b / a) * f);
}

const DYN_LABEL: Record<Dynamics, string> = { sudden: "sudden", linear: "linear", exponential: "exponential" };

function timeLabel(t: number, units: UnitsState): string {
  if (!units.physical) return `${fmt(t)} × 2N_ref gen.`;
  const gen = t * 2 * units.Nref;
  const years = gen * units.gen;
  return units.gen === 1 ? `${intFmt(years)} years (generation time 1 year)` : `${intFmt(years)} years (${intFmt(gen)} generations)`;
}

function sizeLabel(nu: number, units: UnitsState): string {
  return units.physical ? `ν = ${fmt(nu)} (N ≈ ${intFmt(nu * units.Nref)})` : `ν = ${fmt(nu)}`;
}

function shortYears(y: number): string {
  if (y >= 1e6) return `${fmt(y / 1e6, 2)} M`;
  if (y >= 1e3) return `${fmt(y / 1e3, 2)} k`;
  return fmt(y, 2);
}

export function drawDiagram(
  container: HTMLElement,
  m: Model,
  display: DisplayState,
  units: UnitsState,
  onSelect?: (t: DiagramTarget) => void,
  width = 420,
  height = 360,
): SVGSVGElement {
  const T = theme();
  const svg = newSvg(container, width, height, `Demographic history diagram. Structure ${structureText(m)}.`);
  const margin = { top: 40, right: 12, bottom: 34, left: 74 };
  const PW = width - margin.left - margin.right;

  // ---- tubes
  const tubes: Tube[] = [];
  const postTs = m.mode === 2 ? m.post.map((e) => e.T) : [];
  const postB = epochBounds(postTs, 0);
  const Tsplit = m.mode === 2 ? postB[0].start : 0;
  const ancB = epochBounds(
    m.ancestral.map((e) => e.T),
    Tsplit,
  );
  let prev = 1;
  m.ancestral.forEach((e, k) => {
    tubes.push({ label: `Ancestral epoch ${k + 1}`, pop: "anc", start: ancB[k].start, end: ancB[k].end, startNu: prev, endNu: e.nu, dyn: e.dyn, target: { kind: "ancestral", index: k } });
    prev = e.nu;
  });
  const ancEnd = prev;
  let start2: [number, number] = [1, 1];
  if (m.mode === 2) {
    start2 = m.split.useFraction ? [m.split.s * ancEnd, (1 - m.split.s) * ancEnd] : [m.split.nu1, m.split.nu2];
    const p = [...start2];
    m.post.forEach((e, k) => {
      for (const q of [0, 1] as const) {
        tubes.push({
          label: `Population ${q + 1}, epoch ${k + 1} after the split`,
          pop: q,
          start: postB[k].start,
          end: postB[k].end,
          startNu: p[q],
          endNu: e.nu[q],
          dyn: e.dyn[q],
          target: { kind: "post", index: k, pop: q },
        });
      }
      p[0] = e.nu[0];
      p[1] = e.nu[1];
    });
  }
  const Ttop = Math.max(...tubes.map((t) => t.start), 1e-6);

  // ---- scales
  const yBottom = height - margin.bottom;
  const yTop = margin.top + 26; // leave room for the equilibrium stub
  const y =
    display.timeScale === "linear"
      ? scaleLinear().domain([0, Ttop]).range([yBottom, yTop])
      : scaleSymlog().constant(Math.max(Ttop / 60, 1e-4)).domain([0, Ttop]).range([yBottom, yTop]);

  const allNu = tubes.flatMap((t) => [t.startNu, t.endNu]).concat([1]);
  const nuMax = Math.max(...allNu);
  const wMaxAnc = m.mode === 1 ? PW * 0.6 : PW * 0.44;
  const wMaxDau = PW * 0.36;
  const wMin = 6;
  const widthOf = (nu: number, wMax: number): number => {
    if (display.widthScale === "linear") return Math.max(wMin, (wMax * nu) / nuMax);
    const f = (Math.log10(nu) - Math.log10(LIMITS.nu.min)) / (Math.log10(LIMITS.nu.max) - Math.log10(LIMITS.nu.min));
    return wMin + Math.max(0, Math.min(1, f)) * (wMax - wMin);
  };
  const cxAnc = margin.left + PW / 2;
  const cx = (pop: Tube["pop"]): number => (pop === "anc" ? cxAnc : pop === 0 ? margin.left + PW * 0.24 : margin.left + PW * 0.76);
  const wMaxOf = (pop: Tube["pop"]): number => (pop === "anc" ? wMaxAnc : wMaxDau);
  const color = (pop: Tube["pop"]): string => (m.mode === 1 ? T.pop1 : pop === "anc" ? T.anc : pop === 0 ? T.pop1 : T.pop2);

  // ---- defs: arrowheads
  const defs = svg.append("defs");
  const marker = (id: string, fill: string): void => {
    defs
      .append("marker")
      .attr("id", id)
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 9)
      .attr("refY", 5)
      .attr("markerWidth", 7)
      .attr("markerHeight", 7)
      .attr("orient", "auto-start-reverse")
      .append("path")
      .attr("d", "M0,0L10,5L0,10z")
      .attr("fill", fill);
  };
  const uid = Math.random().toString(36).slice(2, 8);
  marker(`ah-mig-${uid}`, T.ink2);
  marker(`ah-pulse-${uid}`, T.pulse);
  marker(`ah-anc-${uid}`, T.anc);

  // ---- title
  svg
    .append("text")
    .attr("x", margin.left)
    .attr("y", 18)
    .attr("font-size", 13)
    .attr("font-weight", 600)
    .attr("fill", T.ink)
    .text(`Structure: ${structureText(m)}`);
  svg
    .append("text")
    .attr("x", width - margin.right)
    .attr("y", 18)
    .attr("text-anchor", "end")
    .attr("font-size", 11)
    .attr("fill", T.ink3)
    .text(`width: ${display.widthScale === "log" ? "log" : "linear"} size`);

  // ---- time axis
  const ax = svg.append("g").attr("transform", `translate(${margin.left - 8},0)`) as unknown as GSel;
  const ticks = timeTicks(Ttop, display.timeScale, y as (t: number) => number);
  const axis = axisLeft(y as never)
    .tickValues(ticks)
    .tickFormat((d) => (units.physical ? shortYears(Number(d) * 2 * units.Nref * units.gen) : String(Number(Number(d).toPrecision(2)))));
  ax.call(axis as never);
  styleAxis(ax, T);
  svg
    .append("text")
    .attr("transform", `translate(12,${(yTop + yBottom) / 2}) rotate(-90)`)
    .attr("text-anchor", "middle")
    .attr("font-size", 11)
    .attr("fill", T.ink2)
    .text(units.physical ? "Years before present" : "Time before present (2N_ref generations)");

  // epoch boundaries (dotted, recessive)
  const bounds = new Set<number>(tubes.map((t) => t.end).concat(tubes.map((t) => t.start)));
  const gb = svg.append("g");
  for (const b of bounds) {
    if (b <= 0) continue;
    gb.append("line")
      .attr("x1", margin.left - 4)
      .attr("x2", width - margin.right)
      .attr("y1", y(b))
      .attr("y2", y(b))
      .attr("stroke", T.grid)
      .attr("stroke-dasharray", "2 3");
  }

  // ---- equilibrium stub above the oldest epoch
  const first = tubes[0];
  const wStub = widthOf(1, wMaxOf("anc"));
  const gStub = svg.append("g");
  gStub
    .append("rect")
    .attr("x", cxAnc - wStub / 2)
    .attr("y", yTop - 22)
    .attr("width", wStub)
    .attr("height", 22)
    .attr("fill", color(first.pop))
    .attr("fill-opacity", 0.08)
    .attr("stroke", color(first.pop))
    .attr("stroke-opacity", 0.5)
    .attr("stroke-dasharray", "2 3");
  gStub
    .append("text")
    .attr("x", cxAnc)
    .attr("y", yTop - 8)
    .attr("text-anchor", "middle")
    .attr("font-size", 10)
    .attr("fill", T.ink3)
    .text("equilibrium, ν = 1");

  // ---- tubes
  const gt = svg.append("g");
  const K = 28;
  for (const t of tubes) {
    const c = cx(t.pop);
    const wMax = wMaxOf(t.pop);
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    for (let k = 0; k <= K; k++) {
      const f = k / K;
      const time = t.start - f * (t.start - t.end);
      const w = widthOf(sizeAt(t.dyn, t.startNu, t.endNu, t.dyn === "sudden" ? 1 : f), wMax);
      left.push([c - w / 2, y(time)]);
      right.push([c + w / 2, y(time)]);
    }
    const pts = left.concat(right.reverse());
    const d = `M${pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join("L")}Z`;
    const col = color(t.pop);
    const tip = `<strong>${t.label}</strong><br>${sizeLabel(t.endNu, units)} at the end<br>dynamics: ${DYN_LABEL[t.dyn]}${t.dyn !== "sudden" ? ` (from ν = ${fmt(t.startNu)})` : ""}<br>duration: ${timeLabel(t.start - t.end, units)}<br>from ${timeLabel(t.start, units)} to ${t.end === 0 ? "the present" : timeLabel(t.end, units)}`;
    gt.append("path")
      .attr("d", d)
      .attr("fill", col)
      .attr("fill-opacity", 0.18)
      .attr("stroke", col)
      .attr("stroke-width", 1.6)
      .attr("stroke-dasharray", "5 3")
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", `${t.label}: ${sizeLabel(t.endNu, units)} at the end, ${DYN_LABEL[t.dyn]} change. Select to edit.`)
      .style("cursor", "pointer")
      .on("mousemove", (ev: MouseEvent) => showTip(tip, ev))
      .on("mouseleave", hideTip)
      .on("click", () => onSelect?.(t.target))
      .on("keydown", (ev: KeyboardEvent) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onSelect?.(t.target);
        }
      });
    // a short label inside the tube (or beside it when the tube is thin)
    const yMid = (y(t.start) + y(t.end)) / 2;
    const h = y(t.end) - y(t.start);
    if (h > 14) {
      const wEnd = widthOf(t.endNu, wMax);
      const outside = wEnd < 46;
      const side = t.pop === 1 ? 1 : t.pop === 0 ? -1 : 1;
      gt.append("text")
        .attr("x", outside ? c + side * (wEnd / 2 + 4) : c)
        .attr("y", yMid + 4)
        .attr("text-anchor", outside ? (side > 0 ? "start" : "end") : "middle")
        .attr("font-size", 10.5)
        .attr("fill", T.ink2)
        .attr("pointer-events", "none")
        .text(`ν ${fmt(t.endNu, 2)}`);
    }
  }

  // ---- split connectors and sample labels
  if (m.mode === 2) {
    const ySplit = y(Tsplit);
    const wA = widthOf(ancEnd, wMaxAnc);
    for (const q of [0, 1] as const) {
      const xFrom = cxAnc + (q === 0 ? -wA / 2 : wA / 2);
      const xTo = cx(q);
      gt.append("path")
        .attr("d", `M${xFrom},${ySplit}C${(xFrom + xTo) / 2},${ySplit - 6} ${xTo},${ySplit - 4} ${xTo},${ySplit + 1}`)
        .attr("fill", "none")
        .attr("stroke", T.anc)
        .attr("stroke-width", 1.3)
        .attr("marker-end", `url(#ah-anc-${uid})`);
    }
    for (const q of [0, 1] as const)
      svg
        .append("text")
        .attr("x", cx(q))
        .attr("y", height - 12)
        .attr("text-anchor", "middle")
        .attr("font-size", 12)
        .attr("font-weight", 600)
        .attr("fill", q === 0 ? T.pop1 : T.pop2)
        .text(`pop ${q + 1}`);
    drawGeneFlow(svg as unknown as GSel, m, postB, y as (t: number) => number, (q, time) => {
      const tb = tubes.find((t) => t.pop === q && time <= t.start + 1e-12 && time >= t.end - 1e-12)!;
      const f = (tb.start - time) / Math.max(tb.start - tb.end, 1e-12);
      return widthOf(sizeAt(tb.dyn, tb.startNu, tb.endNu, tb.dyn === "sudden" ? 1 : f), wMaxDau);
    }, cx, T, uid, units, onSelect);
  } else {
    svg
      .append("text")
      .attr("x", cxAnc)
      .attr("y", height - 12)
      .attr("text-anchor", "middle")
      .attr("font-size", 12)
      .attr("font-weight", 600)
      .attr("fill", T.pop1)
      .text("sample");
  }
  return svg.node()!;
}

function drawGeneFlow(
  g: GSel,
  m: Model,
  postB: { start: number; end: number }[],
  y: (t: number) => number,
  widthAt: (q: 0 | 1, time: number) => number,
  cx: (pop: 0 | 1 | "anc") => number,
  T: Theme,
  uid: string,
  units: UnitsState,
  onSelect?: (t: DiagramTarget) => void,
): void {
  const arrow = (time: number, from: 0 | 1, _to: 0 | 1, label: string, kind: "mig" | "both" | "pulse", dy: number, target: DiagramTarget, tipHtml: string): void => {
    const yy = y(time) + dy;
    const xa = cx(0) + widthAt(0, time) / 2 + 3;
    const xb = cx(1) - widthAt(1, time) / 2 - 3;
    if (xb - xa < 12) return;
    const [x1, x2] = from === 1 ? [xb, xa] : [xa, xb];
    const col = kind === "pulse" ? T.pulse : T.ink2;
    const gg = g.append("g").style("cursor", "pointer");
    gg.append("line")
      .attr("x1", x1)
      .attr("x2", x2)
      .attr("y1", yy)
      .attr("y2", yy)
      .attr("stroke", col)
      .attr("stroke-width", kind === "pulse" ? 2.6 : 1.4)
      .attr("marker-end", `url(#ah-${kind === "pulse" ? "pulse" : "mig"}-${uid})`)
      .attr("marker-start", kind === "both" ? `url(#ah-mig-${uid})` : null);
    // a wide transparent hit target
    gg.append("line").attr("x1", x1).attr("x2", x2).attr("y1", yy).attr("y2", yy).attr("stroke", "transparent").attr("stroke-width", 12);
    gg.append("text")
      .attr("x", (xa + xb) / 2)
      .attr("y", yy - 5)
      .attr("text-anchor", "middle")
      .attr("font-size", 10.5)
      .attr("fill", kind === "pulse" ? T.pulse : T.ink2)
      .attr("font-weight", kind === "pulse" ? 600 : 400)
      .text(label);
    gg.on("mousemove", (ev: MouseEvent) => showTip(tipHtml, ev))
      .on("mouseleave", hideTip)
      .on("click", () => onSelect?.(target));
  };
  if (m.migration) {
    m.post.forEach((e, k) => {
      const tMid = (postB[k].start + postB[k].end) / 2;
      const on12 = e.mig12On && e.m12 > 0;
      const on21 = e.mig21On && e.m21 > 0;
      const per = (M: number): string => (units.physical ? `; m = ${fmt(M / (2 * units.Nref))} per generation` : "");
      if (on12 && on21 && e.m12 === e.m21)
        arrow(tMid, 0, 1, `M = ${fmt(e.m12, 2)}`, "both", 0, { kind: "migration", index: k }, `<strong>Migration, epoch ${k + 1}</strong><br>M₁₂ = M₂₁ = ${fmt(e.m12)} (2N_ref·m)${per(e.m12)}`);
      else {
        if (on12) arrow(tMid, 1, 0, `M₁₂ ${fmt(e.m12, 2)}`, "mig", on21 ? -9 : 0, { kind: "migration", index: k }, `<strong>Migration into pop 1 from pop 2, epoch ${k + 1}</strong><br>M₁₂ = ${fmt(e.m12)} (2N_ref·m)${per(e.m12)}`);
        if (on21) arrow(tMid, 0, 1, `M₂₁ ${fmt(e.m21, 2)}`, "mig", on12 ? 9 : 0, { kind: "migration", index: k }, `<strong>Migration into pop 2 from pop 1, epoch ${k + 1}</strong><br>M₂₁ = ${fmt(e.m21)} (2N_ref·m)${per(e.m21)}`);
      }
    });
  }
  if (m.pulse.on) {
    const src = (m.pulse.source - 1) as 0 | 1;
    const dst = (1 - src) as 0 | 1;
    arrow(m.pulse.time, src, dst, `pulse f = ${fmt(m.pulse.f, 2)}`, "pulse", 0, { kind: "pulse", index: 0 }, `<strong>Admixture pulse</strong><br>a fraction f = ${fmt(m.pulse.f)} of pop ${dst + 1} is replaced by migrants from pop ${src + 1}<br>at ${timeLabel(m.pulse.time, units)}`);
  }
}

function timeTicks(Ttop: number, scale: "compressed" | "linear", y: (t: number) => number): number[] {
  if (scale === "linear") return scaleLinear().domain([0, Ttop]).ticks(5);
  const cand = [0];
  for (let e = -4; e <= 2; e++) for (const mant of [1, 2, 5]) cand.push(mant * 10 ** e);
  const inRange = cand.filter((t) => t <= Ttop * 1.0001);
  const out: number[] = [];
  let lastY = Infinity;
  for (const t of inRange) {
    const yy = y(t);
    if (Math.abs(lastY - yy) >= 16) {
      out.push(t);
      lastY = yy;
    }
  }
  return out;
}
