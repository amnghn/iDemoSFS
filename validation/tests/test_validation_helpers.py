"""pytest tests for the Python validation helpers (run inside ./envs/sfs-validate):

    python -m pytest validation/tests -q
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sfsval.common import (  # noqa: E402
    VAL, compare_arrays, inbreed_axis, linear_to_piecewise, polymorphic_mask, project_axis,
    read_models, row_by_array_index,
)


def neutral(n: int) -> np.ndarray:
    x = np.zeros(n + 1)
    x[1:n] = 1.0 / np.arange(1, n)
    return x


def test_models_csv_has_at_least_30_models_and_unique_ids():
    rows = read_models()
    assert len(rows) >= 30
    assert len({r["model_id"] for r in rows}) == len(rows)
    for r in rows:
        assert (VAL.parent / r["model_file"]).exists()


def test_array_index_maps_to_data_rows():
    rows = read_models()
    assert row_by_array_index(0)["model_id"] == rows[0]["model_id"]
    assert row_by_array_index(len(rows) - 1)["model_id"] == rows[-1]["model_id"]
    with pytest.raises(IndexError):
        row_by_array_index(len(rows))


def test_compare_arrays_identical_and_scaled():
    a = neutral(20)
    e = compare_arrays(a, a)
    assert e["max_rel_nontrivial"] == 0 and e["max_abs_scaled"] == 0
    e2 = compare_arrays(a * (1 + 1e-3), a)
    assert e2["max_rel_all"] == pytest.approx(1e-3, rel=1e-9)


def test_polymorphic_mask_excludes_two_corners():
    m = polymorphic_mask((3, 4))
    assert not m[0, 0] and not m[-1, -1] and m[-1, 0] and m[0, -1] and m.sum() == 10


def test_projection_keeps_the_neutral_spectrum():
    p = project_axis(neutral(40), 0, 13)
    assert np.allclose(p[1:13] * np.arange(1, 13), 1.0, rtol=1e-12)


def test_inbreeding_transform_properties():
    a = neutral(20)
    a[0], a[-1] = 0.3, 0.1
    assert np.allclose(inbreed_axis(a, 0, 0.0), a)
    full = inbreed_axis(a, 0, 1.0)
    assert np.allclose(full[1::2], 0.0, atol=1e-15)
    assert np.allclose(full[2:20:2], project_axis(a, 0, 10)[1:10], rtol=1e-12)
    mid = inbreed_axis(a, 0, 0.4)
    assert mid.sum() == pytest.approx(a.sum(), rel=1e-13)


def test_linear_to_piecewise_keeps_the_integrated_coalescence_rate():
    g = {"time_units": "generations", "demes": [{"name": "A", "start_time": math.inf, "epochs": [
        {"end_time": 1000.0, "start_size": 1e4, "end_size": 1e4, "size_function": "constant"},
        {"end_time": 0.0, "start_size": 1e4, "end_size": 3e4, "size_function": "linear"}]}]}
    out = linear_to_piecewise(g, pieces=50)
    eps = out["demes"][0]["epochs"]
    assert len(eps) == 51 and eps[-1]["end_time"] == 0.0
    # integral of 1/N over the linear epoch: exact = T / (N1 - N0) * log(N1 / N0)
    exact = 1000.0 / (3e4 - 1e4) * math.log(3.0)
    t_prev, integral = 1000.0, 0.0
    for ep in eps[1:]:
        integral += (t_prev - ep["end_time"]) / ep["start_size"]
        t_prev = ep["end_time"]
    assert integral == pytest.approx(exact, rel=1e-12)


def test_double_precision_steady_state_matches_moments_when_h_is_exact_in_float32():
    import moments
    sys.path.insert(0, str(VAL))
    from compare_engine_vs_moments import steady_state_double
    for g, h in [(0.0, 0.5), (-10.0, 0.5), (5.0, 0.25)]:
        ref = moments.LinearSystem_1D.steady_state_1D(20, gamma=g, h=h)
        assert np.allclose(steady_state_double(20, g, h)[1:-1], ref[1:-1], rtol=1e-12)
