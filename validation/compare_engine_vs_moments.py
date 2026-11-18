#!/usr/bin/env python3
"""Compare the TypeScript engine with moments 1.7.1 for every model in validation/models.csv.

For each model, moments computes the SFS from the Demes YAML that the TypeScript engine itself
exported (`moments.Spectrum.from_demes`, theta = 1, default dt_fac = 0.02), with the same
internal sample sizes, then projects to the requested sample sizes and applies ancestral
misidentification (`moments.Misc.flip_ancestral_misid`). Inbreeding rows are compared on the
outbred ("core") spectrum here; the inbred spectrum is compared with dadi elsewhere.

Also checked: folding (TS fold vs moments `Spectrum.fold`), and for 2D models the marginal
spectra (`marginalize`) and the pooled sample (`Manips.merge_2D_to_1D`).

Second reference path ("direct"): for models with sudden size changes and no pulse, the same
model is also built with moments' own API (steady state -> integrate -> split -> integrate),
starting from a steady state solved in double precision. Reason: moments'
`LinearSystem_1D.steady_state_1D` is a Cython function whose `float` arguments are C single
precision, so `from_demes` starts from a steady state with gamma and h rounded to float32
(for example h = 0.9 -> 0.8999999762). The TypeScript engine keeps double precision.

Output: validation/output/compare_engine_vs_moments.tsv (one row per model).
Run inside ./envs/sfs-validate, from the project root (via SLURM: validation/slurm/).
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import importlib

import demes
import moments
from scipy.sparse.linalg import spsolve

jk = importlib.import_module("Jackknife")  # moments' compiled jackknife module
ls1 = moments.LinearSystem_1D

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sfsval.common import VAL, TS_OUT, read_models, load_ts, compare_arrays  # noqa: E402

OUT = VAL / "output" / "compare_engine_vs_moments.tsv"


def moments_sfs(row: dict, ts: dict) -> tuple[moments.Spectrum, float]:
    model = ts["model"]
    g = demes.load(TS_OUT / f"{row['model_id']}.yaml")
    pops = ["pop1"] if model["mode"] == 1 else ["pop1", "pop2"]
    sim_n = ts["sim_n"]
    kw = dict(sampled_demes=pops, sample_sizes=sim_n, theta=1.0)
    if model["selection"]["on"]:
        kw.update(gamma=model["selection"]["gamma"], h=model["selection"]["h"])
    times = []
    for _ in range(3):
        t0 = time.perf_counter()
        fs = moments.Spectrum.from_demes(g, **kw)
        times.append(time.perf_counter() - t0)
    if list(fs.sample_sizes) != list(ts["n"]):
        fs = fs.project(ts["n"])
    return fs, 1000 * float(np.median(times))


def steady_state_double(n: int, gamma: float, h: float) -> np.ndarray:
    """moments `steady_state_1D` (theta = 1, N = 1) with gamma and h kept in double precision."""
    d = n + 1
    mat = 0.25 * ls1.calcD(d) + gamma * h * ls1.calcS(d, jk.calcJK13(n)) + gamma * (1 - 2.0 * h) * ls1.calcS2(d, jk.calcJK23(n))
    b = np.zeros(d)
    b[1] = n * 0.25
    x = spsolve(mat[1:d - 1, 1:d - 1], -b[1:d - 1])
    return np.concatenate([[0.0], x, [0.0]])


def moments_direct(ts: dict):
    """The model through moments' API (sudden epochs, no pulse), double-precision start."""
    model = ts["model"]
    if model["pulse"]["on"]:
        return None
    eps = [e for e in model["ancestral"] if e["T"] > 0]
    if any(e["dyn"] != "sudden" for e in eps):
        return None
    if model["mode"] == 2 and any(d != "sudden" for e in model["post"] for d in e["dyn"]):
        return None
    sel = model["selection"]
    g = sel["gamma"] if sel["on"] else 0.0
    h = sel["h"] if sel["on"] else 0.5
    fs = moments.Spectrum(steady_state_double(ts["root_n"], g, h))
    for e in eps:
        fs.integrate([e["nu"]], e["T"], gamma=g, h=h)
    if model["mode"] == 2:
        fs = fs.split(0, ts["sim_n"][0], ts["sim_n"][1])
        for e in model["post"]:
            m = None
            if model["migration"] and (e["mig12On"] or e["mig21On"]):
                m = [[0, e["m12"] if e["mig12On"] else 0], [e["m21"] if e["mig21On"] else 0, 0]]
            fs.integrate(list(e["nu"]), e["T"], gamma=[g, g], h=[h, h], m=m)
    if list(fs.sample_sizes) != list(ts["n"]):
        fs = fs.project(ts["n"])
    out = np.array(fs.data)
    if model["misid"]["on"]:
        out = np.array(moments.Misc.flip_ancestral_misid(moments.Spectrum(out), model["misid"]["eps"]).data)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--only", nargs="*", help="model ids to run (default: all)")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()
    rows = [r for r in read_models() if not args.only or r["model_id"] in args.only]
    cols = ["model_id", "group", "shape", "compared", "n_nontrivial", "max_rel_nontrivial", "max_rel_all",
            "max_abs_scaled", "direct_max_rel", "fold_max_rel", "fold_mask_equal", "views_max_rel", "ts_ms", "moments_ms", "pass_1e-6", "pass_1pct"]
    out_rows = []
    for row in rows:
        mid = row["model_id"]
        ts = load_ts(mid)
        fs, ms = moments_sfs(row, ts)
        model = ts["model"]
        compared = "core (outbred)" if model["inbreeding"]["on"] else "final"
        ref = np.array(fs.data)
        if model["misid"]["on"]:
            ref = np.array(moments.Misc.flip_ancestral_misid(fs, model["misid"]["eps"]).data)
        test = ts["core_sfs"] if model["inbreeding"]["on"] else ts["sfs"]
        if model["inbreeding"]["on"] and model["misid"]["on"]:
            raise ValueError("inbreeding and misidentification together are not compared here")
        err = compare_arrays(test, ref)
        direct = moments_direct(ts)
        direct_rel = compare_arrays(test, direct)["max_rel_nontrivial"] if direct is not None else float("nan")
        # folding: moments fold of its own final spectrum vs the TS fold of the TS final spectrum
        if model["inbreeding"]["on"]:
            fold_rel, mask_eq = float("nan"), "n/a"
        else:
            ref_sp = moments.Spectrum(ref)
            fo = ref_sp.fold()
            keep = ~np.asarray(fo.mask)
            mask_eq = str(bool(np.array_equal(np.asarray(fo.mask), ts["folded_mask"])))
            fe = compare_arrays(ts["folded"], np.asarray(fo.data), mask=keep)
            fold_rel = fe["max_rel_nontrivial"]
        # 2D views
        views = float("nan")
        if len(ts["shape"]) == 2 and not model["inbreeding"]["on"]:
            sp = moments.Spectrum(ref)
            m1 = np.asarray(sp.marginalize([1]).data)
            m2 = np.asarray(sp.marginalize([0]).data)
            pooled = np.asarray(moments.Manips.merge_2D_to_1D(sp).data)
            views = max(compare_arrays(ts["marg1"], m1)["max_rel_nontrivial"],
                        compare_arrays(ts["marg2"], m2)["max_rel_nontrivial"],
                        compare_arrays(ts["pooled"], pooled)["max_rel_nontrivial"])
        r = dict(model_id=mid, group=row["group"], shape="x".join(map(str, ts["shape"])), compared=compared,
                 n_nontrivial=err["n_nontrivial"], max_rel_nontrivial=err["max_rel_nontrivial"],
                 max_rel_all=err["max_rel_all"], max_abs_scaled=err["max_abs_scaled"], direct_max_rel=direct_rel,
                 fold_max_rel=fold_rel, fold_mask_equal=mask_eq, views_max_rel=views,
                 ts_ms=ts["stats"]["ms"], moments_ms=ms,
                 **{"pass_1e-6": err["max_rel_nontrivial"] < 1e-6, "pass_1pct": err["max_rel_nontrivial"] < 1e-2})
        out_rows.append(r)
        print(f"{mid:28s} {r['shape']:6s} rel={err['max_rel_nontrivial']:.2e} all={err['max_rel_all']:.2e} "
              f"direct={direct_rel:.1e} fold={fold_rel:.1e} mask={mask_eq} views={views:.1e} moments={ms:.1f}ms", flush=True)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write("\t".join(cols) + "\n")
        for r in out_rows:
            fh.write("\t".join(f"{r[c]:.3e}" if isinstance(r[c], float) else str(r[c]) for c in cols) + "\n")
    n_pass = sum(r["pass_1pct"] for r in out_rows)
    print(f"\n{n_pass}/{len(out_rows)} models within 1 %; "
          f"{sum(r['pass_1e-6'] for r in out_rows)}/{len(out_rows)} within 1e-6. Table: {args.out}")
    return 0 if n_pass == len(out_rows) else 1


if __name__ == "__main__":
    sys.exit(main())
