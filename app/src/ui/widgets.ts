/** Form widgets: paired range + number inputs (log or linear), switches, segmented radios. */

import { h, nextId, infoTip, fmt } from "./dom.ts";

export interface SliderOpts {
  key: string; // stable key (focus is restored after a rebuild)
  label: string;
  sub?: string; // small text after the label (units)
  min: number;
  max: number;
  value: number;
  log?: boolean;
  integer?: boolean;
  step?: number; // for linear sliders
  info?: string;
  disabled?: boolean;
  onInput: (v: number, final: boolean) => void;
}

const RES = 1000;

export function slider(o: SliderOpts): HTMLElement {
  const id = nextId("sl");
  const toPos = (v: number): number => {
    if (o.integer) return v;
    if (o.log) return Math.round(((Math.log(v) - Math.log(o.min)) / (Math.log(o.max) - Math.log(o.min))) * RES);
    return Math.round(((v - o.min) / (o.max - o.min)) * RES);
  };
  const fromPos = (p: number): number => {
    if (o.integer) return p;
    if (o.log) return Math.exp(Math.log(o.min) + (p / RES) * (Math.log(o.max) - Math.log(o.min)));
    const v = o.min + (p / RES) * (o.max - o.min);
    return o.step ? Math.round(v / o.step) * o.step : v;
  };
  const nice = (v: number): number => (o.integer ? Math.round(v) : Number(v.toPrecision(o.log ? 3 : 4)));
  const range = h("input", {
    type: "range",
    id,
    min: o.integer ? o.min : 0,
    max: o.integer ? o.max : RES,
    step: o.integer ? (o.step ?? 1) : 1,
    value: toPos(o.value),
    "data-key": `${o.key}:range`,
    "aria-valuetext": fmt(o.value),
    disabled: o.disabled,
  }) as HTMLInputElement;
  const num = h("input", {
    type: "number",
    class: "num",
    min: o.min,
    max: o.max,
    step: o.integer ? (o.step ?? 1) : "any",
    value: nice(o.value),
    "aria-label": `${o.label} (number)`,
    "data-key": `${o.key}:num`,
    disabled: o.disabled,
  }) as HTMLInputElement;
  range.addEventListener("input", () => {
    const v = nice(fromPos(Number(range.value)));
    num.value = String(v);
    range.setAttribute("aria-valuetext", fmt(v));
    o.onInput(v, false);
  });
  range.addEventListener("change", () => o.onInput(nice(fromPos(Number(range.value))), true));
  num.addEventListener("change", () => {
    let v = Number(num.value);
    if (!Number.isFinite(v)) v = o.value;
    v = Math.min(o.max, Math.max(o.min, v));
    if (o.integer) v = Math.round(v);
    num.value = String(v);
    range.value = String(toPos(v));
    o.onInput(v, true);
  });
  return h(
    "div",
    { class: `slider${o.disabled ? " disabled" : ""}` },
    h("label", { for: id }, o.label, o.sub ? h("span", { class: "sub" }, ` ${o.sub}`) : null, o.info ? infoTip(o.info) : null),
    h("div", { class: "slider-row" }, range, num),
  );
}

export function toggle(key: string, label: string, checked: boolean, onChange: (v: boolean) => void, opts: { disabled?: boolean; info?: string } = {}): HTMLElement {
  const id = nextId("tg");
  const input = h("input", { type: "checkbox", role: "switch", id, "data-key": key, checked, disabled: opts.disabled, "aria-checked": checked ? "true" : "false" }) as HTMLInputElement;
  input.addEventListener("change", () => onChange(input.checked));
  return h(
    "div",
    { class: `toggle${opts.disabled ? " disabled" : ""}` },
    h("label", { for: id }, label, opts.info ? infoTip(opts.info) : null),
    h("span", { class: "switch" }, input, h("span", { class: "knob", "aria-hidden": "true" })),
  );
}

export function segmented<T extends string>(key: string, label: string, options: { value: T; label: string }[], value: T, onChange: (v: T) => void, info?: string): HTMLElement {
  const name = nextId("seg");
  return h(
    "fieldset",
    { class: "segmented" },
    h("legend", {}, label, info ? infoTip(info) : null),
    h(
      "div",
      { class: "seg-row" },
      ...options.map((o) => {
        const id = nextId("sg");
        const inp = h("input", { type: "radio", name, id, value: o.value, checked: o.value === value, "data-key": `${key}:${o.value}` }) as HTMLInputElement;
        inp.addEventListener("change", () => inp.checked && onChange(o.value));
        return h("span", { class: "seg" }, inp, h("label", { for: id }, o.label));
      }),
    ),
  );
}

export function select<T extends string>(key: string, label: string, options: { value: T; label: string; group?: string }[], value: T, onChange: (v: T) => void): HTMLElement {
  const id = nextId("se");
  const sel = h("select", { id, "data-key": key }) as HTMLSelectElement;
  let lastGroup: string | undefined;
  let og: HTMLOptGroupElement | null = null;
  for (const o of options) {
    if (o.group !== lastGroup) {
      og = o.group ? h("optgroup", { label: o.group }) : null;
      if (og) sel.append(og);
      lastGroup = o.group;
    }
    const opt = h("option", { value: o.value, selected: o.value === value }, o.label);
    (og ?? sel).append(opt);
  }
  sel.value = value;
  sel.addEventListener("change", () => onChange(sel.value as T));
  return h("div", { class: "select" }, h("label", { for: id }, label), sel);
}

export function stepper(key: string, label: string, value: number, min: number, max: number, onChange: (v: number) => void): HTMLElement {
  const out = h("output", { "aria-live": "polite" }, String(value));
  const dec = h("button", { type: "button", class: "step", "aria-label": `Fewer: ${label}`, "data-key": `${key}:dec`, disabled: value <= min }, "−");
  const inc = h("button", { type: "button", class: "step", "aria-label": `More: ${label}`, "data-key": `${key}:inc`, disabled: value >= max }, "+");
  dec.addEventListener("click", () => value > min && onChange(value - 1));
  inc.addEventListener("click", () => value < max && onChange(value + 1));
  return h("div", { class: "stepper" }, h("span", { class: "lbl" }, label), h("span", { class: "step-row" }, dec, out, inc));
}

export function numberField(key: string, label: string, value: number, onChange: (v: number) => void, opts: { min?: number; max?: number; step?: string; info?: string } = {}): HTMLElement {
  const id = nextId("nf");
  const inp = h("input", { type: "number", id, value: String(value), min: opts.min, max: opts.max, step: opts.step ?? "any", "data-key": key, class: "num wide" }) as HTMLInputElement;
  inp.addEventListener("change", () => {
    const v = Number(inp.value);
    if (Number.isFinite(v) && (opts.min === undefined || v >= opts.min) && (opts.max === undefined || v <= opts.max)) onChange(v);
    else inp.value = String(value);
  });
  return h("div", { class: "field" }, h("label", { for: id }, label, opts.info ? infoTip(opts.info) : null), inp);
}

const UPLOAD_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>';

/**
 * A file input shown as a clear button with the name of the chosen file. The native input stays
 * in the page (visually hidden), so it keeps its keyboard focus and accessible name.
 */
export function fileButton(input: HTMLInputElement, text: string, primary = false): HTMLElement {
  input.classList.add("visually-hidden");
  const name = h("span", { class: "file-name" }, "No file chosen");
  input.addEventListener("change", () => {
    const f = input.files?.[0];
    if (f) name.textContent = f.name;
  });
  return h("label", { class: "file-btn" }, h("span", { class: primary ? "btn primary" : "btn" }, h("span", { class: "icon", html: UPLOAD_ICON }), text), input, name);
}

