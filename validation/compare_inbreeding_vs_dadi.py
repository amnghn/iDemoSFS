#!/usr/bin/env python3
"""Compare the inbreeding spectra of the TypeScript engine with dadi 2.4.3.

dadi computes the inbred spectrum with `Spectrum.from_phi_inbreeding` (Blischak et al. 2020;
per-individual beta-binomial genotype model, alpha = x(1-F)/F), from its own PDE solution phi,
extrapolated over three grid sizes. Four comparisons per model:

  a) TS inbred spectrum            vs dadi inbred spectrum          (the main check)
     (errors over bins with >= 0.01 % of the mass, and "bulk" bins with >= 1 %)
  b) TS outbred ("core") spectrum  vs dadi outbred spectrum         (baseline: moments vs dadi)
  c) Python transform(dadi outbred) vs dadi inbred                  (the transform alone, same phi)
  d) Python transform(TS core)      vs TS inbred                    (independent re-implementation)

Only models with sudden size changes are translated to dadi (enough for the two inbreeding
models of validation/models.csv). Output: validation/output/compare_inbreeding_vs_dadi.tsv
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
import dadi

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sfsval.common import VAL, read_models, load_ts, compare_arrays, inbreed  # noqa: E402

OUT = VAL / "output" / "compare_inbreeding_vs_dadi.tsv"
GRIDS = {"coarse": [40, 50, 60], "fine": [80, 90, 100]}


def dadi_model(model: dict, inbred: bool):
    """Return a dadi model function func(params, ns, pts) for a sudden-only model."""
    for e in model["ancestral"]:
        assert e["dyn"] == "sudden", "only sudden epochs are translated to dadi"
    if model["mode"] == 2:
        for e in model["post"]:
            assert e["dyn"] == ["sudden", "sudden"]
        assert not model["migration"] and not model["pulse"]["on"]
    Fs = model["inbreeding"]["F"][: model["mode"]]

    def func(params, ns, pts):
        xx = dadi.Numerics.default_grid(pts)
        phi = dadi.PhiManip.phi_1D(xx)
        for e in model["ancestral"]:
            if e["T"] > 0:
                phi = dadi.Integration.one_pop(phi, xx, e["T"], e["nu"])
        if model["mode"] == 1:
            if inbred:
                return dadi.Spectrum.from_phi_inbreeding(phi, ns, (xx,), (Fs[0],), (2,))
            return dadi.Spectrum.from_phi(phi, ns, (xx,))
        phi = dadi.PhiManip.phi_1D_to_2D(xx, phi)
        for e in model["post"]:
            phi = dadi.Integration.two_pops(phi, xx, e["T"], e["nu"][0], e["nu"][1], m12=0, m21=0)
        if inbred:
            return dadi.Spectrum.from_phi_inbreeding(phi, ns, (xx, xx), tuple(Fs), (2, 2))
        return dadi.Spectrum.from_phi(phi, ns, (xx, xx))

    return func


def main() -> int:
    rows = [r for r in read_models() if r["reference"] == "dadi"]
    cols = ["model_id", "grids", "a_ts_vs_dadi_inbred", "a_bulk", "b_ts_vs_dadi_outbred", "b_bulk", "c_transform_on_dadi",
            "d_python_vs_ts_transform", "dadi_seconds", "pass_1pct_bulk"]
    out = []
    for row in rows:
        ts = load_ts(row["model_id"])
        model = ts["model"]
        ns = tuple(ts["n"])
        Fs = model["inbreeding"]["F"][: model["mode"]]
        d_py = compare_arrays(inbreed(ts["core_sfs"], Fs), ts["sfs"])["max_rel_nontrivial"]
        for gname, pts in GRIDS.items():
            t0 = time.perf_counter()
            f_in = dadi.Numerics.make_extrap_func(dadi_model(model, True))
            f_out = dadi.Numerics.make_extrap_func(dadi_model(model, False))
            fs_in = np.asarray(f_in([], ns, pts).data)
            fs_out = np.asarray(f_out([], ns, pts).data)
            secs = time.perf_counter() - t0
            a = compare_arrays(ts["sfs"], fs_in)["max_rel_nontrivial"]
            b = compare_arrays(ts["core_sfs"], fs_out)["max_rel_nontrivial"]
            a_bulk = compare_arrays(ts["sfs"], fs_in, rel_threshold=1e-2)["max_rel_nontrivial"]
            b_bulk = compare_arrays(ts["core_sfs"], fs_out, rel_threshold=1e-2)["max_rel_nontrivial"]
            c = compare_arrays(inbreed(fs_out, Fs), fs_in)["max_rel_nontrivial"]
            r = dict(model_id=row["model_id"], grids=f"{gname} {pts}", a_ts_vs_dadi_inbred=a, a_bulk=a_bulk,
                     b_ts_vs_dadi_outbred=b, b_bulk=b_bulk, c_transform_on_dadi=c, d_python_vs_ts_transform=d_py,
                     dadi_seconds=secs, pass_1pct_bulk=a_bulk < 0.01)
            out.append(r)
            print(f"{row['model_id']:16s} {gname:6s} a={a:.2e} (bulk {a_bulk:.2e}) b={b:.2e} (bulk {b_bulk:.2e}) c={c:.2e} d={d_py:.2e} ({secs:.1f} s)", flush=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("\t".join(cols) + "\n")
        for r in out:
            fh.write("\t".join(f"{r[c]:.3e}" if isinstance(r[c], float) else str(r[c]) for c in cols) + "\n")
    print(f"table: {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
