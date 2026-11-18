#!/usr/bin/env python3
"""Write the validation test models: validation/models.csv and validation/models/<id>.json.

One row per model. The JSON files hold the app's model object (only the fields that differ
from the app's default model; app/src/engine/model.ts `defaultModel`). Standard library only.

With selection, the engine integrates at a larger internal sample size and projects down
(1D: n = 100; 2D: n = 40 per population); moments is run at the same internal sample size.

Columns of models.csv:
  model_id     short unique name (also the file name)
  group        1D-demography | 1D-advanced | 2D-demography | 2D-advanced
  preset       which preset of the prompt (Section 2.7) the model covers, or "-"
  dynamics     dynamics types used (sudden/linear/exponential)
  reference    main reference engine: moments | dadi (inbreeding)
  msprime      yes = also simulated with msprime (SLURM array; neutral models only)
  model_file   path of the JSON model, relative to the project root
  description  plain-text description

Usage (from the project root):  python3 validation/make_validation_models.py
"""

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_CSV = ROOT / "validation" / "models.csv"
OUT_DIR = ROOT / "validation" / "models"


def anc(*eps):
    return [dict(nu=nu, T=T, dyn=dyn) for nu, T, dyn in eps]


def post(T, nu, dyn=("sudden", "sudden"), m12=0.0, m21=0.0, on12=True, on21=True):
    return dict(T=T, nu=list(nu), dyn=list(dyn), m12=m12, m21=m21, mig12On=on12, mig21On=on21)


S = "sudden"
L = "linear"
E = "exponential"

MODELS = [
    # ---------------------------------------------------------------- 1D demography
    ("snm", "1D-demography", "Standard neutral model", S, "moments", "yes",
     "Constant size (one epoch at nu = 1)", dict(mode=1, ancestral=anc((1, 0.1, S)))),
    ("exp_sudden_recent", "1D-demography", "Recent expansion (sudden)", S, "moments", "yes",
     "Sudden 10-fold expansion, T = 0.02", dict(mode=1, ancestral=anc((10, 0.02, S)))),
    ("exp_sudden_ancient", "1D-demography", "Ancient expansion", S, "moments", "yes",
     "Sudden 10-fold expansion, T = 1.0", dict(mode=1, ancestral=anc((10, 1.0, S)))),
    ("exp_exponential_recent", "1D-demography", "Recent expansion (exponential)", E, "moments", "yes",
     "Exponential growth 1 -> 10, T = 0.05", dict(mode=1, ancestral=anc((10, 0.05, E)))),
    ("exp_exponential_ancient", "1D-demography", "Ancient expansion", E, "moments", "yes",
     "Exponential growth 1 -> 10 over T = 1.0", dict(mode=1, ancestral=anc((10, 1.0, E)))),
    ("exp_linear", "1D-demography", "Recent expansion", L, "moments", "yes",
     "Linear growth 1 -> 5, T = 0.3", dict(mode=1, ancestral=anc((5, 0.3, L)))),
    ("bottleneck_strong_recent", "1D-demography", "Bottleneck with recovery", S, "moments", "yes",
     "Bottleneck nu = 0.05 for T = 0.01, recovery for T = 0.05",
     dict(mode=1, ancestral=anc((0.05, 0.01, S), (1, 0.05, S)))),
    ("bottleneck_mild_recent", "1D-demography", "Bottleneck with recovery", S, "moments", "yes",
     "Bottleneck nu = 0.3 for T = 0.05, recovery for T = 0.05",
     dict(mode=1, ancestral=anc((0.3, 0.05, S), (1, 0.05, S)))),
    ("bottleneck_strong_old", "1D-demography", "Bottleneck with recovery", S, "moments", "yes",
     "Bottleneck nu = 0.05 for T = 0.01, recovery for T = 0.5",
     dict(mode=1, ancestral=anc((0.05, 0.01, S), (1, 0.5, S)))),
    ("contraction_sudden", "1D-demography", "Recent contraction", S, "moments", "yes",
     "Sudden contraction to nu = 0.2, T = 0.1", dict(mode=1, ancestral=anc((0.2, 0.1, S)))),
    ("contraction_exponential", "1D-demography", "Recent contraction", E, "moments", "yes",
     "Exponential decline 1 -> 0.1, T = 0.1", dict(mode=1, ancestral=anc((0.1, 0.1, E)))),
    ("contraction_linear", "1D-demography", "Recent contraction", L, "moments", "yes",
     "Linear decline 1 -> 0.2, T = 0.2", dict(mode=1, ancestral=anc((0.2, 0.2, L)))),
    ("three_epoch_mixed", "1D-demography", "-", "linear+sudden+exponential", "moments", "yes",
     "Structure (3): linear growth to 2, sudden drop to 0.2, exponential growth to 3",
     dict(mode=1, ancestral=anc((2, 0.3, L), (0.2, 0.05, S), (3, 0.1, E)))),
    ("snm_n60", "1D-demography", "Standard neutral model", S, "moments", "no",
     "Constant size, larger sample (n = 60)", dict(mode=1, ancestral=anc((1, 0.1, S)), n=[60, 60])),
    # ---------------------------------------------------------------- 1D advanced
    ("sel_neg10", "1D-advanced", "-", S, "moments", "no",
     "Purifying selection gamma = -10, h = 0.5, constant size",
     dict(mode=1, ancestral=anc((1, 0.1, S)), selection=dict(on=True, gamma=-10, h=0.5))),
    ("sel_pos5_expansion", "1D-advanced", "-", S, "moments", "no",
     "Positive selection gamma = +5, h = 0.5, with a sudden 2-fold expansion",
     dict(mode=1, ancestral=anc((2, 0.1, S)), selection=dict(on=True, gamma=5, h=0.5))),
    ("sel_neg10_h01", "1D-advanced", "-", S, "moments", "no",
     "Purifying selection gamma = -10, h = 0.1 (nearly recessive)",
     dict(mode=1, ancestral=anc((1, 0.1, S)), selection=dict(on=True, gamma=-10, h=0.1))),
    ("sel_neg10_h09", "1D-advanced", "-", S, "moments", "no",
     "Purifying selection gamma = -10, h = 0.9 (nearly dominant)",
     dict(mode=1, ancestral=anc((1, 0.1, S)), selection=dict(on=True, gamma=-10, h=0.9))),
    ("sel_neg30_bottleneck", "1D-advanced", "-", S, "moments", "no",
     "Strong purifying selection gamma = -30, h = 0.5, bottleneck",
     dict(mode=1, ancestral=anc((0.2, 0.05, S), (1, 0.1, S)), selection=dict(on=True, gamma=-30, h=0.5))),
    ("misid_expansion", "1D-advanced", "-", S, "moments", "no",
     "Ancestral misidentification eps = 0.02, sudden expansion",
     dict(mode=1, ancestral=anc((5, 0.05, S)), misid=dict(on=True, eps=0.02))),
    ("inbreeding_F05", "1D-advanced", "-", S, "dadi", "yes",
     "Inbreeding F = 0.5 (Blischak et al. 2020), two-epoch expansion",
     dict(mode=1, ancestral=anc((3, 0.1, S)), inbreeding=dict(on=True, F=[0.5, 0.5]))),
    # ---------------------------------------------------------------- 2D demography
    ("split_recent_nomig", "2D-demography", "Split, no gene flow", S, "moments", "yes",
     "Split T = 0.05 ago, no migration", dict(mode=2, ancestral=anc((1, 0.1, S)), post=[post(0.05, (1, 1))])),
    ("split_old_nomig", "2D-demography", "Split, no gene flow", S, "moments", "yes",
     "Split T = 1.0 ago, no migration, unequal sizes",
     dict(mode=2, ancestral=anc((1, 0.1, S)), post=[post(1.0, (2, 0.5))])),
    ("im_sym", "2D-demography", "Isolation with migration", S, "moments", "yes",
     "IM: split T = 0.5, symmetric M = 2",
     dict(mode=2, migration=True, ancestral=anc((1, 0.1, S)), post=[post(0.5, (1, 1), m12=2, m21=2)])),
    ("im_asym", "2D-demography", "Isolation with migration", S, "moments", "yes",
     "IM: split T = 0.5, M12 = 0.5, M21 = 5, sizes 2 and 0.5",
     dict(mode=2, migration=True, ancestral=anc((1, 0.1, S)), post=[post(0.5, (2, 0.5), m12=0.5, m21=5)])),
    ("im_exponential", "2D-demography", "Isolation with migration", E, "moments", "yes",
     "IM with exponential change to sizes 3 and 0.3, M = 1",
     dict(mode=2, migration=True, ancestral=anc((1, 0.1, S)), post=[post(0.3, (3, 0.3), (E, E), m12=1, m21=1)])),
    ("im_linear", "2D-demography", "Isolation with migration", L, "moments", "yes",
     "IM with linear change to sizes 3 and 0.5, M = 1",
     dict(mode=2, migration=True, ancestral=anc((1, 0.1, S)), post=[post(0.3, (3, 0.5), (L, L), m12=1, m21=1)])),
    ("secondary_contact", "2D-demography", "Secondary contact", S, "moments", "yes",
     "Isolation for T = 0.5 (migration masked), then contact for T = 0.1 with M = 2",
     dict(mode=2, migration=True, ancestral=anc((1, 0.1, S)),
          post=[post(0.5, (1, 1), on12=False, on21=False), post(0.1, (1, 1), m12=2, m21=2)])),
    ("ancient_migration", "2D-demography", "-", S, "moments", "yes",
     "Migration M = 2 for T = 0.3 after the split, then isolation for T = 0.3 (masked)",
     dict(mode=2, migration=True, ancestral=anc((1, 0.1, S)),
          post=[post(0.3, (1, 1), m12=2, m21=2), post(0.3, (1, 1), on12=False, on21=False)])),
    ("pulse_1to2", "2D-demography", "Admixture pulse", S, "moments", "yes",
     "Split T = 0.5; pulse from pop 1 into pop 2 at T = 0.1, f = 0.3",
     dict(mode=2, ancestral=anc((1, 0.1, S)), post=[post(0.5, (1, 1))],
          pulse=dict(on=True, time=0.1, source=1, f=0.3))),
    ("pulse_2to1", "2D-demography", "Admixture pulse", S, "moments", "yes",
     "Split T = 0.4, sizes 2 and 0.5; pulse from pop 2 into pop 1 at T = 0.2, f = 0.2",
     dict(mode=2, ancestral=anc((1, 0.1, S)), post=[post(0.4, (2, 0.5))],
          pulse=dict(on=True, time=0.2, source=2, f=0.2))),
    ("structured_one_population", "2D-demography", "Structured population sampled as one", S, "moments", "yes",
     "Two demes (sizes 0.5 each) split T = 2 ago with symmetric M = 1; one deme or the pooled demes are viewed",
     dict(mode=2, migration=True, ancestral=anc((1, 0.1, S)), post=[post(2.0, (0.5, 0.5), m12=1, m21=1)])),
    ("structure_3_2_mixed", "2D-demography", "-", "linear+sudden+exponential", "moments", "yes",
     "Structure (3, 2) with mixed dynamics and asymmetric migration",
     dict(mode=2, migration=True, ancestral=anc((2, 0.5, L), (0.5, 0.1, S), (1, 0.2, E)),
          post=[post(0.2, (2, 0.3), (E, L), m12=1, m21=0.5), post(0.1, (3, 0.3), (S, S), m12=0.5, m21=1)])),
    ("split_fraction_exponential", "2D-demography", "-", E, "moments", "yes",
     "Split fraction s = 0.2 (start sizes 0.2 and 0.8), exponential growth to 2 and 1, no migration",
     dict(mode=2, ancestral=anc((1, 0.1, S)), split=dict(useFraction=True, s=0.2, nu1=1, nu2=1),
          post=[post(0.2, (2, 1), (E, E))])),
    ("im_unequal_n", "2D-demography", "Isolation with migration", S, "moments", "yes",
     "IM with unequal sample sizes n = (10, 30)",
     dict(mode=2, migration=True, n=[10, 30], ancestral=anc((1, 0.1, S)), post=[post(0.4, (1, 2), m12=1, m21=1)])),
    # ---------------------------------------------------------------- 2D advanced
    ("im_selection", "2D-advanced", "-", S, "moments", "no",
     "IM (M = 1) with purifying selection gamma = -5, h = 0.3",
     dict(mode=2, migration=True, ancestral=anc((1, 0.1, S)), post=[post(0.3, (1, 1), m12=1, m21=1)],
          selection=dict(on=True, gamma=-5, h=0.3))),
    ("split_selection_nomig", "2D-advanced", "-", S, "moments", "no",
     "Split without migration, positive selection gamma = +3, h = 0.5",
     dict(mode=2, ancestral=anc((1, 0.1, S)), post=[post(0.3, (1, 0.5))],
          selection=dict(on=True, gamma=3, h=0.5))),
    ("misid_2d", "2D-advanced", "-", S, "moments", "no",
     "IM (M = 1) with ancestral misidentification eps = 0.03",
     dict(mode=2, migration=True, ancestral=anc((1, 0.1, S)), post=[post(0.3, (1, 1), m12=1, m21=1)],
          misid=dict(on=True, eps=0.03))),
    ("inbreeding_2d", "2D-advanced", "-", S, "dadi", "no",
     "Split without migration (T = 0.2), inbreeding F1 = 0.3, F2 = 0.6",
     dict(mode=2, ancestral=anc((1, 0.1, S)), post=[post(0.2, (1, 1))],
          inbreeding=dict(on=True, F=[0.3, 0.6]))),
]


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ids = [m[0] for m in MODELS]
    assert len(ids) == len(set(ids)), "duplicate model ids"
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["model_id", "group", "preset", "dynamics", "reference", "msprime", "model_file", "description"])
        for mid, group, preset, dyn, ref, msp, desc, model in MODELS:
            path = OUT_DIR / f"{mid}.json"
            path.write_text(json.dumps(model, indent=1) + "\n", encoding="utf-8")
            w.writerow([mid, group, preset, dyn, ref, msp, f"validation/models/{mid}.json", desc])
    print(f"{len(MODELS)} models written to {OUT_CSV.relative_to(ROOT)} and {OUT_DIR.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
