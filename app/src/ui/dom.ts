/** Small DOM and formatting helpers (no framework). */

type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;
type Child = Node | string | number | null | undefined | false;

/** Create an element: h("div", {class: "x", onclick: fn}, child1, child2). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "html") el.innerHTML = String(v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Replace all children of an element. */
export function setChildren(el: Element, ...children: (Child | Child[])[]): void {
  el.replaceChildren(...children.flat().filter((c): c is Node | string | number => c !== null && c !== undefined && c !== false).map((c) => (c instanceof Node ? c : String(c))));
}

/** Number formatting for tables and labels: 3 significant digits, scientific notation for very small or large values. */
export function fmt(x: number, digits = 3): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "–";
  if (!Number.isFinite(x)) return x > 0 ? "∞" : "−∞";
  if (x === 0 || Number(x.toPrecision(digits)) === 0) return "0";
  const a = Math.abs(x);
  let s: string;
  if (a >= 1e5 || a < 1e-3) s = x.toExponential(digits - 1).replace("e+", "e");
  else s = Number(x.toPrecision(digits)).toString();
  return s.replace("-", "−");
}

/** Fixed number of decimals with a true minus sign. */
export function fixed(x: number, d = 2): string {
  if (!Number.isFinite(x)) return "–";
  const s = x.toFixed(d);
  return Number(s) === 0 ? (0).toFixed(d) : s.replace("-", "−");
}

export function pct(x: number, d = 1): string {
  if (!Number.isFinite(x)) return "–";
  return `${(100 * x).toFixed(d)} %`;
}

/** Integer with thin-space thousands separators (British style uses commas; we use commas). */
export function intFmt(x: number): string {
  return Math.round(x).toLocaleString("en-GB");
}

export function download(filename: string, content: string | Blob, mime = "text/plain"): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

let uid = 0;
export const nextId = (prefix = "id"): string => `${prefix}-${++uid}`;

/** Debounce a function (trailing call). */
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (...a: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...a);
    }, ms);
  };
}

/** A small, accessible info tooltip ("i" button with a title and aria-label). */
export function infoTip(text: string): HTMLElement {
  return h("span", { class: "info", tabindex: 0, role: "note", "aria-label": text, title: text }, "i");
}

/**
 * Links to other sites (references, DOIs, GitHub files and Issues, related tools) open in a new
 * tab, so that the app stays open. Links inside the app (#model, #stats, …), mailto: and
 * downloads (blob:) are left as they are. A screen reader hears "opens in a new tab" through
 * aria-describedby (one hidden note in the page).
 */
export const NEW_TAB_NOTE_ID = "new-tab-note";

export function markExternalLink(a: HTMLAnchorElement): void {
  const href = a.getAttribute("href") ?? "";
  if (!/^https?:\/\//i.test(href)) return;
  try {
    if (new URL(href).origin === location.origin) return;
  } catch {
    return;
  }
  a.target = "_blank";
  const rel = new Set((a.getAttribute("rel") ?? "").split(/\s+/).filter(Boolean));
  rel.add("noopener");
  rel.add("noreferrer");
  a.setAttribute("rel", [...rel].join(" "));
  if (!a.hasAttribute("aria-describedby")) a.setAttribute("aria-describedby", NEW_TAB_NOTE_ID);
}

/** Mark the links already in `root`, and every link added to it later. */
export function watchExternalLinks(root: HTMLElement): void {
  if (!document.getElementById(NEW_TAB_NOTE_ID)) document.body.append(h("span", { id: NEW_TAB_NOTE_ID, hidden: true }, "opens in a new tab"));
  const scan = (n: Node): void => {
    if (!(n instanceof Element)) return;
    if (n instanceof HTMLAnchorElement) markExternalLink(n);
    n.querySelectorAll<HTMLAnchorElement>("a[href]").forEach(markExternalLink);
  };
  scan(root);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes" && r.target instanceof HTMLAnchorElement) markExternalLink(r.target);
      r.addedNodes.forEach(scan);
    }
  }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
}
