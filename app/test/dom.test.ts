// @vitest-environment happy-dom
// @vitest-environment-options {"url": "http://localhost/?preset=im_sym#model"}
/**
 * Smoke test of the whole page in a simulated browser (happy-dom; no Web Worker, so the engine
 * runs on the main thread): the app boots, draws the diagram and the spectrum, reacts to a
 * preset, and the other tabs render.
 */

import { describe, it, expect, beforeAll } from "vitest";

const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await tick();
  }
}

describe("page", () => {
  beforeAll(async () => {
    document.body.innerHTML = '<div id="app"></div>';
    await import("../src/main.ts");
  });

  it("boots with a preset from the URL and draws diagram, joint SFS, 1D panel and statistics", async () => {
    await until(() => Boolean(document.querySelector("#sfs-main svg")));
    expect(document.querySelector("#diagram svg")).not.toBeNull();
    expect(document.querySelector("#sfs-1d svg")).not.toBeNull();
    expect(document.querySelector(".compact-stats table")).not.toBeNull();
    expect(document.querySelector(".what-text")!.textContent).toMatch(/Migration keeps alleles shared/);
    expect((document.querySelector('[data-key="preset"]') as HTMLSelectElement).value).toBe("im_sym");
    expect(document.querySelector(".badge")!.textContent).toBe("Beta");
    expect(document.querySelector(".brand h1")!.textContent).toBe("iDemoSFS: Demographic history and the expected SFS");
    expect(document.querySelector(".site-footer")!.textContent).toMatch(/v0\.2\.1-beta/);
  });

  it("switching to one population redraws a 1D spectrum", async () => {
    const radio = document.querySelector('[data-key="mode:1"]') as HTMLInputElement;
    radio.checked = true;
    radio.dispatchEvent(new Event("change"));
    await until(() => !document.querySelector("#sfs-1d svg") && Boolean(document.querySelector("#sfs-main svg")));
    expect(document.querySelector("#sfs-main svg")!.getAttribute("aria-label")).toMatch(/Expected SFS/);
  });

  it("the URL holds the model", async () => {
    await tick(500);
    expect(location.search).toMatch(/^\?v=1&s=/);
  });

  it("Statistics, Learn and About tabs render", async () => {
    location.hash = "#stats";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await until(() => Boolean(document.querySelector("#view-stats .stats-table")));
    location.hash = "#learn";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await until(() => Boolean(document.querySelector("#learn-limits")));
    expect(document.querySelector("#view-learn [data-figure=limits] svg")).not.toBeNull();
    location.hash = "#about";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await until(() => Boolean(document.querySelector("#about-disclaimer")));
    const about = document.querySelector("#view-about")!;
    expect(about.textContent).not.toMatch(/EMAIL_PLACEHOLDER/);
    const mail = [...about.querySelectorAll("a")].find((a) => a.textContent === "aminghane [at] univie.ac.at")!;
    expect(mail).toBeDefined();
    expect(mail.getAttribute("href")).toBe("#");
    mail.dispatchEvent(new Event("focus"));
    expect(mail.getAttribute("href")).toBe("mailto:aminghane@univie.ac.at");
    const hrefs = [...about.querySelectorAll("a")].map((x) => x.getAttribute("href") ?? "");
    expect(hrefs).toContain("https://github.com/amnghn/iDemoSFS/issues");
    expect(hrefs).toContain("https://github.com/amnghn/iDemoSFS/blob/main/docs/PROMPT.md");
    expect(hrefs).toContain("https://github.com/amnghn/iDemoSFS/blob/main/CHANGELOG.md");
    expect(about.textContent).not.toMatch(/REPO_OWNER|placeholder/i);
    expect(document.querySelector("#about-ai")!.textContent).toMatch(/Claude Code/);
  });

  it("links to other sites open in a new tab; links inside the app do not", async () => {
    await tick(50);
    const all = [...document.querySelectorAll<HTMLAnchorElement>("#app a[href]")];
    const ext = all.filter((a) => /^https?:/.test(a.getAttribute("href")!));
    expect(ext.length).toBeGreaterThan(20);
    for (const a of ext) {
      expect(a.target, a.href).toBe("_blank");
      expect(a.rel).toMatch(/noopener/);
      expect(a.getAttribute("aria-describedby")).toBe("new-tab-note");
    }
    for (const a of all.filter((x) => /^#|^mailto:/.test(x.getAttribute("href")!))) expect(a.target).toBe("");
    expect(document.getElementById("new-tab-note")!.textContent).toBe("opens in a new tab");
    expect(document.querySelector("#about-author h2")!.textContent).toBe("Developer");
    expect(document.querySelector("#about-cite blockquote")!.textContent).toMatch(/^Ghane A \(\d{4}\) iDemoSFS: an interactive tool for demographic history and the expected SFS\. Version \d+\.\d+\.\d+-beta\. https:\/\/github\.com\/amnghn\/iDemoSFS$/);
  });

  it("the theme button switches between light and dark and remembers the choice", () => {
    const btn = document.querySelector("#theme-toggle") as HTMLButtonElement;
    const root = document.documentElement;
    const first = root.dataset.theme;
    btn.click();
    const t1 = root.dataset.theme;
    expect(t1 === "dark" || t1 === "light").toBe(true);
    expect(t1).not.toBe(first ?? "light");
    expect(localStorage.getItem("idemosfs-theme")).toBe(t1);
    expect(btn.getAttribute("aria-label")).toBe(`Switch to the ${t1 === "dark" ? "light" : "dark"} theme`);
    btn.click();
    expect(root.dataset.theme).toBe(t1 === "dark" ? "light" : "dark");
    expect(localStorage.getItem("idemosfs-theme")).toBe(root.dataset.theme);
  });

  it("the header has a Reset button", () => {
    const b = document.querySelector("#reset-all") as HTMLButtonElement;
    expect(b.textContent).toMatch(/Reset/);
    expect(b.getAttribute("aria-label")).toMatch(/default model/);
  });

  it("changing tabs keeps the model; the upload link opens the calculator", async () => {
    location.hash = "#model";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await tick(500);
    const search = location.search;
    const mode1 = (document.querySelector('[data-key="mode:1"]') as HTMLInputElement).checked;
    for (const t of ["stats", "learn", "about", "model"]) {
      location.hash = `#${t}`;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      await tick(50);
    }
    await tick(500);
    expect(location.search).toBe(search);
    expect((document.querySelector('[data-key="mode:1"]') as HTMLInputElement).checked).toBe(mode1);
    const link = document.querySelector('#view-model a[href="#stats-upload"]') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    location.hash = "#stats-upload";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await until(() => Boolean(document.querySelector("#stats-upload .file-btn")));
    expect(document.querySelector("#view-stats")!.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector("#stats-upload .file-btn")!.textContent).toMatch(/Upload a spectrum file/);
    expect(document.querySelector("#stats-upload-btn")!.textContent).toBe("Upload your own SFS");
  });
});
