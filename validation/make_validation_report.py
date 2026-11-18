#!/usr/bin/env python3
"""Build the figures and tables of docs/VALIDATION.md from the validation outputs.

Figures: docs/validation/figures/<name>.png (300 dpi) and .pdf.
Tables:  docs/validation/tables/<name>.tsv (copies of the result tables) and Markdown tables
         written into docs/VALIDATION.md between <!-- AUTO:<name> --> and <!-- /AUTO:<name> -->.

Colours: Okabe-Ito categories (validated with the dataviz palette checker: blue, orange,
bluish green, vermillion; adjacent-pair CVD Delta E >= 11), marker shapes as a second
encoding; cividis for heatmaps. Run inside ./envs/sfs-validate from the project root.
"""

from __future__ import annotations

import csv
import json
import re
import shutil
import sys
from pathlib import Path

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import matplotlib.ticker  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sfsval.common import ROOT, VAL, read_models, load_ts, polymorphic_mask  # noqa: E402

DOC = ROOT / "docs" / "VALIDATION.md"
FIG = ROOT / "docs" / "validation" / "figures"
TAB = ROOT / "docs" / "validation" / "tables"
OUT = VAL / "output"
BENCH = VAL / "benchmarks"

OI = {"blue": "#0072B2", "orange": "#E69F00", "green": "#009E73", "vermillion": "#D55E00"}
GROUP_STYLE = {
    "1D-demography": (OI["blue"], "o"),
    "1D-advanced": (OI["orange"], "s"),
    "2D-demography": (OI["green"], "^"),
    "2D-advanced": (OI["vermillion"], "D"),
}
INK, MUTED, GRID = "#1f1f1f", "#5f5f5f", "#e3e3e3"

plt.rcParams.update({
    "font.size": 8, "axes.titlesize": 9, "axes.labelsize": 8, "xtick.labelsize": 7, "ytick.labelsize": 7,
    "legend.fontsize": 7, "axes.edgecolor": MUTED, "axes.labelcolor": INK, "xtick.color": MUTED,
    "ytick.color": MUTED, "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True,
    "grid.color": GRID, "grid.linewidth": 0.6, "axes.axisbelow": True, "pdf.fonttype": 42,
})


def read_tsv(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh, delimiter="\t"))


def save(fig, name: str) -> None:
    FIG.mkdir(parents=True, exist_ok=True)
    fig.savefig(FIG / f"{name}.png", dpi=300, bbox_inches="tight", facecolor="white")
    fig.savefig(FIG / f"{name}.pdf", bbox_inches="tight", facecolor="white")
    plt.close(fig)


def fmt(x, digits=2):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return str(x)
    if v != v:
        return "–"
    if v == 0:
        return "0"
    if abs(v) < 1e-3 or abs(v) >= 1e4:
        return f"{v:.{digits - 1}e}".replace("e-0", "e-").replace("e+0", "e+")
    return f"{v:.{digits}g}" if abs(v) < 1 else f"{v:.{max(digits - 1, 1)}f}"


def md_table(header: list[str], rows: list[list], align: list[str] | None = None) -> str:
    align = align or ["---"] * len(header)
    out = ["| " + " | ".join(header) + " |", "|" + "|".join(align) + "|"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def fill(doc: str, name: str, content: str) -> str:
    pat = re.compile(rf"(<!-- AUTO:{name} -->).*?(<!-- /AUTO:{name} -->)", re.S)
    if not pat.search(doc):
        raise KeyError(f"marker AUTO:{name} not found in {DOC}")
    return pat.sub(lambda m: m.group(1) + "\n" + content + "\n" + m.group(2), doc)


# ---------------------------------------------------------------- engine vs moments

def engine_vs_moments(doc: str) -> str:
    rows = read_tsv(OUT / "compare_engine_vs_moments.tsv")
    models = {r["model_id"]: r for r in read_models()}
    fig, ax = plt.subplots(figsize=(6.6, 5.6))
    ys = np.arange(len(rows))[::-1]
    for y, r in zip(ys, rows):
        c, mk = GROUP_STYLE[r["group"]]
        ax.scatter(float(r["max_rel_nontrivial"]), y, color=c, marker=mk, s=22, zorder=3,
                   edgecolor="white", linewidth=0.6)
        if r["direct_max_rel"] not in ("nan", ""):
            ax.scatter(float(r["direct_max_rel"]), y, facecolor="none", edgecolor=c, marker=mk, s=22, zorder=2, linewidth=0.8)
    ax.set_yticks(ys, [r["model_id"] for r in rows])
    ax.set_xscale("log")
    ax.set_xlim(1e-17, 1e-1)
    for v, lab in [(1e-6, "1e-6"), (1e-2, "1 % (target)")]:
        ax.axvline(v, color=MUTED, linewidth=0.8, linestyle="--", zorder=1)
        ax.text(v * 1.3, ys[0] + 0.6, lab, color=MUTED, fontsize=6.5, va="bottom")
    ax.set_xlabel("Maximum relative error per bin (bins with ≥ 0.01 % of the polymorphic mass)")
    ax.set_title("TypeScript engine against moments 1.7.1", loc="left", color=INK)
    handles = [plt.Line2D([], [], color=c, marker=mk, linestyle="", markersize=5, label=g) for g, (c, mk) in GROUP_STYLE.items()]
    handles += [plt.Line2D([], [], color="#7a7a7a", marker="o", linestyle="", markersize=5, label="filled: from_demes (Demes export)"),
                plt.Line2D([], [], markerfacecolor="none", markeredgecolor="#7a7a7a", marker="o", linestyle="", markersize=5,
                           label="open: moments API, double-precision start")]
    ax.legend(handles=handles, loc="upper center", bbox_to_anchor=(0.45, -0.08), ncol=3, frameon=False)
    ax.grid(axis="y", visible=False)
    save(fig, "fig1_engine_vs_moments_max_relative_error")
    shutil.copy(OUT / "compare_engine_vs_moments.tsv", TAB / "table1_engine_vs_moments.tsv")

    tab = [[r["model_id"], r["group"], r["shape"], models[r["model_id"]]["dynamics"], r["compared"], fmt(r["max_rel_nontrivial"]),
            fmt(r["direct_max_rel"]), fmt(r["fold_max_rel"]), r["fold_mask_equal"], fmt(r["views_max_rel"]),
            "yes" if r["pass_1pct"] == "True" else "**no**"] for r in rows]
    n_pass = sum(r["pass_1pct"] == "True" for r in rows)
    n_6 = sum(r["pass_1e-6"] == "True" for r in rows)
    worst = max(float(r["max_rel_nontrivial"]) for r in rows)
    summary = (f"*{n_pass} of {len(rows)} models within 1 %; {n_6} of {len(rows)} within 1e-6; "
               f"largest error {fmt(worst)}.*\n\n")
    doc = fill(doc, "engine_moments", summary + md_table(
        ["Model", "Group", "Shape", "Dynamics", "Compared", "Max rel. error (from_demes)", "Max rel. error (moments API, double start)",
         "Folding error", "Fold mask equal", "Views error (margins, pooled)", "< 1 %"], tab,
        ["---", "---", "---", "---", "---", "--:", "--:", "--:", ":-:", "--:", ":-:"]))
    return doc


# ---------------------------------------------------------------- dadi

def inbreeding_dadi(doc: str) -> str:
    rows = read_tsv(OUT / "compare_inbreeding_vs_dadi.tsv")
    shutil.copy(OUT / "compare_inbreeding_vs_dadi.tsv", TAB / "table2_inbreeding_vs_dadi.tsv")
    tab = [[r["model_id"], r["grids"], fmt(r["a_ts_vs_dadi_inbred"]), fmt(r["a_bulk"]), fmt(r["b_ts_vs_dadi_outbred"]),
            fmt(r["b_bulk"]), fmt(r["c_transform_on_dadi"]), fmt(r["d_python_vs_ts_transform"])] for r in rows]
    doc = fill(doc, "inbreeding_dadi", md_table(
        ["Model", "dadi grids (extrapolated)", "(a) TS inbred vs dadi inbred", "(a) main bins", "(b) TS outbred vs dadi outbred",
         "(b) main bins", "(c) transform(dadi outbred) vs dadi inbred", "(d) Python vs TS transform"], tab,
        ["---", "---", "--:", "--:", "--:", "--:", "--:", "--:"]))
    # figure: the 1D inbreeding model
    one = [r for r in read_models() if r["reference"] == "dadi" and r["group"].startswith("1D")]
    if one:
        ts = load_ts(one[0]["model_id"])
        n = ts["n"][0]
        i = np.arange(1, n)
        fig, (a1, a2) = plt.subplots(1, 2, figsize=(6.6, 2.6))
        a1.plot(i, ts["core_sfs"][1:n], color=OI["blue"], linewidth=2, marker="o", markersize=3.5, label="outbred (F = 0)")
        a1.plot(i, ts["sfs"][1:n], color=OI["vermillion"], linewidth=2, marker="s", markersize=3.5,
                label=f"inbred (F = {ts['model']['inbreeding']['F'][0]})")
        a1.set_yscale("log")
        a1.set_xlabel("Derived allele count i")
        a1.set_ylabel("Expected count (θ = 1)")
        a1.set_title(f"{one[0]['model_id']}: TypeScript engine", loc="left")
        a1.legend(frameon=False)
        a2.plot(i, ts["sfs"][1:n] / ts["core_sfs"][1:n], color=INK, linewidth=2)
        a2.axhline(1, color=MUTED, linewidth=0.8, linestyle="--")
        a2.set_xlabel("Derived allele count i")
        a2.set_ylabel("Inbred / outbred")
        a2.set_title("Ratio of the two spectra", loc="left")
        for ax in (a1, a2):
            ax.xaxis.set_major_locator(matplotlib.ticker.MaxNLocator(integer=True))
        fig.tight_layout()
        save(fig, "fig2_inbreeding_spectrum_and_ratio")
    return doc


# ---------------------------------------------------------------- msprime

def msprime(doc: str) -> str:
    rows = read_tsv(OUT / "compare_engine_vs_msprime.tsv")
    shutil.copy(OUT / "compare_engine_vs_msprime.tsv", TAB / "table3_engine_vs_msprime.tsv")
    tab = [[r["model_id"], r["shape"], r["replicates"], r["n_bins"], f"{float(r['frac_within_3se']):.3f}",
            f"{float(r['frac_within_3se_all_bins']):.3f}", fmt(r["max_abs_z"], 3),
            fmt(r["chi2_per_bin"], 3), fmt(r["max_rel_dev_1pct"]), fmt(r["median_rel_se_1pct"]),
            "yes" if r["pass"] == "True" else "**no**"] for r in rows]
    n_pass = sum(r["pass"] == "True" for r in rows)
    summary = (f"*{n_pass} of {len(rows)} models pass (|z| ≤ 3 in at least 95 % of the bins with at least 0.01 % of the "
               f"polymorphic mass).*\n\n")
    doc = fill(doc, "msprime", summary + md_table(
        ["Model", "Shape", "Replicates", "Non-trivial bins", "Fraction |z| ≤ 3", "Fraction |z| ≤ 3 (all bins)", "Max |z|", "Mean z²",
         "Max rel. deviation (bins ≥ 1 %)", "Median rel. SE (bins ≥ 1 %)", "Pass"], tab,
        ["---", "---", "--:", "--:", "--:", "--:", "--:", "--:", "--:", "--:", ":-:"]))

    extra = OUT / "compare_engine_vs_msprime_extra16000.tsv"
    if extra.exists():
        er = read_tsv(extra)
        shutil.copy(extra, TAB / "table3b_engine_vs_msprime_extra_16000_replicates.tsv")
        tab_e = [[r["model_id"], r["replicates"], f"{float(r['frac_within_3se']):.3f}", f"{float(r['frac_within_3se_all_bins']):.3f}",
                  fmt(r["max_abs_z"], 3), fmt(r["chi2_per_bin"], 3), fmt(r["max_rel_dev_1pct"])] for r in er]
        doc = fill(doc, "msprime_extra", md_table(
            ["Model", "Replicates (new seed)", "Fraction |z| ≤ 3 (non-trivial bins)", "Fraction |z| ≤ 3 (all bins)", "Max |z|",
             "Mean z²", "Max rel. deviation (bins ≥ 1 %)"], tab_e, ["---", "--:", "--:", "--:", "--:", "--:", "--:"]))
    # figure 3: 1D panels, expected vs simulated
    show1 = [m for m in ["snm", "exp_exponential_recent", "bottleneck_strong_recent", "contraction_linear",
                         "three_epoch_mixed", "inbreeding_F05"] if (OUT / "msprime" / f"{m}.npz").exists()]
    if show1:
        fig, axes = plt.subplots(2, 3, figsize=(6.8, 4.2), sharex=True)
        for ax, mid in zip(axes.ravel(), show1):
            ts = load_ts(mid)
            d = np.load(OUT / "msprime" / f"{mid}.npz")
            n = ts["n"][0]
            i = np.arange(1, n)
            ax.plot(i, ts["sfs"][1:n], color=OI["blue"], linewidth=2, label="expected (TypeScript engine)", zorder=2)
            ax.errorbar(i, d["mean"][1:n], yerr=2 * d["se"][1:n], fmt="o", color=OI["vermillion"], markersize=3,
                        elinewidth=1, capsize=0, label="msprime mean ± 2 SE", zorder=3)
            ax.set_yscale("log")
            ax.set_title(mid, loc="left", fontsize=8)
        for ax in axes[-1]:
            ax.set_xlabel("Derived allele count i")
        for ax in axes[:, 0]:
            ax.set_ylabel("E[ξᵢ] (θ = 1)")
        for ax in axes.ravel()[len(show1):]:
            ax.set_visible(False)
        h, lab = axes[0, 0].get_legend_handles_labels()
        fig.tight_layout(rect=(0, 0, 1, 0.94))
        fig.legend(h, lab, loc="upper center", ncol=2, frameon=False, bbox_to_anchor=(0.5, 1.0))
        save(fig, "fig3_msprime_vs_expected_1D")

    # figure 4: 2D |z| heatmaps
    show2 = [m for m in ["im_sym", "secondary_contact", "pulse_1to2"] if (OUT / "msprime" / f"{m}.npz").exists()]
    if show2:
        fig, axes = plt.subplots(1, len(show2), figsize=(2.3 * len(show2) + 0.6, 2.4), constrained_layout=True)
        axes = np.atleast_1d(axes)
        im = None
        for ax, mid in zip(axes, show2):
            ts = load_ts(mid)
            d = np.load(OUT / "msprime" / f"{mid}.npz")
            e = ts["sfs"]
            m, se = d["mean"].reshape(e.shape), d["se"].reshape(e.shape)
            z = np.full(e.shape, np.nan)
            keep = polymorphic_mask(e.shape) & (se > 0)
            z[keep] = np.abs(m[keep] - e[keep]) / se[keep]
            im = ax.imshow(z, origin="lower", cmap="cividis", vmin=0, vmax=4, aspect="equal")
            ax.set_title(mid, loc="left", fontsize=8)
            ax.set_xlabel("Count in pop 2")
            ax.set_ylabel("Count in pop 1")
            ax.grid(False)
        fig.colorbar(im, ax=axes, shrink=0.85, label="|z| = |msprime − expected| / SE")
        save(fig, "fig4_msprime_z_scores_2D")
    return doc


# ---------------------------------------------------------------- statistics

def statistics(doc: str) -> str:
    rows = read_tsv(OUT / "stats" / "compare_stats.tsv")
    shutil.copy(OUT / "stats" / "compare_stats.tsv", TAB / "table4_statistics_vs_tskit_allel_egglib.tsv")
    exact = [r for r in rows if r["kind"] == "exact"]
    by_ref: dict[str, list[float]] = {}
    for r in exact:
        tool = r["reference"].split()[0]
        stat = re.sub(r"^pop[12]: ", "", r["statistic"])
        key = f"{tool} | {r['reference']} | {stat}"
        by_ref.setdefault(key, []).append(float(r["rel_diff"]))
    tab = [[k.split(" | ")[0], k.split(" | ")[1], k.split(" | ")[2], len(v), fmt(max(v))] for k, v in sorted(by_ref.items())]
    worst = max(float(r["rel_diff"]) for r in exact)
    summary = f"*{len(exact)} exact comparisons; largest relative difference {fmt(worst)} (tolerance 1e-9).*\n\n"
    doc = fill(doc, "stats_exact", summary + md_table(
        ["Tool", "Reference function", "Statistic (TypeScript, from the SFS)", "Comparisons", "Max rel. difference"], tab,
        ["---", "---", "---", "--:", "--:"]))
    mean = [r for r in rows if r["kind"] == "mean"]
    tab2 = []
    for r in mean:
        m = re.match(r"WC (theta|F_IS) \[mean of (\S+) over random pairings\] SFS, (.*)$", r["statistic"])
        if not m:
            continue
        what, geno, method = m.groups()
        tab2.append([r["scenario"], "HWE" if geno == "hwe" else f"F = {geno[1:]}", what.replace("theta", "θ_WC"), method,
                     f"{float(r['ref_value']):.4f}", f"{float(r['ts_value']):.4f}", f"{100 * float(r['rel_diff']):.2f} %"])
    doc = fill(doc, "stats_wc", md_table(
        ["Scenario", "Genotypes", "Quantity", "SFS-based method", "scikit-allel (mean of 200)", "TypeScript", "Rel. difference"],
        tab2, ["---", "---", "---", "---", "--:", "--:", "--:"]))
    # figure 5: WC relative difference under HWE, corrected vs plain h
    hwe = {}
    for r in mean:
        if "[mean of hwe" in r["statistic"] and r["statistic"].startswith("WC theta"):
            key = "corrected" if "2k/(2k-1)" in r["statistic"] else "plain"
            hwe.setdefault(r["scenario"], {})[key] = 100 * float(r["rel_diff"])
    if hwe:
        sc = list(hwe)
        y = np.arange(len(sc))
        fig, ax = plt.subplots(figsize=(5.6, 2.2))
        ax.scatter([hwe[s]["corrected"] for s in sc], y + 0.12, color=OI["blue"], marker="o", s=26,
                   label="h̄ = 2p(1−p)·2k/(2k−1) (used in the app)", zorder=3)
        ax.scatter([hwe[s]["plain"] for s in sc], y - 0.12, color=OI["orange"], marker="s", s=26,
                   label="h̄ = 2p(1−p)", zorder=3)
        ax.set_yticks(y, sc)
        ax.set_xscale("log")
        ax.set_xlabel("|θ_WC from the SFS − mean scikit-allel θ_WC| (% of the latter), HWE genotypes, 200 random pairings")
        ax.legend(frameon=False, loc="lower center", bbox_to_anchor=(0.5, 1.0), ncol=2)
        ax.grid(axis="y", visible=False)
        save(fig, "fig5_weir_cockerham_heterozygosity_term")
    return doc


# ---------------------------------------------------------------- speed

def speed(doc: str) -> str:
    def load(p):
        return {r["model_id"]: r for r in read_tsv(p)} if p.exists() else {}
    t02 = load(BENCH / "ts_engine_timing_dtfac0.02.tsv")
    t10 = load(BENCH / "ts_engine_timing_dtfac0.1.tsv")
    mo = load(BENCH / "moments_from_demes_timing.tsv")
    if not t02 or not mo:
        return doc
    for p in ["ts_engine_timing_dtfac0.02.tsv", "ts_engine_timing_dtfac0.1.tsv", "moments_from_demes_timing.tsv"]:
        shutil.copy(BENCH / p, TAB / f"table5_speed_{p}")
    ids = [r["model_id"] for r in read_models()]
    tab = []
    for mid in ids:
        a, b, c = float(t02[mid]["median_ms"]), float(t10[mid]["median_ms"]) if t10 else float("nan"), float(mo[mid]["median_ms"])
        tab.append([mid, t02[mid]["shape"], f"{a:.2f}", f"{b:.2f}", f"{c:.1f}", f"{c / a:.1f}×"])
    doc = fill(doc, "speed", md_table(
        ["Model", "Shape", "TypeScript, full accuracy (ms)", "TypeScript, draft dt_fac 0.1 (ms)", "moments from_demes (ms)",
         "moments / TypeScript"], tab, ["---", "---", "--:", "--:", "--:", "--:"]))
    fig, ax = plt.subplots(figsize=(6.6, 6.0))
    y = np.arange(len(ids))[::-1]
    ax.scatter([float(t02[m]["median_ms"]) for m in ids], y, color=OI["blue"], marker="o", s=20, label="TypeScript, dt_fac 0.02", zorder=3)
    if t10:
        ax.scatter([float(t10[m]["median_ms"]) for m in ids], y, color=OI["orange"], marker="s", s=20, label="TypeScript, draft dt_fac 0.1", zorder=3)
    ax.scatter([float(mo[m]["median_ms"]) for m in ids], y, color=OI["green"], marker="^", s=22, label="moments 1.7.1 (from_demes)", zorder=3)
    ax.axvline(200, color=MUTED, linestyle="--", linewidth=0.8)
    ax.text(200 * 0.92, y[-1] - 0.4, "200 ms (spinner)", color=MUTED, fontsize=6.5, va="top", ha="right")
    ax.set_yticks(y, ids)
    ax.set_xscale("log")
    ax.set_xlabel("Median wall time per model (ms), one core, Node.js 22 / Python 3.12")
    ax.legend(frameon=False, loc="lower center", bbox_to_anchor=(0.45, 1.0), ncol=3)
    ax.grid(axis="y", visible=False)
    save(fig, "fig6_speed_typescript_vs_moments")
    return doc


# ---------------------------------------------------------------- selection closure

def selection_closure(doc: str) -> str:
    f = OUT / "selection_closure_error.tsv"
    if not f.exists():
        return doc
    rows = read_tsv(f)
    shutil.copy(f, TAB / "table6_selection_closure_error.tsv")
    tab = [[r["h"], r["gamma"], fmt(r["n20_bulk"]), fmt(r["n20_tail"]), r["n20_negative"], fmt(r["n40_to_20_bulk"]),
            fmt(r["n40_to_20_tail"]), r["n40_to_20_negative"], fmt(r["n100_to_20_bulk"]), fmt(r["n100_to_20_tail"]),
            r["n100_to_20_negative"]] for r in rows]
    return fill(doc, "selection_closure", md_table(
        ["h", "γ", "n = 20: main bins", "n = 20: all bins ≥ 0.01 %", "n = 20: negative bins", "40 → 20: main", "40 → 20: all",
         "40 → 20: negative", "100 → 20: main", "100 → 20: all", "100 → 20: negative"], tab,
        ["--:", "--:", "--:", "--:", "--:", "--:", "--:", "--:", "--:", "--:", "--:"]))


def main() -> int:
    TAB.mkdir(parents=True, exist_ok=True)
    doc = DOC.read_text(encoding="utf-8")
    for step in (engine_vs_moments, inbreeding_dadi, msprime, statistics, speed, selection_closure):
        doc = step(doc)
    DOC.write_text(doc, encoding="utf-8")
    print(f"figures in {FIG.relative_to(ROOT)}, tables in {TAB.relative_to(ROOT)}, {DOC.relative_to(ROOT)} updated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
