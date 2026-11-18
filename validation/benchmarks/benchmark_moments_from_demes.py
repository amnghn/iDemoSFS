#!/usr/bin/env python3
"""Speed of moments 1.7.1 (`Spectrum.from_demes`, dt_fac 0.02) for every validation model,
on the engine's own Demes export, single thread, median of 7 warm runs.
Output: validation/benchmarks/moments_from_demes_timing.tsv
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
import demes
import moments

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sfsval.common import VAL, TS_OUT, read_models, load_ts  # noqa: E402

OUT = VAL / "benchmarks" / "moments_from_demes_timing.tsv"


def main() -> int:
    lines = ["model_id\tshape\treps\tmedian_ms\tmin_ms"]
    for row in read_models():
        ts = load_ts(row["model_id"])
        model = ts["model"]
        g = demes.load(TS_OUT / f"{row['model_id']}.yaml")
        pops = ["pop1"] if model["mode"] == 1 else ["pop1", "pop2"]
        kw = dict(sampled_demes=pops, sample_sizes=ts["sim_n"], theta=1.0)
        if model["selection"]["on"]:
            kw.update(gamma=model["selection"]["gamma"], h=model["selection"]["h"])
        moments.Spectrum.from_demes(g, **kw)  # warm-up
        times = []
        for _ in range(7):
            t0 = time.perf_counter()
            fs = moments.Spectrum.from_demes(g, **kw)
            if list(fs.sample_sizes) != list(ts["n"]):
                fs = fs.project(ts["n"])
            times.append(1000 * (time.perf_counter() - t0))
        lines.append(f"{row['model_id']}\t{'x'.join(map(str, ts['shape']))}\t7\t{np.median(times):.2f}\t{min(times):.2f}")
        print(lines[-1], flush=True)
    OUT.write_text("\n".join(lines) + "\n")
    print(f"table: {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
