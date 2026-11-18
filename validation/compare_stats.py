#!/usr/bin/env python3
"""Statistics check, part 3: compare the TypeScript statistics with tskit, scikit-allel, egglib.

Reads validation/output/stats/stats_reference.json (part 1, Python) and
validation/output/stats/stats_ts.json (part 2, `engine_cli.ts stats`). Writes
validation/output/stats/compare_stats.tsv with one row per (scenario, statistic, reference).

kind = "exact": the same quantity from the same data; must agree to numerical precision.
kind = "mean":   WC from the SFS against the mean scikit-allel WC sums over 200 random pairings
                (and random autozygosity) of the same haplotypes. Under random pairing, the
                corrected h-bar must agree to Monte Carlo precision; plain 2p(1-p) is biased.
kind = "approx": WC from the SFS (h from p and the allele count) against WC from genotypes; the
difference is a property of the estimator, reported, not a pass/fail criterion.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sfsval.common import VAL  # noqa: E402

D = VAL / "output" / "stats"
TOL = 1e-9  # relative tolerance for "exact" rows

EGG = [("S", "S"), ("thetaW", "thetaW"), ("thetaPi", "Pi"), ("tajimaD", "D"), ("fuLiD", "Dfl"),
       ("fuLiF", "F"), ("fuLiDstar", "D*"), ("fuLiFstar", "F*"), ("fayWuH", "Hns"), ("zengH", "Hsd"),
       ("zengE", "E"), ("thetaH", "thetaH"), ("thetaL", "thetaL")]


def rel(a: float, b: float) -> float:
    if b == 0:
        return abs(a - b)
    return abs(a - b) / abs(b)


def main() -> int:
    ref = json.loads((D / "stats_reference.json").read_text())
    ts_items = {x["id"]: x for x in json.loads((D / "stats_ts.json").read_text())}
    rows = []

    def add(scen, stat, tool, rv, tv, kind="exact"):
        r = rel(tv, rv)
        rows.append(dict(scenario=scen, statistic=stat, reference=tool, ref_value=rv, ts_value=tv,
                         rel_diff=r, kind=kind, ok=(r < TOL) if kind == "exact" else None))

    for mid, R in ref.items():
        L = R["L"]
        t = ts_items[f"{mid}:tskit_afs"]
        one = {"pop1": t.get("onepop") or t.get("pop1"), "pop2": t.get("pop2")}
        for pop in ("pop1", "pop2"):
            if pop not in R or one[pop] is None:
                continue
            o, rp = one[pop], R[pop]
            add(mid, f"{pop}: pi per site", "tskit diversity", rp["tskit"]["diversity"], o["thetaPi"] / L)
            add(mid, f"{pop}: S per site", "tskit segregating_sites", rp["tskit"]["segregating_sites"], o["S"] / L)
            add(mid, f"{pop}: Tajima's D", "tskit Tajimas_D", rp["tskit"]["tajimas_d"], o["tajimaD"])
            add(mid, f"{pop}: pi (dataset)", "allel mean_pairwise_difference", rp["allel"]["mpd_sum"], o["thetaPi"])
            add(mid, f"{pop}: Tajima's D", "allel tajima_d", rp["allel"]["tajima_d"], o["tajimaD"])
            for ts_name, egg_name in EGG:
                rv = rp["egglib"][egg_name]
                if rv is None:
                    continue
                add(mid, f"{pop}: {ts_name}", f"egglib {egg_name}", rv, o[ts_name])
        if "tskit2" in R:
            tw = t["twopop"]["hwe"]
            T2 = R["tskit2"]
            add(mid, "pi1 per site", "tskit diversity", T2["div1"], tw["pi1"] / L)
            add(mid, "pi2 per site", "tskit diversity", T2["div2"], tw["pi2"] / L)
            add(mid, "dxy per site", "tskit divergence", T2["divergence"], tw["dxy"] / L)
            add(mid, "Fst (tskit definition)", "tskit Fst", T2["Fst"], tw["fstTskit"])
            add(mid, "Hudson F_ST", "allel hudson_fst", R["allel_hudson"], tw["fstHudson"])
            for name, wc in R["wc"].items():
                g = ts_items[f"{mid}:genotypes_{name}"]
                ex = g["wc_genotypes"]
                add(mid, f"WC theta [{name}] genotype counts", "allel weir_cockerham_fst", wc["fst"], ex["fstWC"])
                add(mid, f"WC F_IS [{name}] genotype counts", "allel weir_cockerham_fst", wc["fis"], ex["fisWC"])
                tp = g["twopop"]
                add(mid, f"WC theta [{name}] SFS, h = 2p(1-p)2k/(2k-1)", "allel weir_cockerham_fst", wc["fst"], tp["hwe"]["fstWC"], "approx")
                add(mid, f"WC theta [{name}] SFS, h = 2p(1-p)", "allel weir_cockerham_fst", wc["fst"], tp["hwe_plain"]["fstWC"], "approx")
                if "fis" in tp:
                    add(mid, f"WC theta [{name}] SFS, F_IS approximation", "allel weir_cockerham_fst", wc["fst"], tp["fis"]["fstWC"], "approx")
                    add(mid, f"WC F_IS [{name}] SFS, F_IS approximation", "allel weir_cockerham_fst", wc["fis"], tp["fis"]["fisWC"], "approx")
            for name, wc in R.get("wc_mean", {}).items():
                tp = ts_items[f"{mid}:mean_{name}"]["twopop"]
                tag = f"mean of {name} over random pairings"
                add(mid, f"WC theta [{tag}] SFS, h = 2p(1-p)2k/(2k-1)", "allel (mean sums)", wc["fst"], tp["hwe"]["fstWC"], "mean")
                add(mid, f"WC theta [{tag}] SFS, h = 2p(1-p)", "allel (mean sums)", wc["fst"], tp["hwe_plain"]["fstWC"], "mean")
                if "fis" in tp:
                    add(mid, f"WC theta [{tag}] SFS, F_IS approximation", "allel (mean sums)", wc["fst"], tp["fis"]["fstWC"], "mean")
                    add(mid, f"WC F_IS [{tag}] SFS, F_IS approximation", "allel (mean sums)", wc["fis"], tp["fis"]["fisWC"], "mean")
    cols = ["scenario", "statistic", "reference", "ref_value", "ts_value", "rel_diff", "kind", "ok"]
    with open(D / "compare_stats.tsv", "w", encoding="utf-8") as fh:
        fh.write("\t".join(cols) + "\n")
        for r in rows:
            fh.write("\t".join(f"{r[c]:.10g}" if isinstance(r[c], float) else str(r[c]) for c in cols) + "\n")
    exact = [r for r in rows if r["kind"] == "exact"]
    bad = [r for r in exact if not r["ok"]]
    print(f"{len(exact) - len(bad)}/{len(exact)} exact comparisons within {TOL:g}")
    for r in bad:
        print(f"  MISMATCH {r['scenario']}: {r['statistic']} vs {r['reference']}: ref={r['ref_value']:.8g} ts={r['ts_value']:.8g} rel={r['rel_diff']:.2e}")
    for r in rows:
        if r["kind"] == "mean":
            print(f"  mean {r['scenario']}: {r['statistic']}: allel={r['ref_value']:.6f} ts={r['ts_value']:.6f} rel={r['rel_diff']:.3%}")
    for r in rows:
        if r["kind"] == "approx":
            print(f"  approx {r['scenario']}: {r['statistic']}: allel={r['ref_value']:.5f} ts={r['ts_value']:.5f} rel={r['rel_diff']:.3%}")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
