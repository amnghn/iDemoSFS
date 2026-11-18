#!/usr/bin/env python3
"""Compare the TypeScript expected SFS with the mean msprime branch SFS (Monte Carlo).

For every model with validation/output/msprime/<id>.npz: z = (mean_msprime - expected) / SE per
polymorphic bin with SE > 0 and at least 0.01 % of the polymorphic mass. Pass criterion (DESIGN.md Section 8.3): |z| <= 3 in at least 95 %
of the bins. Also reported: the largest relative deviation over bins that hold at least 1 % of
the polymorphic mass, and the median relative SE of those bins.

Output: validation/output/compare_engine_vs_msprime.tsv
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sfsval.common import VAL, read_models, load_ts, polymorphic_mask  # noqa: E402

MS_DIR = VAL / "output" / "msprime"
OUT = VAL / "output" / "compare_engine_vs_msprime.tsv"


def zstats(expected: np.ndarray, mean: np.ndarray, se: np.ndarray) -> dict:
    """z-scores over polymorphic bins with SE > 0 and at least 0.01 % of the polymorphic mass
    ("non-trivial" bins, as in the moments comparison); the fraction over all bins is also given."""
    poly = polymorphic_mask(expected.shape) & (se > 0)
    total = float(expected[polymorphic_mask(expected.shape)].sum())
    keep = poly & (expected >= 1e-4 * total)
    z_all = (mean[poly] - expected[poly]) / se[poly]
    e, m, s = expected[keep], mean[keep], se[keep]
    z = (m - e) / s
    big = e >= 0.01 * total
    return dict(
        n_bins=int(keep.sum()),
        frac_within_3se=float(np.mean(np.abs(z) <= 3)),
        frac_within_3se_all_bins=float(np.mean(np.abs(z_all) <= 3)),
        max_abs_z=float(np.max(np.abs(z))),
        chi2_per_bin=float(np.mean(z**2)),
        max_rel_dev_1pct=float(np.max(np.abs(m[big] - e[big]) / e[big])) if big.any() else float("nan"),
        median_rel_se_1pct=float(np.median(s[big] / e[big])) if big.any() else float("nan"),
    )


def main() -> int:
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--ms-dir", default=str(MS_DIR), help="directory with the msprime .npz files")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()
    ms_dir, out_path = Path(args.ms_dir), Path(args.out)
    cols = ["model_id", "shape", "replicates", "n_bins", "frac_within_3se", "frac_within_3se_all_bins", "max_abs_z", "chi2_per_bin",
            "max_rel_dev_1pct", "median_rel_se_1pct", "pass"]
    out = []
    for row in read_models():
        f = ms_dir / f"{row['model_id']}.npz"
        if row["msprime"] != "yes" or not f.exists():
            if row["msprime"] == "yes" and ms_dir == MS_DIR:
                print(f"{row['model_id']}: missing {f.name}")
            continue
        ts = load_ts(row["model_id"])
        d = np.load(f)
        exp = ts["sfs"]
        mean, se = d["mean"].reshape(exp.shape), d["se"].reshape(exp.shape)
        z = zstats(exp, mean, se)
        r = dict(model_id=row["model_id"], shape="x".join(map(str, exp.shape)), replicates=int(d["replicates"]), **z,
                 **{"pass": z["frac_within_3se"] >= 0.95})
        out.append(r)
        print(f"{r['model_id']:28s} within3SE={z['frac_within_3se']:.3f} max|z|={z['max_abs_z']:.2f} "
              f"chi2/bin={z['chi2_per_bin']:.2f} maxrel(>=1%)={z['max_rel_dev_1pct']:.4f} relSE={z['median_rel_se_1pct']:.4f}")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write("\t".join(cols) + "\n")
        for r in out:
            fh.write("\t".join(f"{r[c]:.4g}" if isinstance(r[c], float) else str(r[c]) for c in cols) + "\n")
    print(f"{sum(r['pass'] for r in out)}/{len(out)} models pass; table: {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
