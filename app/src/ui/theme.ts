/**
 * Light and dark theme. Without a choice, the page follows the system setting (CSS media query).
 * The theme button stores the visitor's choice in this browser only (localStorage, wrapped in
 * try/catch: storage can be blocked) and sets data-theme on <html>; index.html applies a stored
 * choice before the first paint. Plots read their colours from CSS variables, so every view
 * redraws on the "themechange" event.
 */

import { h } from "./dom.ts";

export type ThemeName = "light" | "dark";
const KEY = "idemosfs-theme";
const EVENT = "themechange";

export function storedTheme(): ThemeName | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function systemDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/** The theme in use: the visitor's choice, else the system setting. */
export function currentTheme(): ThemeName {
  const t = document.documentElement.dataset.theme;
  if (t === "light" || t === "dark") return t;
  return systemDark() ? "dark" : "light";
}

export function setTheme(t: ThemeName): void {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // storage blocked: the choice holds for this page view only
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Redraw hook for the views. */
export function onThemeChange(fn: () => void): void {
  window.addEventListener(EVENT, fn);
}

/** Apply a stored choice, and redraw when the system setting changes while no choice is stored. */
export function initTheme(): void {
  const s = storedTheme();
  if (s) document.documentElement.dataset.theme = s;
  try {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (!document.documentElement.dataset.theme) window.dispatchEvent(new CustomEvent(EVENT));
    });
  } catch {
    // no matchMedia: nothing to follow
  }
}

const SUN =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';

/** Header button: shows the theme it switches to (moon → dark, sun → light). */
export function themeButton(): HTMLButtonElement {
  const icon = h("span", { class: "icon" });
  const text = h("span", { class: "btn-text" });
  const btn = h("button", { type: "button", class: "btn header-btn", id: "theme-toggle" }, icon, text) as HTMLButtonElement;
  const show = (): void => {
    const next: ThemeName = currentTheme() === "dark" ? "light" : "dark";
    icon.innerHTML = next === "dark" ? MOON : SUN;
    text.textContent = next === "dark" ? "Dark" : "Light";
    const label = `Switch to the ${next} theme`;
    btn.setAttribute("aria-label", label);
    btn.title = label;
  };
  btn.addEventListener("click", () => setTheme(currentTheme() === "dark" ? "light" : "dark"));
  onThemeChange(show);
  show();
  return btn;
}

const RESET =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 3.5V8.5h5"/></svg>';

/** Header button that starts again with the default model (the handler is given by main.ts). */
export function resetButton(onReset: () => void): HTMLButtonElement {
  const label = "Reset: clear all changes and start again with the default model";
  return h(
    "button",
    { type: "button", class: "btn header-btn", id: "reset-all", title: label, "aria-label": label, onclick: onReset },
    h("span", { class: "icon", html: RESET }),
    h("span", { class: "btn-text" }, "Reset"),
  ) as HTMLButtonElement;
}
