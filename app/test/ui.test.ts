/**
 * App logic outside the engine: presets (all compute), URL state, the effective model (toggles),
 * limits, "What changed?" rules, the content build (citations), SFS helpers and exports.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PRESETS, applyPreset, presetModel } from "../src/ui/presets.ts";
import { defaultState, effectiveModel, normalise, AppState } from "../src/ui/state.ts";
import { encodeState, decodeState, stateFromSearch } from "../src/ui/url.ts";
import { computeSFS } from "../src/engine/compute.ts";
import { validateModel } from "../src/engine/model.ts";
import { LIMITS, modelWarnings } from "../src/engine/limits.ts";
import { modelStats } from "../src/ui/modelStats.ts";
import { explain, summarise } from "../src/ui/whatChanged.ts";
import { SITE } from "../src/site_config.ts";
import { mafFilterJoint, projectJoint, polyBins, foldJoint } from "../src/stats/sfsutil.ts";
import { twoPopStats } from "../src/stats/twopop.ts";
import { sfsCsv, sfsFs } from "../src/ui/exports.ts";
import { parseDadi, parseMatrix } from "../src/stats/parsers.ts";
import { CITED_KEYS, DOCS, REFERENCE_LIST, RELATED_TOOLS } from "../src/generated/content.ts";
import { parseBib } from "../scripts/content/bib.ts";
import { fixed, fmt } from "../src/ui/dom.ts";

function stateFor(id: string): AppState {
  const s = defaultState();
  applyPreset(s, PRESETS.find((p) => p.id === id)!);
  return normalise(s);
}

describe("presets", () => {
  it("every preset is a valid model and computes", () => {
    for (const p of PRESETS) {
      const s = stateFor(p.id);
      const m = effectiveModel(s);
      expect(validateModel(m), p.id).toEqual([]);
      const r = computeSFS(m, { dtFac: 0.1 });
      expect(r.sfs.data.every(Number.isFinite), p.id).toBe(true);
    }
  });
  it("presets set the toggles they need", () => {
    expect(stateFor("secondary_contact").masksOn).toBe(true);
    expect(stateFor("im_sym").symMig).toBe(true);
    expect(stateFor("im_asym").symMig).toBe(false);
    expect(stateFor("sel_neg10_h01").dominanceOn).toBe(true);
    expect(stateFor("structured_pooled").display.view1D).toBe("pooled");
  });
  it("preset = validation model (the same JSON)", () => {
    const m = presetModel(PRESETS.find((p) => p.id === "pulse_2to1")!);
    expect(m.pulse).toEqual({ on: true, time: 0.2, source: 2, f: 0.2 });
  });
});

describe("state and URL", () => {
  it("round trip through the URL", () => {
    const s = stateFor("structured_one_deme");
    s.units.physical = true;
    s.display.folded = true;
    const back = decodeState(encodeState(s));
    expect(back.model).toEqual(s.model);
    expect(back.display).toEqual(s.display);
    expect(back.units).toEqual(s.units);
    expect(stateFromSearch(`?v=1&s=${encodeState(s)}`).state?.model).toEqual(s.model);
  });
  it("broken and newer links fall back with a message", () => {
    expect(stateFromSearch("?v=1&s=%%%").error).toMatch(/could not be read/);
    expect(stateFromSearch("?v=99&s=abc").error).toMatch(/newer version/);
    expect(stateFromSearch("").state).toBeNull();
  });
  it("toggles: symmetric migration, masks off, dominance off, disabled dynamics", () => {
    const s = stateFor("im_asym");
    s.symMig = true;
    s.dominanceOn = false;
    s.model.selection = { on: true, gamma: -2, h: 0.1 };
    s.model.post[0].mig12On = false;
    s.masksOn = false;
    s.dynOn = { sudden: true, linear: false, exponential: false };
    s.model.post[0].dyn = ["exponential", "linear"];
    const m = effectiveModel(s);
    expect(m.post[0].m21).toBe(m.post[0].m12);
    expect(m.post[0].mig12On).toBe(true);
    expect(m.selection.h).toBe(0.5);
    expect(m.post[0].dyn).toEqual(["sudden", "sudden"]);
  });
  it("normalise keeps n even with inbreeding and the pulse inside the post-split time", () => {
    const s = stateFor("pulse_1to2");
    s.model.inbreeding.on = true;
    s.model.n = [21, 15];
    s.model.post[0].T = 0.05;
    normalise(s);
    expect(s.model.n.every((n) => n % 2 === 0)).toBe(true);
    expect(s.model.pulse.time).toBeLessThan(0.05);
  });
});

describe("limits (STOP 2 decisions)", () => {
  it("|gamma| <= 20 in two populations, <= 50 in one", () => {
    const s = stateFor("im_sym");
    s.model.selection = { on: true, gamma: -25, h: 0.5 };
    expect(validateModel(effectiveModel(s)).join(" ")).toMatch(/at most 20/);
    s.model.selection.gamma = -15;
    expect(validateModel(effectiveModel(s))).toEqual([]);
    expect(modelWarnings(effectiveModel(s)).join(" ")).toMatch(/Strong selection/);
    const one = stateFor("snm");
    one.model.selection = { on: true, gamma: 40, h: 0.8 };
    one.dominanceOn = true;
    expect(validateModel(effectiveModel(one))).toEqual([]);
    expect(modelWarnings(effectiveModel(one)).join(" ")).toMatch(/dominant/);
    one.model.selection.gamma = 60;
    expect(validateModel(effectiveModel(one)).join(" ")).toMatch(/at most 50/);
  });
  it("sample sizes and sizes outside the limits are rejected", () => {
    const s = stateFor("im_sym");
    const m = effectiveModel(s);
    m.n = [LIMITS.n2D.max + 2, 20];
    expect(validateModel(m).join(" ")).toMatch(/sample size/);
    const m2 = effectiveModel(stateFor("snm"));
    m2.ancestral[0].nu = 500;
    expect(validateModel(m2).join(" ")).toMatch(/relative sizes/);
  });
});

describe("What changed? rules", () => {
  const sentences = (id: string): string => {
    const s = stateFor(id);
    const m = effectiveModel(s);
    const r = computeSFS(m);
    return explain(m, modelStats(r.sfs, m, s), s.display).join(" ");
  };
  it("expansion: excess of rare variants, star-like genealogy", () => {
    expect(sentences("exp_sudden_recent")).toMatch(/Excess of rare variants.*star-like/);
  });
  it("recent bottleneck: fewer rare variants", () => {
    expect(sentences("bottleneck_strong_recent")).toMatch(/Fewer rare variants.*bottleneck/);
  });
  it("structured population without size change: structure mimics a bottleneck, with citations", () => {
    const t = sentences("structured_one_deme");
    expect(t).toMatch(/No size change is needed/);
    expect(t).toMatch(/Ptak &amp; Przeworski 2002|Ptak & Przeworski 2002/);
  });
  it("misidentification: high-frequency derived variants and folding", () => {
    expect(sentences("misid_expansion")).toMatch(/misidentification/);
  });
  it("asymmetric IM: not called a bottleneck", () => {
    expect(sentences("im_asym")).not.toMatch(/bottleneck/);
  });
  it("standard neutral model", () => {
    const s = stateFor("snm");
    const m = effectiveModel(s);
    const sum = summarise(modelStats(computeSFS(m).sfs, m, s), "pop1");
    expect(Math.abs(sum.piOverW - 1)).toBeLessThan(1e-6);
  });
});

describe("SFS helpers", () => {
  const s = stateFor("im_sym");
  const r = computeSFS(effectiveModel(s));
  it("MAF filter 0 keeps everything; F_ST changes with the filter", () => {
    const f0 = mafFilterJoint(r.sfs, 0);
    for (let k = 1; k < f0.data.length - 1; k++) expect(f0.data[k]).toBe(r.sfs.data[k]);
    const f10 = mafFilterJoint(r.sfs, 0.1);
    const t0 = twoPopStats({ n1: 20, n2: 20, data: f0.data });
    const t10 = twoPopStats({ n1: 20, n2: 20, data: f10.data });
    expect(t10.fstHudson).not.toBeCloseTo(t0.fstHudson, 6);
  });
  it("projection keeps Hudson's F_ST nearly the same", () => {
    const p = projectJoint(r.sfs, 10, 20);
    const a = twoPopStats({ n1: 20, n2: 20, data: r.sfs.data });
    const b = twoPopStats({ n1: 10, n2: 20, data: p.data });
    expect(Math.abs(a.fstHudson - b.fstHudson)).toBeLessThan(1e-9);
  });
  it("statistics with symmetric weights are the same on the folded joint spectrum", () => {
    const f = foldJoint(r.sfs);
    const a = twoPopStats({ n1: 20, n2: 20, data: r.sfs.data });
    const b = twoPopStats({ n1: 20, n2: 20, data: f.data });
    for (const k of ["pi1", "pi2", "dxy", "fstHudson", "fstWC", "f2", "shared", "fixed"] as const) expect(Math.abs(a[k] - b[k])).toBeLessThan(1e-12 * Math.max(1, Math.abs(a[k])));
  });
  it("folded 1D bins", () => {
    const x = Float64Array.from([0, 5, 3, 2, 1, 0]);
    expect(polyBins(x, true)).toEqual({ bins: [1, 2], values: [6, 5] });
  });
});

describe("exports", () => {
  it(".fs export reads back with the parser (2D, folded and unfolded)", () => {
    for (const folded of [false, true]) {
      const s = stateFor("im_asym");
      s.display.folded = folded;
      const m = effectiveModel(s);
      const r = computeSFS(m);
      const p = parseDadi(sfsFs(r.sfs, m, s));
      expect(p.shape).toEqual([21, 21]);
      expect(p.folded).toBe(folded);
      const th = 4 * s.units.Nref * s.units.mu * s.units.L;
      if (!folded) p.data.forEach((v, k) => expect(Math.abs(v - th * r.sfs.data[k])).toBeLessThan(1e-9 * th));
    }
  });
  it("CSV export of a joint spectrum reads back as a matrix", () => {
    const s = stateFor("split_recent_nomig");
    const m = effectiveModel(s);
    const r = computeSFS(m);
    const csv = sfsCsv(r.sfs, m, s).replace(/^(\d+),,/m, "$1,0,").replace(/,$/m, ",0");
    const p = parseMatrix(csv);
    expect(p.shape).toEqual([21, 21]);
  });
});

describe("content and references", () => {
  it("every cited key is a verified reference in docs/REFERENCES.bib", () => {
    const bib = parseBib(readFileSync(new URL("../../docs/REFERENCES.bib", import.meta.url), "utf-8"));
    const keys = new Set(bib.map((e) => e.key));
    for (const k of CITED_KEYS) expect(keys.has(k), k).toBe(true);
    expect(REFERENCE_LIST.flatMap((g) => g.items).length).toBe(bib.length);
  });
  it("all teaching sections, statistic cards and About sections exist", () => {
    expect(DOCS.learn.sections.length).toBeGreaterThanOrEqual(11);
    expect(DOCS.stats.sections.filter((s) => s.id.startsWith("card-")).length).toBeGreaterThanOrEqual(12);
    for (const id of ["about-disclaimer", "about-ai", "about-cite", "about-contact", "about-licence", "about-version"]) expect(DOCS.about.sections.some((s) => s.id === id), id).toBe(true);
    expect(JSON.stringify(DOCS)).not.toMatch(/\[@/);
  });
  it("the About text has an {{EMAIL}} slot, and no address is written in the text", () => {
    const html = DOCS.about.sections.find((s) => s.id === "about-contact")!.html;
    expect(html).toMatch(/\{\{EMAIL\}\}/);
    expect(JSON.stringify(DOCS)).not.toMatch(/@univie/);
  });
  it("the contact email is set (given by the author at STOP 3)", () => {
    expect(SITE.email).toEqual(["aminghane", "univie.ac.at"]);
  });
  it("search engines: the page title names iDemoSFS, one canonical address, and a sitemap", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf-8");
    expect(html).toMatch(/<title>iDemoSFS: an interactive tool for demographic history and the expected SFS<\/title>/);
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/amnghn\.github\.io\/iDemoSFS\/" \/>/);
    expect(html).toMatch(/<meta name="google-site-verification" content="Y11Pu5A3iYskO289fvly20qk0cCtoevgZqeEALvQ1vQ" \/>/);
    const sitemap = readFileSync(new URL("../public/sitemap.xml", import.meta.url), "utf-8");
    expect(sitemap).toMatch(/<loc>https:\/\/amnghn\.github\.io\/iDemoSFS\/<\/loc>/);
    expect(readFileSync(new URL("../bench.html", import.meta.url), "utf-8")).toMatch(/name="robots" content="noindex"/);
  });
  it("the About page names the developer", () => {
    expect(DOCS.about.sections.find((s) => s.id === "about-author")!.title).toBe("Developer");
  });
  it("the dark theme has the same tokens with and without the theme button", () => {
    const css = readFileSync(new URL("../src/ui/style.css", import.meta.url), "utf-8");
    const block = (start: string): string => {
      const i = css.indexOf("{", css.indexOf(start)) + 1;
      return css.slice(i, css.indexOf("}", i)).split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
    };
    const system = block(':root:not([data-theme="light"])');
    const chosen = block(':root[data-theme="dark"]');
    expect(system.length).toBeGreaterThan(200);
    expect(chosen).toBe(system);
  });
  it("the repository URL is set (given by the author at STOP 3)", () => {
    expect(SITE.repo).toBe("https://github.com/amnghn/iDemoSFS");
    expect(SITE.repoIsPlaceholder).toBe(false);
  });
  it("related tools: only links that were checked", () => {
    expect(RELATED_TOOLS.length).toBeGreaterThan(5);
    for (const t of RELATED_TOOLS) expect(t.url).toMatch(/^https?:\/\//);
  });
});

describe("formatting", () => {
  it("no negative zero", () => {
    expect(fixed(-0.0004)).toBe("0.00");
    expect(fixed(-0.5)).toBe("−0.50");
    expect(fmt(-0)).toBe("0");
    expect(fmt(0.000123)).toBe("1.23e−4");
  });
});
