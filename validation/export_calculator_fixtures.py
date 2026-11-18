#!/usr/bin/env python3
"""Reference values for the calculator mode (Phase 2), written as a Vitest fixture.

Writes app/test/fixtures/calculator_fixtures.json with:
1. File formats: dadi/moments `.fs` text written by moments 1.7.1 (`Spectrum.to_file`; 1D and 2D,
   folded and unfolded, with population names), an old-format file (no fold/mask information,
   `foldmaskinfo=False`), and a realSFS-style line read by `moments.Spectrum.from_angsd`; for
   each, the data and mask that moments reads back (`Spectrum.from_file`).
2. Residuals: `moments.Inference.optimal_sfs_scaling`, `linear_Poisson_residual`,
   `Anscombe_Poisson_residual` and `ll_multinom` for unfolded and folded data (1D and 2D).
3. Haploid Weir & Cockerham: egglib `FstWC` ("Weir and Cockerham for haploid data") and an
   independent one-level analysis of variance, on haploid data simulated with msprime, together
   with the joint SFS of the same data (scikit-allel's estimator supports diploid data only).
4. VCF: a small VCF (diploid, two populations, with some missing genotypes), its population map,
   and scikit-allel's Weir & Cockerham sums for the same genotypes.
"""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import numpy as np
import moments
import msprime
import allel

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "test" / "fixtures" / "calculator_fixtures.json"
RNG = np.random.default_rng(20261118)


TMP = ROOT / "validation" / "output" / "calculator_fixture_files"


def fs_text(fs: moments.Spectrum, name: str, **kw) -> str:
    """Write with moments (to_file needs a real file) and return the text."""
    TMP.mkdir(parents=True, exist_ok=True)
    p = TMP / f"{name}.fs"
    fs.to_file(str(p), **kw)
    return p.read_text()


def read_back(text: str) -> dict:
    fs = moments.Spectrum.from_file(io.StringIO(text))
    return dict(shape=list(fs.shape), data=np.asarray(fs.data).ravel().tolist(), mask=np.asarray(np.ma.getmaskarray(fs)).ravel().astype(int).tolist(), folded=bool(fs.folded))


def formats() -> list[dict]:
    out = []
    one = moments.Demographics1D.two_epoch((5.0, 0.05), [12]) * 1000.0
    two = moments.Demographics2D.split_mig((1.0, 0.5, 0.3, 1.0), [6, 8]) * 1000.0
    two.pop_ids = ["north", "south"]
    one.pop_ids = ["pop A"]
    cases = [
        ("dadi_1d_unfolded", one, {}),
        ("dadi_1d_folded", one.fold(), {}),
        ("dadi_2d_unfolded", two, {}),
        ("dadi_2d_folded", two.fold(), {}),
        ("dadi_2d_old_format", two, {"foldmaskinfo": False}),
    ]
    for name, fs, kw in cases:
        text = fs_text(fs, name, comment_lines=["fixture written by moments " + moments.__version__], **kw)
        out.append(dict(name=name, format="dadi", text=text, expected=read_back(text)))
    # realSFS layout: one line, row-major with pop 1 as rows, including the monomorphic corners
    raw = np.asarray(two.data).copy()
    raw[0, 0], raw[-1, -1] = 50000.0, 1200.0
    line = " ".join(f"{v:.6f}" for v in raw.ravel())
    p = ROOT / "validation" / "output" / "fixture_realsfs.sfs"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(line + "\n" + line + "\n")  # two lines, as bootstrap output would have
    fs = moments.Spectrum.from_angsd(str(p), [6, 8], mask_corners=True)
    out.append(dict(name="realsfs_2d", format="realsfs", n=[6, 8], text=line + "\n" + line + "\n",
                    expected=dict(shape=list(fs.shape), data=np.asarray(fs.data).ravel().tolist(),
                                  mask=np.asarray(np.ma.getmaskarray(fs)).ravel().astype(int).tolist(), folded=False)))
    return out


def residuals() -> list[dict]:
    out = []
    model1 = moments.Demographics1D.two_epoch((3.0, 0.1), [10])
    data1 = moments.Spectrum(RNG.poisson(model1.data * 500.0).astype(float))
    model2 = moments.Demographics2D.split_mig((1.0, 1.0, 0.2, 2.0), [6, 6])
    data2 = moments.Spectrum(RNG.poisson(model2.data * 2000.0).astype(float))
    for name, model, data in [("res_1d", model1, data1), ("res_2d", model2, data2), ("res_2d_folded", model2, data2.fold())]:
        scaling = float(moments.Inference.optimal_sfs_scaling(model, data))
        scaled = moments.Inference.optimally_scaled_sfs(model, data)
        pois = moments.Inference.linear_Poisson_residual(scaled, data)
        ansc = moments.Inference.Anscombe_Poisson_residual(scaled, data)
        ll = float(moments.Inference.ll_multinom(model, data))
        nan = lambda a: [None if m else float(v) for v, m in zip(np.asarray(a.data).ravel(), np.ma.getmaskarray(a).ravel())]
        out.append(dict(name=name, shape=list(model.shape), model=np.asarray(model.data).ravel().tolist(),
                        data=np.asarray(data.data).ravel().tolist(), data_mask=np.asarray(np.ma.getmaskarray(data)).ravel().astype(int).tolist(),
                        folded=bool(data.folded), scaling=scaling, poisson=nan(pois), anscombe=nan(ansc), ll_multinom=ll))
    return out


def two_pop_ts(n1: int, n2: int, ploidy: int, seed: int):
    dem = msprime.Demography()
    dem.add_population(name="A", initial_size=10_000)
    dem.add_population(name="B", initial_size=5_000)
    dem.add_population(name="ANC", initial_size=10_000)
    dem.add_population_split(time=4_000, derived=["A", "B"], ancestral="ANC")
    dem.set_symmetric_migration_rate(["A", "B"], 1e-5)
    ts = msprime.sim_ancestry(samples={"A": n1, "B": n2}, demography=dem, ploidy=ploidy, sequence_length=2e6,
                              recombination_rate=1e-8, random_seed=seed)
    return msprime.sim_mutations(ts, rate=1e-8, random_seed=seed, discrete_genome=False)


def anova_haploid(gm: np.ndarray, n1: int, n2: int) -> dict:
    """One-level analysis of variance among gene copies (two populations), summed over sites:
    a = (MSP - MSG) / n_c, b = MSG; theta = sum(a) / sum(a + b)."""
    ns = np.array([n1, n2], float)
    N = ns.sum()
    nc = (N - (ns ** 2).sum() / N) / (2 - 1)
    sa = sb = 0.0
    for row in gm:
        p = np.array([row[:n1].mean(), row[n1:].mean()])
        pbar = (ns * p).sum() / N
        msp = (ns * (p - pbar) ** 2).sum() / (2 - 1)
        msg = (ns * p * (1 - p)).sum() / (N - 2)
        sa += (msp - msg) / nc
        sb += msg
    return dict(a=sa, b=sb, theta=sa / (sa + sb))


def haploid_wc() -> dict:
    """Haploid WC: egglib FstWC ("Weir and Cockerham for haploid data") and an independent
    analysis of variance; scikit-allel's weir_cockerham_fst supports diploid data only."""
    import egglib
    n1, n2 = 14, 22
    ts = two_pop_ts(n1, n2, 1, 41)
    gm = ts.genotype_matrix()  # sites x haplotypes
    struct = egglib.struct_from_samplesizes([n1, n2], ploidy=1)
    cs = egglib.stats.ComputeStats(struct=struct)
    cs.add_stats("FstWC")
    for row in gm:
        cs.process_site(egglib.site_from_list(["G" if a else "A" for a in row], alphabet=egglib.alphabets.DNA))
    egg = float(cs.results()["FstWC"])
    sfs = np.zeros((n1 + 1, n2 + 1))
    for row in gm:
        sfs[int(row[:n1].sum()), int(row[n1:].sum())] += 1
    return dict(n=[n1, n2], sfs=sfs.ravel().tolist(), egglib_FstWC=egg, anova=anova_haploid(gm, n1, n2), sites=int(gm.shape[0]),
                egglib_version=egglib.__version__)


def vcf_case() -> dict:
    k1, k2 = 9, 12
    ts = two_pop_ts(k1, k2, 2, 77)
    gm = ts.genotype_matrix()  # sites x haplotypes (2 per individual)
    nsite = min(gm.shape[0], 400)
    gm = gm[:nsite]
    gen = gm.reshape(nsite, k1 + k2, 2).astype(int)
    miss = RNG.random((nsite, k1 + k2)) < 0.05
    gen[miss] = -1
    names = [f"A_{i}" for i in range(k1)] + [f"B_{i}" for i in range(k2)]
    lines = ["##fileformat=VCFv4.2", '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
             "#" + "\t".join(["CHROM", "POS", "ID", "REF", "ALT", "QUAL", "FILTER", "INFO", "FORMAT"] + names)]
    pos = 0
    for s in range(nsite):
        pos += 1 + int(RNG.integers(1, 50))
        gts = ["./." if gen[s, j, 0] < 0 else f"{gen[s, j, 0]}|{gen[s, j, 1]}" for j in range(k1 + k2)]
        lines.append("\t".join(["1", str(pos), ".", "A", "C", ".", "PASS", ".", "GT:DP"] + [f"{x}:10" for x in gts]))
    # one multiallelic and one monomorphic record, which the parser must skip
    lines.append("\t".join(["1", str(pos + 5), ".", "A", "C,G", ".", "PASS", ".", "GT"] + ["0/1"] * (k1 + k2)))
    lines.append("\t".join(["1", str(pos + 9), ".", "A", ".", ".", "PASS", ".", "GT"] + ["0/0"] * (k1 + k2)))
    idx1, idx2 = list(range(k1)), list(range(k1, k1 + k2))
    a, b, c = allel.weir_cockerham_fst(allel.GenotypeArray(gen), subpops=[idx1, idx2], max_allele=1)
    sa, sb, sc = (float(np.nansum(x)) for x in (a, b, c))
    popmap = "\n".join([f"{n}\tnorth" for n in names[:k1]] + [f"{n}\tsouth" for n in names[k1:]])
    return dict(vcf="\n".join(lines) + "\n", popmap=popmap, sites=nsite, missing=int(miss.sum()),
                allel=dict(a=sa, b=sb, c=sc, theta=sa / (sa + sb + sc), fis=1 - sc / (sb + sc), fit=1 - sc / (sa + sb + sc)))


def main() -> int:
    fx = dict(source=f"moments {moments.__version__}, scikit-allel {allel.__version__}, msprime {msprime.__version__}",
              formats=formats(), residuals=residuals(), haploid=haploid_wc(), vcf=vcf_case())
    OUT.write_text(json.dumps(fx))
    print(f"fixtures written to {OUT.relative_to(ROOT)}: {len(fx['formats'])} files, {len(fx['residuals'])} residual cases, "
          f"haploid sites {fx['haploid']['sites']}, VCF sites {fx['vcf']['sites']} ({fx['vcf']['missing']} missing genotypes)")
    print("haploid: egglib FstWC", fx["haploid"]["egglib_FstWC"], "ANOVA", fx["haploid"]["anova"]["theta"], "| VCF allel theta", fx["vcf"]["allel"]["theta"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
