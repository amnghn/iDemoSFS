#!/usr/bin/env python3
"""Simulation check: mean msprime SFS for one validation model (one SLURM array task).

The model is the Demes YAML exported by the TypeScript engine (validation/output/ts/<id>.yaml),
loaded with `msprime.Demography.from_demes` (Baumdicker et al. 2022). Linear size changes,
which msprime does not support, are replaced by 200 constant pieces (harmonic mean size per
piece). Samples are haploid sample nodes under a diploid time scale, sampled at time 0.

The expected SFS is estimated with the branch-mode AFS (`allele_frequency_spectrum(mode="branch")`),
which has no mutation noise: E[xi]/theta = E[branch length] / (4 N_ref). Each replicate is a
1 Mb sequence with recombination rate 1e-8 per bp per generation; the replicate means give the
Monte Carlo standard error.

Inbreeding (Blischak model) is simulated directly: with a autozygous individuals among k, the
joint branch AFS of the a "doubled" sample nodes and the 2(k - a) other nodes gives the count
2l + j'; the result is averaged over a ~ Binomial(k, F).

Usage: python validation/simulate_msprime_branch_sfs.py <array task id>   (row = task id + 2)
Output: validation/output/msprime/<id>.npz
"""

from __future__ import annotations

import math
import os
import sys
import time
from pathlib import Path

import numpy as np
import demes
import msprime

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sfsval.common import VAL, TS_OUT, row_by_array_index, load_ts, linear_to_piecewise  # noqa: E402

OUT_DIR = Path(os.environ.get("MSPRIME_OUT_DIR", str(VAL / "output" / "msprime")))  # override for extra runs
N_REF = 10_000
SEQ_LEN = 1_000_000
REC_RATE = 1e-8
REPLICATES = int(os.environ.get("MSPRIME_REPLICATES", "4000"))  # override only for quick tests


def load_graph(model_id: str) -> demes.Graph:
    g = demes.load(TS_OUT / f"{model_id}.yaml")
    if any(ep.size_function == "linear" for d in g.demes for ep in d.epochs):
        g = demes.Graph.fromdict(linear_to_piecewise(g.asdict()))
    return g


def main() -> int:
    task = int(sys.argv[1])
    row = row_by_array_index(task)
    mid = row["model_id"]
    if row["msprime"] != "yes":
        print(f"task {task}: {mid} is not marked for msprime; nothing to do")
        return 0
    ts_out = load_ts(mid)
    model = ts_out["model"]
    g = load_graph(mid)
    demog = msprime.Demography.from_demes(g)
    seed = int(os.environ.get("MSPRIME_SEED_BASE", "1000")) + task  # override for an independent extra run
    t0 = time.time()
    inbred = model["inbreeding"]["on"]
    if model["mode"] == 1:
        n = ts_out["n"][0]
        samples = [msprime.SampleSet(n, population="pop1", ploidy=1, time=0)]
    else:
        n1, n2 = ts_out["n"]
        samples = [msprime.SampleSet(n1, population="pop1", ploidy=1, time=0),
                   msprime.SampleSet(n2, population="pop2", ploidy=1, time=0)]
    reps = msprime.sim_ancestry(samples=samples, demography=demog, ploidy=2, sequence_length=SEQ_LEN,
                                recombination_rate=REC_RATE, random_seed=seed, num_replicates=REPLICATES)
    acc = acc2 = None
    count = 0
    for ts in reps:
        if model["mode"] == 1 and not inbred:
            afs = ts.allele_frequency_spectrum(mode="branch", polarised=True, span_normalise=True)
        elif model["mode"] == 1 and inbred:
            F = model["inbreeding"]["F"][0]
            k = n // 2
            nodes = np.arange(n)
            afs = np.zeros(n + 1)
            for a in range(k + 1):
                w = math.comb(k, a) * F**a * (1 - F) ** (k - a)
                dbl = nodes[:a]
                rest = nodes[a:a + 2 * (k - a)]
                if a == 0:
                    x = ts.allele_frequency_spectrum([rest], mode="branch", polarised=True, span_normalise=True)
                    afs[: len(x)] += w * x
                elif a == k:
                    x = ts.allele_frequency_spectrum([dbl], mode="branch", polarised=True, span_normalise=True)
                    for l in range(len(x)):
                        afs[2 * l] += w * x[l]
                else:
                    x = ts.allele_frequency_spectrum([dbl, rest], mode="branch", polarised=True, span_normalise=True)
                    for l in range(x.shape[0]):
                        for j in range(x.shape[1]):
                            afs[2 * l + j] += w * x[l, j]
        else:
            s1 = ts.samples(population=demog["pop1"].id)
            s2 = ts.samples(population=demog["pop2"].id)
            afs = ts.allele_frequency_spectrum([s1, s2], mode="branch", polarised=True, span_normalise=True)
        afs = np.asarray(afs) / (4 * N_REF)
        acc = afs.copy() if acc is None else acc + afs
        acc2 = afs**2 if acc2 is None else acc2 + afs**2
        count += 1
    mean = acc / count
    var = np.maximum(acc2 / count - mean**2, 0) * count / (count - 1)
    se = np.sqrt(var / count)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    np.savez(OUT_DIR / f"{mid}.npz", mean=mean, se=se, replicates=count, seq_len=SEQ_LEN,
             rec_rate=REC_RATE, n_ref=N_REF, seed=seed, seconds=time.time() - t0)
    print(f"{mid}: {count} replicates in {time.time() - t0:.1f} s (seed {seed})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
