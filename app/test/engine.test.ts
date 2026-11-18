import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { computeSFS, views2D } from "../src/engine/compute.ts";
import { defaultModel, modelFromOverrides, Model } from "../src/engine/model.ts";
import { coalescentSFS } from "../src/engine/coalescent.ts";
import { fold, project, split1Dto2D, zeros } from "../src/engine/ndarray.ts";
import { steadyState1D } from "../src/engine/integrate.ts";
import { toDemesYaml } from "../src/engine/demes.ts";

const maxRel = (a: ArrayLike<number>, b: ArrayLike<number>, skip = (k: number) => k === 0 || k === a.length - 1, thr = 0) => {
  let m = 0;
  for (let k = 0; k < a.length; k++) {
    if (skip(k) || Math.abs(b[k]) <= thr) continue;
    m = Math.max(m, Math.abs(a[k] - b[k]) / Math.abs(b[k]));
  }
  return m;
};

const oneD = (anc: Model["ancestral"], n = 20): Model => ({ ...defaultModel(), mode: 1, ancestral: anc, n: [n, n] });

describe("analytic check: standard neutral model", () => {
  for (const n of [4, 20, 60, 100]) {
    it(`E[xi_i] = theta / i for n = ${n}`, () => {
      const r = computeSFS(oneD([{ nu: 1, T: 0.5, dyn: "sudden" }], n));
      const exact = Float64Array.from({ length: n + 1 }, (_, i) => (i > 0 && i < n ? 1 / i : 0));
      expect(maxRel(r.sfs.data, exact)).toBeLessThan(1e-13);
    });
  }
  it("steady state equals 1/i", () => {
    const s = steadyState1D(30);
    for (let i = 1; i < 30; i++) expect(Math.abs(s.data[i] * i - 1)).toBeLessThan(1e-13);
  });
  it("a split of an equilibrium population keeps 1/i in each margin (no change of size)", () => {
    const m: Model = { ...defaultModel(), mode: 2, ancestral: [{ nu: 1, T: 0.1, dyn: "sudden" }],
      post: [{ T: 0.3, nu: [1, 1], dyn: ["sudden", "sudden"], m12: 0, m21: 0, mig12On: true, mig21On: true }] };
    const { marg1, marg2 } = views2D(computeSFS(m).sfs);
    const exact = Float64Array.from({ length: 21 }, (_, i) => (i > 0 && i < 20 ? 1 / i : 0));
    expect(maxRel(marg1.data, exact)).toBeLessThan(1e-12);
    expect(maxRel(marg2.data, exact)).toBeLessThan(1e-12);
  });
});

describe("independent check: coalescent expectation for neutral 1D models", () => {
  const cases: [string, Model["ancestral"]][] = [
    ["sudden expansion", [{ nu: 10, T: 0.02, dyn: "sudden" }]],
    ["exponential growth", [{ nu: 10, T: 0.05, dyn: "exponential" }]],
    ["linear decline", [{ nu: 0.2, T: 0.2, dyn: "linear" }]],
    ["bottleneck and recovery", [{ nu: 0.05, T: 0.01, dyn: "sudden" }, { nu: 1, T: 0.05, dyn: "sudden" }]],
    ["three epochs, mixed", [{ nu: 2, T: 0.3, dyn: "linear" }, { nu: 0.2, T: 0.05, dyn: "sudden" }, { nu: 3, T: 0.1, dyn: "exponential" }]],
  ];
  for (const [name, anc] of cases) {
    it(`${name}: moment equations agree with the coalescent within the time-step error`, () => {
      const m = oneD(anc);
      const fine = computeSFS(m, { dtFac: 0.002 }).sfs.data;
      const co = coalescentSFS(m);
      expect(maxRel(fine, co)).toBeLessThan(2e-4);
      const dflt = computeSFS(m).sfs.data;
      expect(maxRel(dflt, co)).toBeLessThan(2e-3);
    });
  }
});

describe("moments fixtures (moments 1.7.1, from_demes on the engine's own Demes export)", () => {
  const path = fileURLToPath(new URL("./fixtures/moments_fixtures.json", import.meta.url));
  const fx = existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : { models: [] };
  it("fixture file is present", () => expect(fx.models.length).toBeGreaterThan(10));
  for (const f of fx.models as { model_id: string; overrides: unknown; sim_n: number[]; sfs: number[]; folded: number[]; folded_mask: number[] }[]) {
    it(`${f.model_id}: engine = moments to 1e-10`, () => {
      // use the internal sample sizes of the fixture (selection runs at a larger n)
      const nInt = Math.max(...f.sim_n);
      const r = computeSFS(modelFromOverrides(f.overrides), { selectionMinN1D: nInt, selectionMinN2D: nInt, migrationMinN2D: Math.min(...f.sim_n) });
      expect(r.plan.simN).toEqual(f.sim_n);
      expect(maxRel(r.sfs.data, f.sfs, undefined, 1e-12)).toBeLessThan(1e-10);
      const fo = fold(r.sfs);
      expect(Array.from(fo.mask)).toEqual(f.folded_mask);
      const keep = (k: number) => f.folded_mask[k] === 1;
      expect(maxRel(fo.data, f.folded, keep, 1e-12)).toBeLessThan(1e-10);
    });
  }
});

describe("spectrum manipulations", () => {
  it("projection of the neutral spectrum is the neutral spectrum", () => {
    const s = steadyState1D(40);
    const p = project(s, [15]);
    for (let i = 1; i < 15; i++) expect(Math.abs(p.data[i] * i - 1)).toBeLessThan(1e-12);
  });
  it("split conserves the total mass", () => {
    const s = steadyState1D(30);
    const t = split1Dto2D(s, 12, 18);
    const tot = (x: ArrayLike<number>) => Array.from(x).reduce((a, b) => a + b, 0);
    expect(Math.abs(tot(t.data) - tot(s.data)) / tot(s.data)).toBeLessThan(1e-13);
  });
  it("1D folding adds bin n-i to bin i and masks the upper half", () => {
    const a = zeros([7]);
    a.data.set([0, 6, 5, 4, 3, 2, 0]);
    const f = fold(a);
    expect(Array.from(f.data.slice(0, 4))).toEqual([0, 8, 8, 4]);
    expect(Array.from(f.mask)).toEqual([1, 0, 0, 0, 1, 1, 1]);
  });
  it("2D folding conserves the polymorphic mass", () => {
    const m: Model = { ...defaultModel(), mode: 2, migration: true, n: [8, 12] as [number, number],
      post: [{ T: 0.2, nu: [1, 2], dyn: ["sudden", "sudden"], m12: 1, m21: 1, mig12On: true, mig21On: true }] };
    const s = computeSFS(m).sfs;
    const f = fold(s);
    let a = 0;
    let b = 0;
    for (let k = 1; k < s.data.length - 1; k++) a += s.data[k];
    for (let k = 0; k < f.data.length; k++) if (!f.mask[k]) b += f.data[k];
    expect(Math.abs(a - b) / a).toBeLessThan(1e-13);
  });
});

describe("inbreeding transform", () => {
  const base = oneD([{ nu: 3, T: 0.1, dyn: "sudden" }]);
  it("F = 0 changes nothing", () => {
    const a = computeSFS(base).sfs.data;
    const b = computeSFS({ ...base, inbreeding: { on: true, F: [0, 0] } }).sfs.data;
    expect(maxRel(b, a)).toBeLessThan(1e-14);
  });
  it("F = 1 leaves only even counts and keeps the number of segregating sites of n/2 chromosomes", () => {
    const n = 20;
    const b = computeSFS({ ...base, inbreeding: { on: true, F: [1, 1] } }).sfs.data;
    for (let i = 1; i < n; i += 2) expect(Math.abs(b[i])).toBeLessThan(1e-15);
    const half = project(computeSFS(base).sfs, [n / 2]).data;
    for (let j = 1; j < n / 2; j++) expect(Math.abs(b[2 * j] - half[j]) / half[j]).toBeLessThan(1e-12);
  });
  it("conserves the total mass (polymorphic + monomorphic)", () => {
    const a = computeSFS(base).sfs.data;
    const b = computeSFS({ ...base, inbreeding: { on: true, F: [0.4, 0.4] } }).sfs.data;
    const tot = (x: ArrayLike<number>) => Array.from(x).reduce((s, v) => s + v, 0);
    expect(Math.abs(tot(a) - tot(b)) / tot(a)).toBeLessThan(1e-13);
  });
});

describe("Demes export", () => {
  it("writes a root deme, two daughters, migrations and a pulse; the last epochs end at 0", () => {
    const m: Model = { ...defaultModel(), mode: 2, migration: true,
      ancestral: [{ nu: 2, T: 0.3, dyn: "linear" }, { nu: 0.5, T: 0.1, dyn: "sudden" }],
      post: [{ T: 0.2, nu: [2, 0.3], dyn: ["exponential", "linear"], m12: 1, m21: 0.5, mig12On: true, mig21On: false },
             { T: 0.1, nu: [3, 0.3], dyn: ["sudden", "sudden"], m12: 0.5, m21: 1, mig12On: true, mig21On: true }],
      pulse: { on: true, time: 0.05, source: 1, f: 0.2 } };
    const y = toDemesYaml(m);
    expect(y).toContain("name: ANC");
    expect(y).toContain("ancestors: [ANC]");
    expect(y).toContain("size_function: linear");
    expect(y).toContain("{sources: [pop1], dest: pop2, time: 1000, proportions: [0.2]}");
    expect((y.match(/source: pop2, dest: pop1/g) ?? []).length).toBe(2);
    expect((y.match(/source: pop1, dest: pop2/g) ?? []).length).toBe(1);
    expect((y.match(/\{end_time: 0, start_size/g) ?? []).length).toBe(2);
  });
});
