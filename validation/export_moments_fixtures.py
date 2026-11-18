#!/usr/bin/env python3
"""Export moments 1.7.1 spectra of selected validation models as a Vitest fixture.

The fixture (app/test/fixtures/moments_fixtures.json) holds, per model: the model overrides
(validation/models/<id>.json), the moments spectrum from `Spectrum.from_demes` on the engine's
own Demes export (theta = 1, at the engine's internal sample sizes `sim_n`, projected to the
requested sample sizes), and moments' folded spectrum. The test uses `sim_n`, so the fixture
stays valid when the engine's default internal sample sizes change. The Vitest suite recomputes each model with the TypeScript engine and compares, so
the engine can be checked against moments without Python (for example in GitHub Actions).
Models with h != 0.5 are not used here (moments' steady state rounds h to float32; see
compare_engine_vs_moments.py).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import demes
import moments

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sfsval.common import ROOT, VAL, TS_OUT, load_ts  # noqa: E402

MODELS = ["snm", "exp_exponential_recent", "exp_linear", "bottleneck_strong_recent", "three_epoch_mixed",
          "sel_neg10", "sel_pos5_expansion", "sel_neg30_bottleneck", "misid_expansion", "split_old_nomig", "im_asym",
          "im_linear", "secondary_contact", "pulse_2to1", "split_selection_nomig", "misid_2d", "im_unequal_n"]
OUT = ROOT / "app" / "test" / "fixtures" / "moments_fixtures.json"


def main() -> int:
    out = []
    for mid in MODELS:
        ts = load_ts(mid)
        model = ts["model"]
        g = demes.load(TS_OUT / f"{mid}.yaml")
        pops = ["pop1"] if model["mode"] == 1 else ["pop1", "pop2"]
        kw = dict(sampled_demes=pops, sample_sizes=ts["sim_n"], theta=1.0)
        if model["selection"]["on"]:
            assert model["selection"]["h"] == 0.5
            kw.update(gamma=model["selection"]["gamma"], h=model["selection"]["h"])
        fs = moments.Spectrum.from_demes(g, **kw)
        if list(fs.sample_sizes) != list(ts["n"]):
            fs = fs.project(ts["n"])
        if model["misid"]["on"]:
            fs = moments.Misc.flip_ancestral_misid(fs, model["misid"]["eps"])
        fo = fs.fold()
        overrides = json.loads((VAL / "models" / f"{mid}.json").read_text())
        out.append(dict(model_id=mid, overrides=overrides, shape=list(fs.shape), sim_n=list(ts["sim_n"]),
                        sfs=np.asarray(fs.data).ravel().tolist(),
                        folded=np.asarray(fo.data).ravel().tolist(),
                        folded_mask=np.asarray(fo.mask).ravel().astype(int).tolist()))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(dict(source="moments 1.7.1 Spectrum.from_demes on the engine's Demes export",
                                   models=out)))
    print(f"{len(out)} fixtures written to {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
