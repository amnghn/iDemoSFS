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
  if (!args.bench || args.only) {
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
