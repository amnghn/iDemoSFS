#!/usr/bin/env node
/**
 * Headless browser check of the built app (Firefox, WebDriver BiDi; Node >= 22 has WebSocket).
 *
 * Opens each tab of a running preview server, waits until the plots are drawn, records console
 * errors, takes screenshots, and (with --bench) runs bench.html, which times the engine in the
 * browser. No extra packages; Firefox runs with a fresh temporary profile.
 *
 * Usage:
 *   node scripts/browser_check.mjs --url http://127.0.0.1:4173/ --out <dir> --profile <tmpdir>
 *        [--width 1440] [--height 1000] [--bench] [--only model,stats,learn,about] [--dark]
 *        [--url-query "?v=1&s=..."] [--calc <spectrum file to paste into the calculator>] [--sweep]
 *        [--extras --files <dir>]   (theme button, tabs keep the model, new-tab links, uploads, Reset)
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"]);
    return acc;
  }, []),
);
const BASE = args.url ?? "http://127.0.0.1:4173/";
const OUT = args.out ?? "browser_check_out";
const PROFILE = args.profile ?? join(OUT, "ff-profile");
const W = Number(args.width ?? 1440);
const H = Number(args.height ?? 1000);
const PORT = 9300 + Math.floor(Math.random() * 500);
mkdirSync(OUT, { recursive: true });
mkdirSync(PROFILE, { recursive: true });
writeFileSync(
  join(PROFILE, "user.js"),
  [
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    'user_pref("toolkit.telemetry.enabled", false);',
    'user_pref("app.update.enabled", false);',
    `user_pref("ui.systemUsesDarkTheme", ${args.dark ? 1 : 0});`,
    `user_pref("layout.css.prefers-color-scheme.content-override", ${args.dark ? 0 : 1});`,
  ].join("\n"),
);

const ff = spawn("firefox", ["--headless", "--no-remote", "--profile", PROFILE, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
let ffLog = "";
ff.stderr.on("data", (d) => (ffLog += d));
ff.stdout.on("data", (d) => (ffLog += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function connect() {
  for (let k = 0; k < 120; k++) {
    if (/WebDriver BiDi listening/.test(ffLog)) break;
    await sleep(250);
  }
  return await new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/session`);
    ws.onopen = () => res(ws);
    ws.onerror = (e) => rej(new Error(`websocket: ${e.message ?? e}`));
  });
}

let ws;
let nextId = 1;
const waiting = new Map();
const logs = [];
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => waiting.set(id, { res, rej, method }));
}

async function evaluate(ctx, expression) {
  const r = await send("script.evaluate", { expression, target: { context: ctx }, awaitPromise: true, resultOwnership: "none" });
  if (r.type === "exception") throw new Error(`page exception: ${JSON.stringify(r.exceptionDetails?.text ?? r)}`);
  return r.result?.value;
}

const waitFor = (cond, ms = 20000) => `new Promise((res) => { const t0 = performance.now(); const tick = () => { let ok = false; try { ok = Boolean(${cond}); } catch (e) {} if (ok) res(Math.round(performance.now() - t0)); else if (performance.now() - t0 > ${ms}) res(-1); else setTimeout(tick, 50); }; tick(); })`;

async function shot(ctx, name) {
  const r = await send("browsingContext.captureScreenshot", { context: ctx, origin: "document" });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
}

const report = { url: BASE, viewport: [W, H], dark: Boolean(args.dark), steps: [], logs };
try {
  ws = await connect();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      const w = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.type === "error" || msg.error) w.rej(new Error(`${w.method}: ${msg.error} ${msg.message ?? ""}`));
      else w.res(msg.result);
    } else if (msg.method === "log.entryAdded") {
      const e = msg.params;
      logs.push({ level: e.level, text: e.text, source: e.source?.realm ?? "" });
    }
  };
  await send("session.new", { capabilities: {} });
  await send("session.subscribe", { events: ["log.entryAdded"] });
  const tree = await send("browsingContext.getTree", {});
  const ctx = tree.contexts[0].context;
  await send("browsingContext.setViewport", { context: ctx, viewport: { width: W, height: H } });
  const query = args["url-query"] ?? "";
  const tabs = (args.only ?? "model,stats,learn,about").split(",");
  if ((!args.bench && !args.extras) || args.only) {
    await send("browsingContext.navigate", { context: ctx, url: `${BASE}${query}#model`, wait: "complete" });
    for (const tab of tabs) {
      await evaluate(ctx, `location.hash = "#${tab}"; true`);
      const cond =
        tab === "model"
          ? `document.querySelector("#sfs-main svg") && document.querySelector("#diagram svg") && document.querySelector(".spinner").hidden`
          : tab === "stats"
            ? `document.querySelector("#view-stats .stats-table")`
            : tab === "learn"
              ? `document.querySelector("#view-learn [data-figure=limits] svg")`
              : `document.querySelector("#about-disclaimer")`;
      const ms = await evaluate(ctx, waitFor(cond));
      await sleep(300);
      const info = await evaluate(
        ctx,
        `JSON.stringify({ hash: location.hash, svgs: document.querySelectorAll("main:not([hidden]) svg").length, status: document.querySelector(".status")?.textContent ?? "", error: [...document.querySelectorAll(".error:not([hidden])")].map(e => e.textContent), scrollW: document.documentElement.scrollWidth, innerW: innerWidth })`,
      );
      report.steps.push({ tab, readyMs: ms, ...JSON.parse(info) });
      await shot(ctx, `${tab}${args.dark ? "_dark" : ""}_${W}`);
    }
  }
  if (args.calc) {
    // calculator: paste a spectrum file, read it, wait for the model-data panel
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(args.calc, "utf-8");
    await evaluate(ctx, `location.hash = "#stats"; true`);
    await evaluate(ctx, waitFor(`document.querySelector("#view-stats .stats-table")`));
    await evaluate(ctx, `(() => { const r = document.querySelector('#view-stats input[type=radio][value=data]'); r.checked = true; r.dispatchEvent(new Event("change")); return true; })()`);
    await sleep(200);
    await evaluate(ctx, `(() => { const t = document.querySelector('#view-stats textarea'); t.value = ${JSON.stringify(text)}; const b = [...document.querySelectorAll('#view-stats button')].find((x) => x.textContent.includes("Read the pasted")); b.click(); return true; })()`);
    const ms = await evaluate(ctx, waitFor(`[...document.querySelectorAll("#view-stats h3")].some((e) => e.textContent.includes("Observed and expected"))`));
    await sleep(400);
    const info = await evaluate(ctx, `JSON.stringify({ msg: document.querySelector("#view-stats .hint[aria-live]")?.textContent ?? "", errors: [...document.querySelectorAll("#view-stats .error")].map((e) => e.textContent) })`);
    report.steps.push({ tab: "calculator", readyMs: ms, ...JSON.parse(info) });
    await shot(ctx, `calculator_${W}`);
  }
  if (args.sweep) {
    await evaluate(ctx, `location.hash = "#stats"; true`);
    await evaluate(ctx, waitFor(`document.querySelector("#view-stats .stats-table")`));
    await evaluate(ctx, `(() => { const b = [...document.querySelectorAll('#view-stats button')].find((x) => x.textContent === "Run the sweep"); b.click(); return true; })()`);
    const ms = await evaluate(ctx, waitFor(`/Done:/.test(document.querySelector("#sweep-plots")?.previousElementSibling?.textContent ?? "")`, 120000));
    const status = await evaluate(ctx, `document.querySelector("#sweep-plots").previousElementSibling.textContent`);
    report.steps.push({ tab: "sweep", readyMs: ms, status });
    await evaluate(ctx, `document.querySelector("#sweep-plots").scrollIntoView(); true`);
    await shot(ctx, `sweep_${W}`);
  }
  if (args.extras) {
    // theme button, tabs keep the model, links to other sites, upload (real files through
    // input.setFiles, as if chosen in the file picker), and Reset. --files <dir> holds
    // dadi_2d_unfolded.fs, calc_fixture_400sites.vcf.gz and calc_fixture_popmap.txt.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const FILES = resolve(args.files ?? ".");
    const ex = {};
    const modelReady = `document.querySelector("#sfs-main svg") && document.querySelector(".spinner").hidden`;
    const nodeId = async (expr) => {
      const r = await send("script.evaluate", { expression: expr, target: { context: ctx }, awaitPromise: false, resultOwnership: "root" });
      if (!r.result?.sharedId) throw new Error(`no element for ${expr}`);
      return r.result.sharedId;
    };
    const setFile = async (expr, file) => send("input.setFiles", { context: ctx, element: { sharedId: await nodeId(expr) }, files: [join(FILES, file)] });
    const themeInfo = `JSON.stringify({ attr: document.documentElement.dataset.theme ?? null, bg: getComputedStyle(document.body).backgroundColor, label: document.querySelector("#theme-toggle").getAttribute("aria-label"), axis: getComputedStyle(document.querySelector("#sfs-main svg text") ?? document.body).fill })`;

    await send("browsingContext.navigate", { context: ctx, url: `${BASE}?preset=im_sym#model`, wait: "complete" });
    await evaluate(ctx, waitFor(modelReady));
    // 1. theme button, and the choice is kept after a reload
    ex.themeBefore = JSON.parse(await evaluate(ctx, themeInfo));
    await evaluate(ctx, `document.querySelector("#theme-toggle").click(); true`);
    await sleep(500);
    ex.themeAfter = JSON.parse(await evaluate(ctx, themeInfo));
    await shot(ctx, `extras_model_theme_${ex.themeAfter.attr}_${W}`);
    await send("browsingContext.reload", { context: ctx, wait: "complete" });
    await evaluate(ctx, waitFor(modelReady));
    ex.themeAfterReload = JSON.parse(await evaluate(ctx, themeInfo));
    for (const tab of ["stats", "learn"]) {
      await evaluate(ctx, `location.hash = "#${tab}"; true`);
      await sleep(800);
      await shot(ctx, `extras_${tab}_theme_${ex.themeAfter.attr}_${W}`);
    }
    await evaluate(ctx, `location.hash = "#model"; true`);
    await sleep(300);
    await evaluate(ctx, `document.querySelector("#theme-toggle").click(); true`);
    await sleep(300);
    ex.themeBack = JSON.parse(await evaluate(ctx, themeInfo));
    // 2. the model stays the same when the tabs change
    const modelInfo = `JSON.stringify({ search: location.search, preset: document.querySelector('[data-key="preset"]').value, what: document.querySelector(".what-text").textContent.slice(0, 60) })`;
    const m0 = JSON.parse(await evaluate(ctx, modelInfo));
    for (const tab of ["stats", "learn", "about", "model"]) {
      await evaluate(ctx, `location.hash = "#${tab}"; true`);
      await sleep(400);
    }
    await evaluate(ctx, waitFor(modelReady));
    const m1 = JSON.parse(await evaluate(ctx, modelInfo));
    ex.tabsKeepModel = { before: m0, after: m1, same: JSON.stringify(m0) === JSON.stringify(m1) };
    // 3. links to other sites open in a new tab (About and Learn)
    const linkInfo = (sel) => `JSON.stringify((() => { const a = [...document.querySelectorAll("${sel} a[href]")]; const ext = a.filter((x) => /^https?:/.test(x.getAttribute("href"))); return { links: a.length, external: ext.length, newTab: ext.filter((x) => x.target === "_blank" && /noopener/.test(x.rel)).length, internalNewTab: a.filter((x) => !/^https?:/.test(x.getAttribute("href")) && x.target === "_blank").length }; })())`;
    await evaluate(ctx, `location.hash = "#about"; true`);
    await evaluate(ctx, waitFor(`document.querySelector("#about-disclaimer")`));
    ex.linksAbout = JSON.parse(await evaluate(ctx, linkInfo("#view-about")));
    ex.developerHeading = await evaluate(ctx, `document.querySelector("#about-author h2")?.textContent ?? ""`);
    await evaluate(ctx, `location.hash = "#learn"; true`);
    await evaluate(ctx, waitFor(`document.querySelector("#view-learn [data-figure=limits] svg")`));
    ex.linksLearn = JSON.parse(await evaluate(ctx, linkInfo("#view-learn")));
    // 4. upload: the link in the Model tab opens the calculator; a spectrum file and a VCF.gz
    await evaluate(ctx, `location.hash = "#model"; true`);
    await sleep(300);
    await evaluate(ctx, `document.querySelector('#view-model a[href="#stats-upload"]').click(); true`);
    ex.uploadLinkMs = await evaluate(ctx, waitFor(`!document.querySelector("#view-stats").hidden && document.querySelector("#stats-upload .file-btn")`));
    await setFile(`document.querySelector('#stats-upload input[type=file]')`, "dadi_2d_unfolded.fs");
    ex.spectrumUploadMs = await evaluate(ctx, waitFor(`/dadi_2d_unfolded\\.fs/.test(document.querySelector("#stats-upload").textContent) && /2D/.test(document.querySelector("#stats-upload").textContent)`));
    ex.spectrumUploadText = (await evaluate(ctx, `document.querySelector("#stats-upload .hint[aria-live]")?.textContent ?? ""`)).slice(0, 160);
    await evaluate(ctx, `(() => { const s = document.querySelector('[data-key="wc-data"]'); s.value = "exact"; s.dispatchEvent(new Event("change")); return true; })()`);
    await sleep(300);
    await evaluate(ctx, `(() => { const t = document.querySelector('textarea[aria-label="Population map"]'); t.value = ${JSON.stringify(readFileSync(join(FILES, "calc_fixture_popmap.txt"), "utf-8"))}; return true; })()`);
    await setFile(`document.querySelector('input[type=file][aria-label="VCF file"]')`, "calc_fixture_400sites.vcf.gz");
    ex.vcfUploadMs = await evaluate(ctx, waitFor(`[...document.querySelectorAll("#view-stats [aria-live]")].some((e) => /VCF \\(/.test(e.textContent))`));
    ex.vcfUploadText = await evaluate(ctx, `[...document.querySelectorAll("#view-stats [aria-live]")].map((e) => e.textContent).find((t) => /VCF \\(/.test(t)) ?? ""`);
    await evaluate(ctx, `document.querySelector("#stats-upload").scrollIntoView(); true`);
    await shot(ctx, `extras_upload_${W}`);
    // the "Upload your own SFS" button switches back to the calculator from model mode
    await evaluate(ctx, `(() => { const r = document.querySelector('#stats-upload input[type=radio][value=model]'); r.checked = true; r.dispatchEvent(new Event("change")); return true; })()`);
    await sleep(300);
    ex.uploadButtonFromModelMode = await evaluate(ctx, `(() => { const had = Boolean(document.querySelector("#stats-upload .file-btn")); document.querySelector("#stats-upload-btn").click(); return { hadFileButtonBefore: had, hasFileButtonAfter: Boolean(document.querySelector("#stats-upload .file-btn")) }; })()`);
    // 5. Reset: back to the default model on the Model tab, theme choice kept
    await evaluate(ctx, `document.querySelector("#theme-toggle").click(); true`);
    ex.themeBeforeReset = await evaluate(ctx, `document.documentElement.dataset.theme ?? null`);
    await evaluate(ctx, `setTimeout(() => document.querySelector("#reset-all").click(), 50); true`);
    await sleep(2500);
    await evaluate(ctx, waitFor(modelReady));
    ex.afterReset = JSON.parse(await evaluate(ctx, `JSON.stringify({ search: location.search, hash: location.hash, preset: document.querySelector('[data-key="preset"]').value, theme: document.documentElement.dataset.theme ?? null, statsCalculator: false })`));
    await evaluate(ctx, `location.hash = "#stats"; true`);
    await evaluate(ctx, waitFor(`document.querySelector("#view-stats .stats-table")`));
    ex.afterReset.statsCalculator = await evaluate(ctx, `Boolean(document.querySelector("#stats-upload .file-btn"))`);
    await evaluate(ctx, `location.hash = "#model"; true`);
    await sleep(300);
    await shot(ctx, `extras_after_reset_${W}`);
    report.extras = ex;
    report.steps.push({ tab: "extras", ...ex });
  }
  if (args.bench) {
    await send("browsingContext.navigate", { context: ctx, url: `${BASE}bench.html`, wait: "complete" });
    const ms = await evaluate(ctx, waitFor(`document.getElementById("done")`, 600000));
    const res = await evaluate(ctx, `document.getElementById("result").textContent`);
    report.bench = { waitedMs: ms, result: JSON.parse(res) };
    await evaluate(ctx, `navigator.userAgent`).then((ua) => (report.userAgent = ua));
  }
  await send("session.end", {}).catch(() => {});
} catch (e) {
  report.fatal = String(e?.message ?? e);
} finally {
  try {
    ws?.close();
  } catch {}
  ff.kill("SIGTERM");
  await sleep(500);
  if (!ff.killed) ff.kill("SIGKILL");
  rmSync(PROFILE, { recursive: true, force: true });
}
report.ffVersionLine = (ffLog.match(/Mozilla Firefox[^\n]*/) ?? [""])[0];
writeFileSync(join(OUT, `report${args.dark ? "_dark" : ""}_${W}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ steps: report.steps, errors: logs.filter((l) => l.level === "error"), fatal: report.fatal ?? null, bench: report.bench ? "see report" : undefined }, null, 1));
process.exit(report.fatal ? 1 : 0);
