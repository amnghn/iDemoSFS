"""Shared helpers for the validation scripts (run inside ./envs/sfs-validate).

- reading validation/models.csv and the TypeScript engine output (validation/output/ts/<id>.json),
- error metrics,
- the exact inbreeding sampling transform (an independent Python re-implementation),
- conversion of linear size changes to piecewise-constant epochs for msprime.
"""

from __future__ import annotations

import csv
import json
import math
from pathlib import Path

import numpy as np
from scipy.special import gammaln

ROOT = Path(__file__).resolve().parents[2]
VAL = ROOT / "validation"
TS_OUT = VAL / "output" / "ts"


# ---------------------------------------------------------------- rows and engine output

def read_models(csv_path: Path | str = VAL / "models.csv") -> list[dict]:
    with open(csv_path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def row_by_array_index(task_id: int, csv_path: Path | str = VAL / "models.csv") -> dict:
    """CSV-driven SLURM arrays: data row = line SLURM_ARRAY_TASK_ID + 2 (line 1 is the header)."""
    with open(csv_path, newline="", encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    line_no = task_id + 2
    if line_no > len(lines):
        raise IndexError(f"array task {task_id} -> line {line_no}, but the CSV has {len(lines)} lines")
    header = next(csv.reader([lines[0]]))
    values = next(csv.reader([lines[line_no - 1]]))
    return dict(zip(header, values))


def load_ts(model_id: str, ts_dir: Path = TS_OUT) -> dict:
    d = json.loads((ts_dir / f"{model_id}.json").read_text(encoding="utf-8"))
    shape = tuple(d["shape"])
    for k in ("sfs", "core_sfs", "folded"):
        d[k] = np.asarray(d[k], dtype=float).reshape(shape)
    d["folded_mask"] = np.asarray(d["folded_mask"], dtype=bool).reshape(shape)
    if len(shape) == 2:
        d["marg1"] = np.asarray(d["marg1"])
        d["marg2"] = np.asarray(d["marg2"])
        d["pooled"] = np.asarray(d["pooled"])
    return d


# ---------------------------------------------------------------- metrics

def polymorphic_mask(shape) -> np.ndarray:
    """True for every entry except the all-ancestral and all-derived corners."""
    m = np.ones(shape, dtype=bool)
    m.flat[0] = False
    m.flat[-1] = False
    return m


def compare_arrays(test: np.ndarray, ref: np.ndarray, rel_threshold: float = 1e-4, mask=None) -> dict:
    """Errors of `test` against `ref` over polymorphic entries.

    max_rel_nontrivial: max |test-ref|/|ref| over entries with ref >= rel_threshold * total
    max_rel_all:        the same over all entries with ref > 0
    max_abs_scaled:     max |test-ref| / total, total = sum of ref over the entries
    """
    test = np.asarray(test, dtype=float)
    ref = np.asarray(ref, dtype=float)
    keep = polymorphic_mask(ref.shape) if mask is None else mask
    t, r = test[keep], ref[keep]
    total = float(np.sum(np.abs(r)))
    diff = np.abs(t - r)
    nz = np.abs(r) > 0
    big = np.abs(r) >= rel_threshold * total
    return dict(
        n_entries=int(keep.sum()),
        n_nontrivial=int(big.sum()),
        max_rel_nontrivial=float(np.max(diff[big] / np.abs(r[big]))) if big.any() else float("nan"),
        max_rel_all=float(np.max(diff[nz] / np.abs(r[nz]))) if nz.any() else float("nan"),
        max_abs_scaled=float(np.max(diff) / total) if total > 0 else float("nan"),
    )


# ---------------------------------------------------------------- inbreeding transform (Python)

def _lncomb(n, k):
    return gammaln(n + 1) - gammaln(k + 1) - gammaln(n - k + 1)


def project_axis(a: np.ndarray, axis: int, n: int) -> np.ndarray:
    """Hypergeometric projection of one axis to sample size n."""
    a = np.moveaxis(np.asarray(a, dtype=float), axis, 0)
    n0 = a.shape[0] - 1
    out = np.zeros((n + 1,) + a.shape[1:])
    for hits in range(n0 + 1):
        k = np.arange(n + 1)
        with np.errstate(invalid="ignore"):
            lw = _lncomb(n, k) + _lncomb(n0 - n, hits - k) - _lncomb(n0, hits)
        valid = (k <= hits) & (hits - k <= n0 - n)
        w = np.where(valid, np.exp(np.where(valid, lw, 0.0)), 0.0)
        out += w.reshape((-1,) + (1,) * (a.ndim - 1)) * a[hits][None, ...]
    return np.moveaxis(out, 0, axis)


def inbreed_axis(a: np.ndarray, axis: int, F: float) -> np.ndarray:
    """Exact Blischak-model inbreeding transform along one axis (diploids, even n)."""
    a = np.asarray(a, dtype=float)
    n = a.shape[axis] - 1
    assert n % 2 == 0, "needs an even sample size"
    if F == 0:
        return a.copy()
    k = n // 2
    out = np.zeros_like(a)
    am = np.moveaxis(a, axis, 0)
    om = np.moveaxis(out, axis, 0)  # view into out
    for az in range(k + 1):
        w = math.comb(k, az) * F**az * (1 - F) ** (k - az)
        if w == 0:
            continue
        m = 2 * k - az
        proj = project_axis(am, 0, m)
        for j in range(m + 1):
            for l in range(max(0, j - (m - az)), min(az, j) + 1):
                p = math.comb(az, l) * math.comb(m - az, j - l) / math.comb(m, j)
                om[j + l] += w * p * proj[j]
    return out


def inbreed(a: np.ndarray, Fs) -> np.ndarray:
    out = np.asarray(a, dtype=float)
    for axis, F in enumerate(Fs):
        out = inbreed_axis(out, axis, F)
    return out


# ---------------------------------------------------------------- msprime helpers

def linear_to_piecewise(graph_dict: dict, pieces: int = 200) -> dict:
    """Replace every linear epoch of a Demes graph (as a dict, `asdict_simplified`) by
    `pieces` constant epochs. The size of each piece is the harmonic mean of the linear size
    over the piece, so that the coalescence rate integrated over each piece is exact."""
    g = json.loads(json.dumps(graph_dict))
    for deme in g["demes"]:
        new_eps = []
        start_time = deme.get("start_time", math.inf)
        for ep in deme["epochs"]:
            end_time = ep["end_time"]
            if ep.get("size_function") == "linear":
                N0, N1 = ep["start_size"], ep["end_size"]
                span = start_time - end_time
                for k in range(pieces):
                    a = start_time - span * k / pieces  # older bound of the piece
                    b = start_time - span * (k + 1) / pieces
                    fa, fb = (start_time - a) / span, (start_time - b) / span
                    Na, Nb = N0 + fa * (N1 - N0), N0 + fb * (N1 - N0)
                    # harmonic mean of a linear function over [a, b]
                    Nh = (Nb - Na) / math.log(Nb / Na) if abs(Nb - Na) > 1e-12 * Na else Na
                    new_eps.append({"end_time": b if k < pieces - 1 else end_time, "start_size": Nh})
            else:
                new_eps.append(ep)
            start_time = end_time
        deme["epochs"] = new_eps
    return g
