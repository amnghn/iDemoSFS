"""Phase 0, step 0.3: timing baseline for moments 1.7.1 at n = 20 per population.

Purpose: give a measured reference for the speed section of docs/DESIGN.md.
The planned TypeScript engine ports the same algorithms, so its run time should
be of the same order (single thread).

For each model we record:
  - median and minimum wall time over REPEATS runs (ms), single thread;
  - the time-step error of moments at its default dt_fac (0.02): the maximum
    relative difference to a run with dt_fac = 0.002, over bins whose mass is
    at least 1e-3 of the total (only for models built with fs.integrate).

Output: validation/benchmarks/moments_timing_n20.tsv
"""

import sys
import time
import traceback
from pathlib import Path

import numpy as np
import moments
import demes

OUT = Path(__file__).resolve().parent / "moments_timing_n20.tsv"
REPEATS = 5
N = 20                       # haploid sample size per population
FINE_DT = 0.002              # reference time step for the dt-error column


def snm1(n=N):
    return moments.Demographics1D.snm([n])


# ---------- model builders: each takes dt_fac and returns a Spectrum ----------

def m_snm_1d(dt):
    return snm1()


def m_two_epoch_expansion(dt):
    fs = snm1()
    fs.integrate([10.0], 0.1, dt_fac=dt)
    return fs


def m_bottleneck_recovery(dt):
    fs = snm1()
    fs.integrate([0.05], 0.02, dt_fac=dt)
    fs.integrate([1.0], 0.2, dt_fac=dt)
    return fs


def m_exponential_growth(dt):
    T = 0.2
    fs = snm1()
    fs.integrate(lambda t: [0.1 * np.exp(np.log(100.0) * t / T)], T, dt_fac=dt)
    return fs


def m_linear_growth(dt):
    T = 0.3
    fs = snm1()
    fs.integrate(lambda t: [1.0 + 4.0 * t / T], T, dt_fac=dt)
    return fs


def m_selection_1d(dt):
    ss = moments.LinearSystem_1D.steady_state_1D(N, gamma=-10.0, h=0.5)
    fs = moments.Spectrum(ss)
    fs.integrate([2.0], 0.1, gamma=-10.0, h=0.5, dt_fac=dt)
    return fs


def split2(n1=N, n2=N):
    return moments.Demographics1D.snm([n1 + n2]).split(0, n1, n2)


def m_split_nomig(dt):
    fs = split2()
    fs.integrate([1.0, 0.5], 0.5, dt_fac=dt)
    return fs


def m_im_symmetric(dt):
    fs = split2()
    fs.integrate([1.0, 0.5], 0.5, m=[[0, 2.0], [2.0, 0]], dt_fac=dt)
    return fs


def m_im_exponential(dt):
    T = 0.5
    fs = split2()
    fs.integrate(lambda t: [0.5 * np.exp(np.log(4.0) * t / T), 1.0], T,
                 m=[[0, 1.0], [0.5, 0]], dt_fac=dt)
    return fs


def m_secondary_contact(dt):
    fs = split2()
    fs.integrate([1.0, 1.0], 0.4, dt_fac=dt)
    fs.integrate([1.0, 1.0], 0.1, m=[[0, 2.0], [2.0, 0]], dt_fac=dt)
    return fs


def m_im_selection_2d(dt):
    ss = moments.LinearSystem_1D.steady_state_1D(2 * N, gamma=-5.0, h=0.5)
    fs = moments.Spectrum(ss).split(0, N, N)
    fs.integrate([1.0, 0.5], 0.5, m=[[0, 1.0], [1.0, 0]],
                 gamma=-5.0, h=0.5, dt_fac=dt)
    return fs


def demes_graph(pulse):
    """Split at 1e4 generations (T = 0.5 with N_ref = 1e4); optional pulse pop2 -> pop1."""
    b = demes.Builder(time_units="generations")
    b.add_deme("anc", epochs=[dict(start_size=1e4, end_time=1e4)])
    b.add_deme("pop1", ancestors=["anc"], epochs=[dict(start_size=1e4)])
    b.add_deme("pop2", ancestors=["anc"], epochs=[dict(start_size=5e3)])
    if pulse:
        b.add_pulse(sources=["pop2"], dest="pop1", proportions=[0.2], time=2e3)
    else:
        b.add_migration(demes=["pop1", "pop2"], rate=1e-4)
    return b.resolve()


G_PULSE = demes_graph(pulse=True)
G_IM = demes_graph(pulse=False)


def m_admixture_pulse_from_demes(dt):
    return moments.Spectrum.from_demes(G_PULSE, sampled_demes=["pop1", "pop2"],
                                       sample_sizes=[N, N])


def m_im_from_demes(dt):
    return moments.Spectrum.from_demes(G_IM, sampled_demes=["pop1", "pop2"],
                                       sample_sizes=[N, N])


MODELS = [
    ("snm_1d", m_snm_1d, False),
    ("two_epoch_expansion_1d", m_two_epoch_expansion, True),
    ("bottleneck_recovery_1d", m_bottleneck_recovery, True),
    ("exponential_growth_1d", m_exponential_growth, True),
    ("linear_growth_1d", m_linear_growth, True),
    ("selection_gamma-10_1d", m_selection_1d, True),
    ("split_nomig_2d", m_split_nomig, True),
    ("im_symmetric_2d", m_im_symmetric, True),
    ("im_exponential_2d", m_im_exponential, True),
    ("secondary_contact_2d", m_secondary_contact, True),
    ("im_selection_gamma-5_2d", m_im_selection_2d, True),
    ("admixture_pulse_from_demes_2d", m_admixture_pulse_from_demes, False),
    ("im_from_demes_2d", m_im_from_demes, False),
]


def dt_error(builder):
    a = np.asarray(builder(0.02).filled(0.0))
    b = np.asarray(builder(FINE_DT).filled(0.0))
    keep = b >= 1e-3 * b.sum()
    return float(np.max(np.abs(a[keep] - b[keep]) / b[keep]))


def main():
    print("moments", moments.__version__, "numpy", np.__version__, "python", sys.version.split()[0])
    rows = ["model\tshape\tms_median\tms_min\trepeats\tmax_rel_dt_error_0.02_vs_0.002\tstatus"]
    for name, builder, has_dt in MODELS:
        try:
            fs = builder(0.02)                       # warm-up (imports, caches)
            times = []
            for _ in range(REPEATS):
                t0 = time.perf_counter()
                builder(0.02)
                times.append((time.perf_counter() - t0) * 1e3)
            err = f"{dt_error(builder):.3e}" if has_dt else "NA"
            shape = "x".join(str(s) for s in fs.shape)
            row = f"{name}\t{shape}\t{np.median(times):.2f}\t{np.min(times):.2f}\t{REPEATS}\t{err}\tOK"
        except Exception as e:
            traceback.print_exc()
            row = f"{name}\tNA\tNA\tNA\t0\tNA\tFAIL:{type(e).__name__}"
        print(row, flush=True)
        rows.append(row)
    OUT.write_text("\n".join(rows) + "\n")
    print("written", OUT)


if __name__ == "__main__":
    main()
