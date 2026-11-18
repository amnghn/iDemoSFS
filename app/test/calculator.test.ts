/**
 * Calculator mode: file parsers, residuals, haploid Weir & Cockerham and the VCF path, against
 * reference values from moments 1.7.1, egglib 3.6.1 and scikit-allel 1.3.13
 * (validation/export_calculator_fixtures.py, SLURM job in CHANGELOG.md).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseDadi, parseRealSFS, parseMatrix, looksLikeDadi, looksFolded, cornerTotal } from "../src/stats/parsers.ts";
import { optimalScaling, poissonResidual, anscombeResidual, llMultinom, lgamma } from "../src/stats/residuals.ts";
import { twoPopStats, wcFromGenotypeCounts } from "../src/stats/twopop.ts";
import { vcfToGenotypeCounts, parsePopmap, parseGenotypeTable, parseHweFiles } from "../src/stats/vcf.ts";
import { fold, cornerMask } from "../src/engine/ndarray.ts";

const fx = JSON.parse(readFileSync(new URL("./fixtures/calculator_fixtures.json", import.meta.url), "utf-8"));
const close = (a: number, b: number, rel = 1e-12, abs = 1e-12): boolean => Math.abs(a - b) <= abs + rel * Math.abs(b);

describe("parsers (moments 1.7.1 Spectrum.from_file / from_angsd)", () => {
  for (const f of fx.formats) {
    it(f.name, () => {
      const p = f.format === "realsfs" ? parseRealSFS(f.text, f.n, "first") : parseDadi(f.text);
      if (f.format !== "realsfs") expect(looksLikeDadi(f.text)).toBe(true);
      expect(p.shape).toEqual(f.expected.shape);
      expect(p.folded).toBe(f.expected.folded);
      p.data.forEach((v, k) => expect(close(v, f.expected.data[k], 1e-12)).toBe(true));
      expect(Array.from(p.mask)).toEqual(f.expected.mask);
    });
  }
  it("realSFS: several lines, mean, and the L from the corners", () => {
    const f = fx.formats.find((x: { name: string }) => x.name === "realsfs_2d");
    const p = parseRealSFS(f.text, f.n, "mean");
    expect(p.lines).toBe(2);
    expect(cornerTotal(p)).toBeCloseTo(51200, 6);
    expect(() => parseRealSFS(f.text, [6, 7])).toThrow(/need/);
  });
  it("population names and comments from the header", () => {
    const f = fx.formats.find((x: { name: string }) => x.name === "dadi_2d_unfolded");
    const p = parseDadi(f.text);
    expect(p.popNames).toEqual(["north", "south"]);
    expect(p.comments[0]).toMatch(/moments/);
  });
  it("plain matrix with the app's CSV labels", () => {
    const csv = "# comment\ni\\j,0,1,2\n0,,5,1\n1,7,3,2\n";
    const p = parseMatrix(csv.replace(",,", ",0,"));
    expect(p.shape).toEqual([2, 3]);
    expect(Array.from(p.data)).toEqual([0, 5, 1, 7, 3, 2]);
    const one = parseMatrix("10 5 3 2 0");
    expect(one.shape).toEqual([5]);
    expect(() => parseMatrix("1 2\n3")).toThrow(/row 2/);
  });
  it("folded spectra are recognised", () => {
    const f = fx.formats.find((x: { name: string }) => x.name === "dadi_2d_folded");
    const p = parseDadi(f.text);
    expect(looksFolded({ ...p, format: "matrix" })).toBe(true);
    const u = parseDadi(fx.formats.find((x: { name: string }) => x.name === "dadi_2d_unfolded").text);
    expect(looksFolded(u)).toBe(false);
  });
});

describe("residuals (moments.Inference)", () => {
  for (const r of fx.residuals) {
    it(r.name, () => {
      let model: Float64Array = Float64Array.from(r.model);
      let mask = cornerMask(r.shape);
      if (r.folded) {
        const f = fold({ shape: r.shape, data: model }, mask);
        model = f.data;
        mask = f.mask;
      }
      const dmask = Uint8Array.from(r.data_mask);
      const m = Uint8Array.from(mask, (v, k) => (v || dmask[k] ? 1 : 0));
      const c = optimalScaling(model, r.data, m);
      expect(close(c, r.scaling, 1e-12)).toBe(true);
      const scaled = model.map((v) => v * c);
      const pr = poissonResidual(scaled, r.data, m);
      const ar = anscombeResidual(scaled, r.data, m);
      r.poisson.forEach((v: number | null, k: number) => {
        if (v === null) expect(Number.isNaN(pr[k]) || m[k] === 1).toBe(true);
        else expect(close(pr[k], v, 1e-10, 1e-12)).toBe(true);
      });
      r.anscombe.forEach((v: number | null, k: number) => {
        if (v === null) expect(Number.isNaN(ar[k])).toBe(true);
        else expect(close(ar[k], v, 1e-10, 1e-12)).toBe(true);
      });
      expect(close(llMultinom(model, r.data, m), r.ll_multinom, 1e-11)).toBe(true);
    });
  }
  it("lgamma", () => {
    expect(lgamma(1)).toBeCloseTo(0, 12);
    expect(lgamma(11)).toBeCloseTo(Math.log(3628800), 10);
    expect(lgamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 12);
  });
});

describe("Weir & Cockerham, haploid option (egglib FstWC)", () => {
  it("theta from the joint SFS equals egglib and the analysis of variance", () => {
    const h = fx.haploid;
    const t = twoPopStats({ n1: h.n[0], n2: h.n[1], data: h.sfs }, { kind: "haploid" });
    expect(Math.abs(t.fstWC - h.egglib_FstWC)).toBeLessThan(1e-12);
    expect(Math.abs(t.fstWC - h.anova.theta)).toBeLessThan(1e-12);
    expect(Number.isNaN(t.fisWC)).toBe(true);
  });
});

describe("exact WC from a VCF (scikit-allel)", () => {
  it("VCF -> genotype counts -> WC equals scikit-allel, with missing genotypes", () => {
    const v = fx.vcf;
    const pm = parsePopmap(v.popmap);
    expect(pm.labels).toEqual(["north", "south"]);
    const g = vcfToGenotypeCounts(v.vcf, pm.map);
    expect(g.sites).toBe(v.sites);
    expect(g.skipped.multiallelic).toBe(1);
    expect(g.skipped.monomorphic).toBe(1);
    expect(g.skipped["missing or non-diploid genotypes"]).toBe(v.missing);
    const rows: Float64Array[] = [];
    for (let k = 0; k < g.counts.length; k += 6) rows.push(g.counts.subarray(k, k + 6));
    const w = wcFromGenotypeCounts(rows);
    // scikit-allel returns the components for both alleles of a biallelic site (equal), so its sums are twice ours
    expect(Math.abs(2 * w.a - v.allel.a)).toBeLessThan(1e-9 * Math.abs(v.allel.a) + 1e-12);
    expect(Math.abs(w.fstWC - v.allel.theta)).toBeLessThan(1e-12);
    expect(Math.abs(w.fisWC - v.allel.fis)).toBeLessThan(1e-12);
    expect(Math.abs(w.fitWC - v.allel.fit)).toBeLessThan(1e-12);
  });
  it("genotype table and vcftools --hardy files give the same counts", () => {
    const pm = parsePopmap(fx.vcf.popmap);
    const g = vcfToGenotypeCounts(fx.vcf.vcf, pm.map);
    const lines: string[] = ["homref1 het1 homalt1 homref2 het2 homalt2"];
    const h1: string[] = ["CHR\tPOS\tOBS(HOM1/HET/HOM2)\tE(HOM1/HET/HOM2)"];
    const h2: string[] = [...h1];
    for (let k = 0, s = 0; k < g.counts.length; k += 6, s++) {
      const c = Array.from(g.counts.subarray(k, k + 6));
      lines.push(c.join(" "));
      h1.push(`1\t${s}\t${c[0]}/${c[1]}/${c[2]}\t0/0/0`);
      h2.push(`1\t${s}\t${c[3]}/${c[4]}/${c[5]}\t0/0/0`);
    }
    const t = parseGenotypeTable(lines.join("\n"));
    expect(Array.from(t.counts)).toEqual(Array.from(g.counts));
    const hw = parseHweFiles(h1.join("\n"), h2.join("\n"));
    expect(Array.from(hw.counts)).toEqual(Array.from(g.counts));
  });
});
