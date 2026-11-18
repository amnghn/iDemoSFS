"""Smoke test for ./envs/sfs-validate.

Imports every validation package, prints its version, and checks the
analytic result for the standard neutral model: E[xi_i] = theta / i.
Exit code 1 if any import fails or the SNM check is worse than 1e-10.
"""

import importlib
import sys

MODULES = [
    "numpy", "scipy", "matplotlib", "pandas", "pytest", "mpmath",
    "moments", "dadi", "msprime", "tskit", "demes", "demesdraw",
    "allel", "egglib",
]

failed = []
for name in MODULES:
    try:
        mod = importlib.import_module(name)
        version = getattr(mod, "__version__", "n/a")
        print(f"OK    {name:12s} {version}")
    except Exception as err:  # report every failure, do not stop
        print(f"FAIL  {name:12s} {type(err).__name__}: {err}")
        failed.append(name)

if "moments" not in failed:
    import numpy as np
    import moments

    n = 20
    fs = moments.Demographics1D.snm([n])           # theta = 1 by default
    i = np.arange(1, n)
    expected = 1.0 / i
    rel = np.abs(np.asarray(fs[1:n]) - expected) / expected
    print(f"SNM check n={n}: max relative error vs 1/i = {rel.max():.3e}")
    if rel.max() > 1e-10:
        failed.append("snm_check")

if failed:
    print("SMOKE TEST FAILED:", ", ".join(failed))
    sys.exit(1)
print("SMOKE TEST PASSED")
