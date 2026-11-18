#!/usr/bin/env python3
"""Statistics check, part 1: simulate data and compute reference statistics.

For a few presets (the Demes YAML exported by the TypeScript engine), simulate one tree
sequence with msprime (2 Mb, recombination 1e-8, infinite-sites binary mutations at 1e-8,
diploid individuals of 2 sample nodes each, random pairing = Hardy-Weinberg proportions). On the
same data, compute reference values with
  - tskit (site mode; Ralph et al. 2020): diversity, divergence, Fst, segregating sites, Tajima's D;
  - scikit-allel: mean pairwise difference, Watterson's theta, Tajima's D, Hudson's F_ST,
    Weir & Cockerham's theta (with observed heterozygosity);
  - egglib 3 (with the ancestral allele as outgroup): Tajima's D, Fu & Li's D, F, D*, F*,
    Fay & Wu's H (raw and standardised, Zeng et al. 2006), Zeng's E, theta_H, theta_L;
and write the SFS of the same data (tskit site-mode AFS, and the joint allele counts from the
genotypes) for the TypeScript statistics (engine_cli.ts stats).

Heterozygote deficit: for F in {0.3, 0.6}, each individual is made autozygous at each site with
probability F (its second copy is replaced by the first). WC is then computed by scikit-allel
on these genotypes, and by the TypeScript code (a) from per-site genotype counts (exact option)
and (b) from the SFS with h = (1 - F) 2p(1-p) 2k/(2k-1) (F_IS approximation).

Averages over random pairings (the h-bar question of DESIGN.md Section 6.4): the same haplotypes
are paired into individuals at random R = 200 times (and, for each F, made autozygous at random
R times). scikit-allel's WC sums (a, b, c) are averaged over the R genotype sets and compared
with the TypeScript WC from the (mean) joint SFS. WC sums are linear in the SFS, so the mean of
the TS sums equals the TS sums of the mean SFS.

Outputs: validation/output/stats/stats_input_for_ts.json, validation/output/stats/stats_reference.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import demes
import msprime
import allel
import egglib

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sfsval.common import VAL, TS_OUT, load_ts, linear_to_piecewise  # noqa: E402

OUT = VAL / "output" / "stats"
SCENARIOS_1D = ["snm", "exp_exponential_recent", "bottleneck_strong_recent"]
SCENARIOS_2D = ["split_recent_nomig", "im_sym", "pulse_1to2", "structured_one_population"]
SEQ_LEN = 2_000_000
RATE = 1e-8
FS = [0.3, 0.6]
R_PAIRINGS = 200


def simulate(mid: str, seed: int):
    g = demes.load(TS_OUT / f"{mid}.yaml")
    if any(ep.size_function == "linear" for d in g.demes for ep in d.epochs):
        g = demes.Graph.fromdict(linear_to_piecewise(g.asdict()))
    demog = msprime.Demography.from_demes(g)
    ts_out = load_ts(mid)
    pops = ["pop1"] if ts_out["model"]["mode"] == 1 else ["pop1", "pop2"]
    samples = [msprime.SampleSet(n // 2, population=p, ploidy=2, time=0) for p, n in zip(pops, ts_out["n"])]
    ts = msprime.sim_ancestry(samples=samples, demography=demog, ploidy=2, sequence_length=SEQ_LEN,
                              recombination_rate=RATE, random_seed=seed)
    ts = msprime.sim_mutations(ts, rate=RATE, model=msprime.BinaryMutationModel(), discrete_genome=False,
                               random_seed=seed + 1)
    sets = [ts.samples(population=demog[p].id) for p in pops]
    return ts, sets, pops


def egglib_stats(hap: np.ndarray) -> dict:
    """hap: sites x n haplotypes, 0 = ancestral. The outgroup carries the ancestral allele."""
    n = hap.shape[1]
    struct = egglib.struct_from_samplesizes([n], ploidy=1, outgroup=1)
    cs = egglib.stats.ComputeStats(struct=struct)
    names = ["S", "thetaW", "Pi", "D", "Dfl", "F", "D*", "F*", "Hns", "Hsd", "E", "thetaH", "thetaL"]
    cs.add_stats(*names)
    alph = egglib.alphabets.DNA
    for row in hap:
        cs.process_site(egglib.site_from_list(["G" if a else "A" for a in row] + ["A"], alphabet=alph))
    r = cs.results()
    return {k: (None if r[k] is None else float(r[k])) for k in names}


def onepop_refs(ts, s, hap):
    ac = allel.HaplotypeArray(hap).count_alleles(max_allele=1)
    return dict(
        tskit=dict(diversity=float(ts.diversity([s], mode="site")[0]),
                   segregating_sites=float(ts.segregating_sites([s], mode="site")[0]),
                   tajimas_d=float(ts.Tajimas_D([s], mode="site")[0])),
        allel=dict(mpd_sum=float(np.sum(allel.mean_pairwise_difference(ac, fill=0))),
                   tajima_d=float(allel.tajima_d(ac)),
                   n_segregating=int(np.sum(ac.is_segregating()))),
        egglib=egglib_stats(hap[ac.is_segregating()]),
    )


def genotype_counts(gen: np.ndarray, idx1, idx2) -> list[list[int]]:
    """Per-site [homRef1, het1, homAlt1, homRef2, het2, homAlt2] from a sites x individuals x 2 array."""
    out = []
    dos = gen.sum(axis=2)
    for d in dos:
        a, b = d[idx1], d[idx2]
        out.append([int(np.sum(a == 0)), int(np.sum(a == 1)), int(np.sum(a == 2)),
                    int(np.sum(b == 0)), int(np.sum(b == 1)), int(np.sum(b == 2))])
    return out


def joint_sfs_from_genotypes(gen: np.ndarray, idx1, idx2) -> np.ndarray:
    n1, n2 = 2 * len(idx1), 2 * len(idx2)
    c1 = gen[:, idx1, :].sum(axis=(1, 2))
    c2 = gen[:, idx2, :].sum(axis=(1, 2))
    sfs = np.zeros((n1 + 1, n2 + 1))
    np.add.at(sfs, (c1, c2), 1)
    return sfs


def wc_sums(gen: np.ndarray, idx1, idx2) -> np.ndarray:
    a, b, c = allel.weir_cockerham_fst(allel.GenotypeArray(gen), subpops=[list(idx1), list(idx2)], max_allele=1)
    return np.array([np.nansum(a), np.nansum(b), np.nansum(c)], dtype=float)


def wc_from_sums(s: np.ndarray) -> dict:
    sa, sb, sc = (float(x) for x in s)
    return dict(fst=sa / (sa + sb + sc), fis=1 - sc / (sb + sc), fit=1 - sc / (sa + sb + sc))


def wc_allel(gen: np.ndarray, idx1, idx2) -> dict:
    return wc_from_sums(wc_sums(gen, idx1, idx2))


def random_pairing(hap1: np.ndarray, hap2: np.ndarray, rng) -> np.ndarray:
    """Pair the haplotypes of each population into diploid individuals at random."""
    g1 = hap1[:, rng.permutation(hap1.shape[1])].reshape(hap1.shape[0], -1, 2)
    g2 = hap2[:, rng.permutation(hap2.shape[1])].reshape(hap2.shape[0], -1, 2)
    return np.concatenate([g1, g2], axis=1)


def make_autozygous(gen: np.ndarray, F: float, rng) -> np.ndarray:
    g2 = gen.copy()
    auto = rng.random(g2.shape[:2]) < F
    g2[auto, 1] = g2[auto, 0]
    return g2


def drop_monomorphic(gen: np.ndarray) -> np.ndarray:
    tot = gen.sum(axis=(1, 2))
    return gen[~((tot == 0) | (tot == 2 * gen.shape[1]))]


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(20261118)
    inputs, refs = [], {}
    for k, mid in enumerate(SCENARIOS_1D + SCENARIOS_2D):
        ts, sets, pops = simulate(mid, seed=500 + 10 * k)
        L = ts.sequence_length
        G = ts.genotype_matrix()  # sites x sample nodes (0/1)
        ref = dict(model_id=mid, L=L, n_sites=int(ts.num_sites))
        if len(pops) == 1:
            s = sets[0]
            afs = ts.allele_frequency_spectrum([s], mode="site", polarised=True, span_normalise=False)
            inputs.append(dict(id=f"{mid}:tskit_afs", shape=list(afs.shape), sfs=afs.ravel().tolist()))
            ref["pop1"] = onepop_refs(ts, s, G[:, s])
        else:
            s1, s2 = sets
            afs = ts.allele_frequency_spectrum([s1, s2], mode="site", polarised=True, span_normalise=False)
            inputs.append(dict(id=f"{mid}:tskit_afs", shape=list(afs.shape), sfs=afs.ravel().tolist()))
            ref["tskit2"] = dict(div1=float(ts.diversity([s1], mode="site")[0]),
                                 div2=float(ts.diversity([s2], mode="site")[0]),
                                 divergence=float(ts.divergence([s1, s2], mode="site")),
                                 Fst=float(ts.Fst([s1, s2], mode="site")))
            ref["pop1"] = onepop_refs(ts, s1, G[:, s1])
            ref["pop2"] = onepop_refs(ts, s2, G[:, s2])
            # genotypes: sample nodes of one individual are consecutive (ploidy 2)
            nodes = np.concatenate([s1, s2])
            gen = G[:, nodes].reshape(G.shape[0], -1, 2)
            idx1 = np.arange(len(s1) // 2)
            idx2 = np.arange(len(s1) // 2, (len(s1) + len(s2)) // 2)
            ac1 = allel.GenotypeArray(gen).count_alleles(subpop=list(idx1), max_allele=1)
            ac2 = allel.GenotypeArray(gen).count_alleles(subpop=list(idx2), max_allele=1)
            num, den = allel.hudson_fst(ac1, ac2)
            ref["allel_hudson"] = float(np.sum(num) / np.sum(den))
            variants = {"hwe": gen}
            for F in FS:
                g2 = gen.copy()
                auto = rng.random(g2.shape[:2]) < F
                g2[auto, 1] = g2[auto, 0]
                variants[f"F{F}"] = g2
            # averages over random pairings / random autozygosity
            hap1, hap2 = G[:, s1], G[:, s2]
            ref["wc_mean"] = {}
            acc = np.zeros(3)
            for _ in range(R_PAIRINGS):
                acc += wc_sums(drop_monomorphic(random_pairing(hap1, hap2, rng)), idx1, idx2)
            ref["wc_mean"]["hwe"] = wc_from_sums(acc / R_PAIRINGS)
            j_hwe = joint_sfs_from_genotypes(drop_monomorphic(gen), idx1, idx2)
            inputs.append(dict(id=f"{mid}:mean_hwe", shape=list(j_hwe.shape), sfs=j_hwe.ravel().tolist()))
            for F in FS:
                acc = np.zeros(3)
                jacc = np.zeros_like(j_hwe)
                for _ in range(R_PAIRINGS):
                    g2 = drop_monomorphic(make_autozygous(random_pairing(hap1, hap2, rng), F, rng))
                    acc += wc_sums(g2, idx1, idx2)
                    jacc += joint_sfs_from_genotypes(g2, idx1, idx2)
                ref["wc_mean"][f"F{F}"] = wc_from_sums(acc / R_PAIRINGS)
                jm = jacc / R_PAIRINGS
                inputs.append(dict(id=f"{mid}:mean_F{F}", shape=list(jm.shape), sfs=jm.ravel().tolist(), fis=[F, F]))
            ref["wc"] = {}
            for name, g2 in variants.items():
                keep = ~((g2.sum(axis=(1, 2)) == 0) | (g2.sum(axis=(1, 2)) == 2 * g2.shape[1]))
                g2 = g2[keep]
                ref["wc"][name] = wc_allel(g2, idx1, idx2)
                jsfs = joint_sfs_from_genotypes(g2, idx1, idx2)
                item = dict(id=f"{mid}:genotypes_{name}", shape=list(jsfs.shape), sfs=jsfs.ravel().tolist(),
                            genotype_counts=genotype_counts(g2, idx1, idx2))
                if name != "hwe":
                    item["fis"] = [float(name[1:]), float(name[1:])]
                inputs.append(item)
        refs[mid] = ref
        print(f"{mid}: {ts.num_sites} sites, {ts.num_trees} trees", flush=True)
    (OUT / "stats_input_for_ts.json").write_text(json.dumps(inputs))
    (OUT / "stats_reference.json").write_text(json.dumps(refs, indent=1))
    print(f"written: {OUT}/stats_input_for_ts.json, stats_reference.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
