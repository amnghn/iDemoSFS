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
    expect(document.querySelector(".site-footer")!.textContent).toMatch(/v0\.1\.0-beta/);
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
    expect(document.querySelector("#view-about")!.textContent).toMatch(/\[EMAIL_PLACEHOLDER\]/);
    expect(document.querySelector("#about-ai")!.textContent).toMatch(/Claude Code/);
  });
});
