/**
 * Entry point: header (title, Beta badge, navigation), four views (Model, Statistics, Learn,
 * About) switched by the URL hash, and the footer (version, one-line disclaimer). The model
 * state comes from the URL (?v=1&s=...) when present and is written back to it, so it stays the
 * same when the visitor changes tabs. The header has a theme button and a Reset button.
 */

import "katex/dist/katex.min.css";
import "./ui/style.css";
import { Store, defaultState } from "./ui/state.ts";
import { stateFromSearch, encodeState, URL_VERSION } from "./ui/url.ts";
import { Engine } from "./engine/client.ts";
import { mountModelView } from "./ui/modelView.ts";
import { mountStatsView } from "./ui/statsView.ts";
import { mountLearnView } from "./ui/learnView.ts";
import { mountAboutView } from "./ui/aboutView.ts";
import { applyPreset, presetById } from "./ui/presets.ts";
import { BUILD } from "./generated/content.ts";
import { SITE } from "./site_config.ts";
import { h, debounce, watchExternalLinks } from "./ui/dom.ts";
import { initTheme, themeButton, resetButton } from "./ui/theme.ts";

const TABS = [
  { id: "model", label: "Model" },
  { id: "stats", label: "Statistics" },
  { id: "learn", label: "Learn" },
  { id: "about", label: "About" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/**
 * Reset: start again with the default model on the Model tab. The page is loaded again without
 * the model in its address, so every change (model, display, pinned spectrum, loaded data,
 * sweep) is cleared. The theme choice is kept. When the address held a model, the browser's
 * Back button returns to it.
 */
let resetting = false;
function resetAll(): void {
  resetting = true;
  const u = new URL(location.href);
  const hadState = u.search !== "";
  u.search = "";
  u.hash = "#model";
  if (hadState) location.assign(u.toString());
  else {
    history.replaceState(null, "", u.toString());
    location.reload();
  }
}

function boot(): void {
  initTheme();
  const app = document.getElementById("app")!;
  const { state: fromUrl, error } = stateFromSearch(location.search);
  const store = new Store(fromUrl ?? defaultState());
  if (!fromUrl) {
    // ?preset=<id> opens a preset (handy for teaching links); otherwise the standard neutral model
    const asked = new URLSearchParams(location.search).get("preset");
    const p = presetById(asked ?? "snm") ?? presetById("snm");
    if (p) store.update((s) => applyPreset(s, p), { source: "preset", structural: true });
  }
  const engine = new Engine();

  // ---- header
  const nav = h("nav", { class: "tabs", "aria-label": "Main" });
  const links = new Map<TabId, HTMLAnchorElement>();
  for (const t of TABS) {
    const a = h("a", { href: `#${t.id}`, class: "tab", "data-tab": t.id }, t.label) as HTMLAnchorElement;
    links.set(t.id, a);
    nav.append(a);
  }
  const header = h(
    "header",
    { class: "site-header" },
    h(
      "div",
      { class: "brand" },
      h("h1", {}, h("span", { class: "brand-name" }, SITE.name), h("span", { class: "visually-hidden" }, ": "), h("span", { class: "brand-sub" }, SITE.title)),
      h("span", { class: "badge", title: "Beta version: a work in progress. See the disclaimer on the About page." }, "Beta"),
    ),
    h("div", { class: "header-right" }, nav, h("div", { class: "header-actions" }, resetButton(resetAll), themeButton())),
  );

  // ---- views
  const views: Record<TabId, HTMLElement> = {
    model: h("main", { id: "view-model", class: "view", "aria-label": "Model" }),
    stats: h("main", { id: "view-stats", class: "view", "aria-label": "Statistics" }),
    learn: h("main", { id: "view-learn", class: "view", "aria-label": "Learn" }),
    about: h("main", { id: "view-about", class: "view", "aria-label": "About" }),
  };
  const footer = h(
    "footer",
    { class: "site-footer" },
    h("span", {}, `v${BUILD.version}`),
    h("span", { class: "sep", "aria-hidden": "true" }, "·"),
    h("span", {}, "Beta: provided \"as is\", without warranty; check important results with established tools. "),
    h("a", { href: "#about-disclaimer" }, "Full disclaimer"),
    h("span", { class: "sep", "aria-hidden": "true" }, "·"),
    h("a", { href: "#about" }, "About, citation and contact"),
  );
  const skip = h("a", { class: "skip", href: "#view-model" }, "Skip to content");
  app.append(skip, header, ...Object.values(views), footer);
  watchExternalLinks(app);
  if (error) app.insertBefore(h("p", { class: "notice", role: "alert" }, error), views.model);

  // ---- mount (lazy for the heavier tabs)
  const model = mountModelView(views.model, store, engine);
  const mounted = new Set<TabId>(["model"]);
  const mount = (id: TabId): void => {
    if (mounted.has(id)) return;
    mounted.add(id);
    if (id === "stats") mountStatsView(views.stats, store, engine, model);
    if (id === "learn") mountLearnView(views.learn, store, engine, () => (location.hash = "#model"));
    if (id === "about") mountAboutView(views.about);
  };

  // ---- routing: #model, #stats, #learn, #about, and #<tab>-<anchor>
  const route = (): void => {
    const raw = location.hash.replace(/^#/, "");
    const key = raw.startsWith("view-") ? raw.slice(5) : raw;
    const tab = (TABS.find((t) => key === t.id || key.startsWith(`${t.id}-`))?.id ?? "model") as TabId;
    mount(tab);
    for (const t of TABS) {
      views[t.id].hidden = t.id !== tab;
      const a = links.get(t.id)!;
      if (t.id === tab) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    skip.setAttribute("href", `#view-${tab}`);
    if (raw !== tab) document.getElementById(raw)?.scrollIntoView();
    else window.scrollTo({ top: 0 });
  };
  window.addEventListener("hashchange", route);
  route();

  // ---- keep the URL in step with the model (no new history entries)
  const writeUrl = debounce(() => {
    if (resetting) return;
    const u = new URL(location.href);
    u.search = `?v=${URL_VERSION}&s=${encodeState(store.get())}`;
    history.replaceState(null, "", u.toString());
  }, 400);
  store.subscribe((_s, info) => {
    if (!info.draft) writeUrl();
  });
}

boot();
