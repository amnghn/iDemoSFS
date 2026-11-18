# Design note: interactive web app "Demographic history and the expected SFS"

*Phase 0 design note for STOP 1. Written 2026-11-18. Status: **approved 2026-11-18** (all proposals accepted; see Section 11).*
*Prompt: `docs/PROMPT.md`. Change log: `CHANGELOG.md`.*

Citations use the keys in `docs/REFERENCES.bib`, for example [@jouganous2017inferring]. Section 12 gives the full list.

---

## 0. Summary

- **Engine: option A, a pure TypeScript engine.** It ports the moment equations and event operations of moments 1.7.1 [@jouganous2017inferring] to TypeScript, and runs them in a Web Worker in the browser. Neither moments nor dadi is available in Pyodide (Section 3.1), so the site can only stay static and free if the engine is written in TypeScript.
- **The port copies moments exactly.** It uses the same integrator choice, Crank–Nicolson steps, time-step rule, jackknife closure, split and exact admixture. The aim is agreement with moments to about 1e-8, far inside the < 1 % target of the prompt. Selection and dominance use the same moment equations. Option C (precomputed grids) is kept only as a fallback.
- **Inbreeding** is an exact post-processing step of the sample SFS that reproduces the genotype model of Blischak et al. [@blischak2020inferring]. It is checked against dadi's `from_phi_inbreeding`.
- **Measured speed of moments** (n = 20, one core of an older Xeon): 2–8 ms for 1D models, 38–128 ms for most 2D models, 304 ms for isolation with migration (IM) plus exponential growth. A TypeScript port should be of the same order. For live sliders, the app uses a coarse "draft" time step while a slider moves and the full accuracy when it stops (Section 5).
- **Statistics:** every statistic is a weight vector (1D) or weight matrix (2D) applied to the SFS (Section 6). Both F_ST estimators (Hudson; Weir and Cockerham) are computed from the joint SFS. One point needs your decision: the expected heterozygosity under Hardy–Weinberg proportions, given the allele counts in a sample (Section 6.4).
- **Front end:** Vite + plain TypeScript with a small state store, D3 modules for all plots and the history diagram, and KaTeX + markdown-it rendered at build time.
- **References:** 67 of 67 verified (Section 12). Nielsen & Slatkin (2013) was first removed because no open record shows its 2013 imprint; Amin confirmed the edition at STOP 1, so it is restored and labelled as author-confirmed. The moments documentation URL has changed.

---

## 1. Scope and constraints

- **Purpose:** a free, static teaching site (GitHub Pages; no server, no login). It shows how demographic history shapes the expected SFS: constant size, expansion, bottleneck or contraction, and structure with migration and admixture. Advanced options add selection, dominance and inbreeding.
- **Role of LiSC:** it is used only for building, testing and validation (Python reference tools, msprime runs through SLURM).
- **Privacy:** files that users upload in calculator mode are read in the browser only. Nothing is sent to a server. The site has no analytics and no cookies.

---

## 2. LiSC environment (checked 2026-11-18)

| Item | Result |
|---|---|
| Node.js | Lmod module `nodejs/22.17.1-GCCcore-14.3.0` (default); no conda Node needed |
| Conda | Lmod module `Conda/Miniforge3`; `~/.condarc` puts the package cache on scratch |
| LiSC rule | A Conda environment is never mixed with other Lmod modules. Node steps and Python steps run in separate shells or jobs |
| Internet (login and compute nodes) | PyPI, registry.npmjs.org, conda-forge, api.crossref.org and doi.org all reachable |
| Validation environment | `./envs/sfs-validate`, created by SLURM job 8080694 (3 min). Python 3.12.16; moments-popgen 1.7.1 (PyPI wheel), dadi 2.4.3, msprime 1.4.5, tskit 1.0.4, demes 0.2.3, demesdraw 0.4.1, scikit-allel 1.3.13, egglib 3.6.1, numpy 2.5.5, scipy 1.18.1, matplotlib 3.11.2, pandas 3.1.1, pytest 9.2.0. The lock file is `envs/sfs-validate.lock.txt` |
| Smoke test | All imports OK. The standard neutral model (n = 20) gives E[ξᵢ] = θ/i with a maximum relative error of 1.9e-16 |
| Environment size | 9.7 GB. conda-forge `scikit-allel` pulls `pomegranate`, which pulls PyTorch (CPU); `matplotlib` pulls Qt6. The environment works. A leaner rebuild is possible (Section 11) |

---

## 3. Engine options

| Option | Description | Pros | Cons |
|---|---|---|---|
| **A. TypeScript engine (recommended)** | Port the moment equations of moments [@jouganous2017inferring] (drift, mutation, migration, selection, size change, split, admixture) to TypeScript and run them in a Web Worker | Free static site; no server; fast start-up; works offline; the code is open to inspect; the same numbers as moments are possible because the algorithm is deterministic | Port effort (about 1,500–2,500 lines); the jackknife closure and the Crank–Nicolson details must be copied exactly; double precision only |
| B. Python in the browser (Pyodide) | Run moments or dadi with Pyodide | The reference code is used directly | **Not available:** Pyodide 314.0.8 has numpy, scipy, msprime, tskit and demes, but not moments or dadi. Both have compiled extensions (moments: `Jackknife.pyx`, `LinearSystem_1D/2D.pyx`, `Tridiag_solve.pyx`; dadi: C code). A custom Emscripten build would be needed, and kept working with each release. The download is large (tens of MB for numpy and scipy) and start-up is slow |
| C. Precomputed grids | Compute spectra on LiSC over a parameter grid and interpolate in the browser | Exact moments output at the grid points | Curse of dimensionality: with 2–3 epochs, 2 populations, migration and admixture, a useful grid is far too large. Interpolation errors in ratio plots; large downloads. Only feasible for a few advanced parameters |
| D. Python server (Shiny for Python, Panel) | Run moments on a server | Simple to build | Needs paid or institutional hosting, so it is not "free and open" and not static. A fallback only |

### 3.1 Honest check of option B
The Pyodide package list (`pyodide-lock.json` of release 314.0.8) contains `msprime`, `tskit`, `demes`, `numpy` and `scipy`, but not `moments` or `dadi`. Running them would need a home-made Emscripten build of their Cython and C extensions. That is possible in principle, but it is fragile, slow to load, and a burden to maintain.

### 3.2 Recommendation
Use **option A** for all features, including selection, dominance and inbreeding.
- In moments, selection and dominance are extra sparse matrices in the same moment equations. They use the same jackknife closure as migration, so porting them costs little once migration works.
- Inbreeding is handled exactly, without a grid (Section 4.7).
- **Option C** stays as a fallback for strong selection only, in case Phase 1 shows that the TypeScript port and moments disagree for large |γ|.
- **Option D** is not used.

---

## 4. Numerical method of the engine

### 4.1 Units and parameters (dadi/moments convention)
| Symbol | Meaning |
|---|---|
| ν = N/N_ref | Relative size. N_ref is the size of the ancestral population in the first epoch |
| T | Duration, in units of 2·N_ref generations |
| θ = 4·N_ref·μ·L | Population-scaled mutation rate (whole dataset); θ per site = 4·N_ref·μ |
| M_ij = 2·N_ref·m_ij | Scaled migration rate into population i from population j (forward in time). The diagram labels each arrow with its direction |
| γ = 2·N_ref·s, h | Genotype fitnesses 1, 1 + 2hs, 1 + 2s (the dadi/moments convention; confirmed in Phase 1: moments converges to the exact equilibrium of the diffusion with this convention, see VALIDATION.md) |
| F | Inbreeding coefficient of a population |
| ε | Rate of ancestral misidentification |

**Size-change dynamics** (GADMA convention [@noskova2020gadma; @noskova2023gadma2]): ν is the size at the **end** of an epoch. For an epoch that starts at size ν₀ and ends at ν₁ after time T:
- **Sudden:** ν(t) = ν₁ for 0 < t ≤ T.
- **Linear:** ν(t) = ν₀ + (ν₁ − ν₀)·t/T.
- **Exponential:** ν(t) = ν₀·(ν₁/ν₀)^(t/T).

The start size of a daughter population comes from a split fraction s (pop 1 gets s·ν_anc, pop 2 gets (1 − s)·ν_anc) or from an explicit start size. When a dynamics type is switched off globally, it disappears from all epoch menus.

**Structure notation.** "Structure (k)" means k ancestral epochs (one population). "Structure (k, l)" means k ancestral epochs and l epochs after the split.

**Proposal: shared epochs after the split, as in GADMA.** The epochs after the split are time intervals shared by both daughter populations. Each population has its own size and dynamics in each interval, and migration rates are set per interval. A population "skips" an interval by keeping its size (Sudden, with the same ν).

The prompt asks for epochs "per population". Fully separate epoch boundaries for each population would make migration masks per epoch ambiguous. **This is a decision for STOP 1** (Section 11).

### 4.2 From the model to a list of events
The control state is compiled into a list of events, ordered from past to present:
1. ancestral epochs;
2. the split;
3. the epochs after the split;
4. an optional admixture pulse at time t_p, which splits the interval that contains it;
5. sampling.

Migration masks switch individual rates off per interval and direction. This gives, for example, "secondary contact only" or "ancient migration only".

### 4.3 Lineage bookkeeping
An admixture pulse needs extra lineages in the source population. The engine works out the sample sizes backwards in time, in the same way as moments' Demes interface:
- At a pulse from S into D, S carries n_S + n_D lineages before the pulse, and D carries n_D.
- At the split, the ancestral population carries the total.
- Example: with n₁ = n₂ = 20 and a pulse, the ancestral population carries 60 lineages, and the 2D array before the pulse is 41 × 21.

### 4.4 Initial state
The process starts at equilibrium. For the neutral case this is E[ξᵢ] = θ/i (exact). With selection, the engine solves the steady state of the 1D system, as `moments.LinearSystem_1D.steady_state_1D` does.

### 4.5 Time integration: a port of moments 1.7.1
The source code of moments 1.7.1 was read for this note (`Integration.py`, `Integration_nomig.py`, `Spectrum_mod.integrate`, `Numerics.compute_N_effective`). The TypeScript engine copies it as follows.

- **Integrator choice (copied exactly):**
  - 1D, and 2D with migration switched off: per-axis Crank–Nicolson (CN) steps (`integrate_neutral`, with tridiagonal solves; `integrate_nomig` when γ ≠ 0).
  - 2D with migration switched on (even when a rate is 0): the full 2D CN step (`integrate_nD`). moments uses different integrators for these two cases, and their discretisation errors differ slightly (O(dt²)). The app follows the toggle in the same way, so its numbers agree with moments.
- **Time step:**
  - moments integrates internally in units of N generations (Tmax = 2T).
  - dt = min(compute_dt(ν, M, γ, h), dt_fac·Tmax), where compute_dt = min over populations of 0.1 / max(0.25/ν, max M, |s|·f(h)). The default is dt_fac = 0.02.
  - With time-varying size, ν is evaluated at the end of the step. The effective size of the step is the harmonic mean of ν over the step (trapezoid rule, 10 points).
  - dt is halved (at most 10 times) while ν changes by more than 50 % from the previous step.
- **Linear algebra:**
  - CN solves (I − dt/2·A)·Φ_new = (I + dt/2·A)·Φ_old + dt·B, where A = drift/ν + selection + migration and B injects new mutations into the singleton bins.
  - The matrices are rebuilt and factorised **only when** ν, M, γ, h or dt change.
  - moments uses a sparse LU (SuperLU) for the 2D system. The port uses a **banded LU**. With row-major ordering, the 2D system at 20 × 20 has 441 unknowns, with a bandwidth of about 2·21 + 2.
- **Closure:** migration and selection need moments of order n + 1, and dominance needs order n + 2. moments estimates these with jackknife extrapolation (`calcJK13`, `calcJK23` in `Jackknife.pyx`). The port copies these matrices. Phase 1 checks them entry by entry against moments.

### 4.6 Event operations
- **Split:** hypergeometric split of the ancestral 1D spectrum into a 2D spectrum (`Manips.split_1D_to_2D`; exact).
- **Admixture pulse:** the exact sequential-draw method `admix_into_new`, which moments' Demes interface uses for pulses (`_pulse_migrate_into_new`). The older `pulse_migrate`/`admix_inplace` is approximate (it uses non-negative least squares), so the port does **not** use it.
- **Projection** (hypergeometric down-sampling), **marginalisation**, and **pooling** of two demes into one sample (`merge_2D_to_1D`, for the preset "structured population sampled as one").

### 4.7 Post-processing of the sample SFS
- **Inbreeding (diploid):**
  - Blischak et al. [@blischak2020inferring] use a beta-binomial genotype model with α = x(1 − F)/F. dadi implements it as `Spectrum.from_phi_inbreeding`. For diploids this model is the same as: "each individual is autozygous with probability F (two copies of one draw); otherwise it carries two independent draws".
  - Given k individuals, a autozygous individuals means 2k − a distinct draws. The inbred spectrum is therefore an exact mixture of the outbred spectra projected to sample sizes 2k − a (a = 0, …, k), with binomial weights and a hypergeometric split of each projected sample.
  - The calculation needs no grid, and it changes only the sampling step, as in dadi. In 2D it is applied to each population independently.
- **Ancestral misidentification:** Φ′ = (1 − ε)·Φ + ε·reverse(Φ), as in `moments.Misc.flip_ancestral_misid`.
- **Folding:** the dadi/moments convention. Fold on the global minor allele: entries with i + j > (n₁ + n₂)/2 are added to their mirror entry and masked, and entries on the line i + j = (n₁ + n₂)/2 are handled as in moments' `fold()`. The port is checked against `moments.Spectrum.fold` in 1D and 2D.
- **Scaling:** counts = θ × the spectrum for θ = 1. Proportions are the spectrum divided by its sum over the polymorphic bins.

### 4.8 Selection and dominance: limits
The jackknife closure loses accuracy for strong selection at small n. Proposal:
- γ ∈ [−50, 50] and h ∈ [0, 1];
- when |γ| > 10, integrate at an internal sample size n_int = max(n, 40) and project down to n.

Phase 1 measures the error against moments at a large n and adjusts these limits.

**Updated in Phase 1 (2026-11-18; details in VALIDATION.md).**
- **Selection.** Measured against the exact equilibrium of the diffusion, the proposal above was too weak. The engine now integrates selection at n_int = max(n, 100) in one population and max(n, 40) per population in two, and then projects. With this, the error in the main bins is below 0.5 % in 1D for γ from −50 to +30 at any h. In 2D it is about 1 % at |γ| = 10 and 2–3 % at |γ| = 20.
- **Migration.** The msprime check showed a closure error of 1.4–2.9 % with migration and a sample of 10 chromosomes. With migration on, each population is therefore integrated at max(n, 20) chromosomes.
- **Open decision for STOP 2:** the γ limit in two populations.

### 4.9 Independent checks inside the test suite
- **Neutral 1D with piecewise-constant or exponential size:** the expected SFS from coalescent branch lengths [@polanski2003new; @fu1995statistical; @griffiths1998age], computed in TypeScript as an independent oracle (n ≤ 40, where the formulas are numerically stable).
- **Constant size:** E[ξᵢ] = θ/i [@watterson1975number; @fu1995statistical].

### 4.10 Known approximations (to be stated in the app)
- **Diffusion approximation.** It differs from the Wright–Fisher coalescent by O(1/N).
- **Closure error.** Migration and selection need the jackknife closure.
- **Time discretisation.** moments' own error at dt_fac = 0.02 was at most 2.8e-4 (relative) in the benchmark (Section 5.1).
- **Expected spectra only.** The spectra ignore linkage and sampling variance.

---

## 5. Speed

### 5.1 Measured baseline: moments 1.7.1
One core of an Intel Xeon Silver 4114 (2.2 GHz), SLURM job 8080695, n = 20 per population, median of 5 runs. File: `validation/benchmarks/moments_timing_n20.tsv`. The last column is the maximum relative difference between dt_fac = 0.02 and dt_fac = 0.002, over bins with ≥ 0.1 % of the mass.

| Model | Shape | Median time (ms) | dt error (0.02 vs 0.002) |
|---|---|---:|---:|
| Standard neutral model | 21 | 1.8 | – |
| Sudden expansion (ν = 10, T = 0.1) | 21 | 3.1 | 1.7e-6 |
| Bottleneck (ν = 0.05, T = 0.02) and recovery (T = 0.2) | 21 | 4.4 | 2.8e-5 |
| Exponential growth (0.1 → 10, T = 0.2) | 21 | 8.1 | 2.8e-4 |
| Linear growth (1 → 5, T = 0.3) | 21 | 7.3 | 3.1e-5 |
| Selection γ = −10, h = 0.5 | 21 | 6.5 | 6.1e-5 |
| Split, no migration (T = 0.5) | 21 × 21 | 38.5 | 2.0e-4 |
| Isolation with migration (IM), symmetric M = 2 | 21 × 21 | 59.1 | 4.3e-5 |
| IM + exponential growth | 21 × 21 | 304.2 | 1.4e-4 |
| Secondary contact | 21 × 21 | 87.6 | 9.3e-5 |
| IM + selection γ = −5 | 21 × 21 | 60.8 | 5.6e-5 |
| Admixture pulse (from Demes) | 21 × 21 | 127.7 | – |
| IM (from Demes) | 21 × 21 | 59.0 | – |

### 5.2 Expected speed of the TypeScript engine
Much of the moments time is Python overhead: rebuilding scipy sparse matrices and calling the factorisation at each step. The TypeScript engine uses typed arrays and fixed band structures. Estimates for a recent laptop:
- **1D (n = 20):** < 1 ms per model.
- **2D without migration (21 × 21):** per-axis tridiagonal solves, about 1–5 ms.
- **2D with migration, constant size within epochs:** one banded LU per epoch (about 0.9 million multiply-adds, roughly 1–3 ms) plus cheap solves at each step, so about 5–20 ms in total.
- **2D with migration and continuous size change:** a refactorisation at every step (50–200 steps), so about 50–300 ms. This is the worst case.
- **Admixture pulse:** about 2–4 times the cost before the pulse, because of the extra lineages (41 × 21).

Phase 1 replaces these estimates with measured numbers (Node.js on LiSC and a laptop browser).

### 5.3 Keeping the app responsive
- The engine runs in a Web Worker. Each request has an id; the latest request wins and stale results are dropped.
- Slider input is debounced (about 100 ms). While a slider is dragged, the engine runs in **draft mode** (dt_fac = 0.1); when the slider is released, it runs at full accuracy (dt_fac = 0.02).
- The old plot stays visible. A small spinner appears only if a result takes longer than 200 ms.
- Results are kept in an LRU cache, keyed by the canonical model JSON.
- Parameter sweeps (15–25 points) fill in point by point and are cancelled when the model changes.
- Proposed limits: n ≤ 100 in 1D, n ≤ 40 per population in 2D (default 20), ν ∈ [0.01, 100] on a log slider.

---

## 6. Statistics module (prompt Section 3A)

### 6.1 One framework: weights
- Every statistic in Sections 6.2–6.3 is Σ w·ξ (a weight vector in 1D, a weight matrix in 2D), or a ratio of two such sums.
- One function computes all of them, and the same weights drive the "estimator weights" teaching plot [@achaz2009frequency].
- Notation: n chromosomes; ξᵢ (i = 1…n − 1) is the unfolded SFS; ηᵢ is the folded SFS; aₙ = Σ_{k<n} 1/k; bₙ = Σ_{k<n} 1/k².
- Per-site values are the per-dataset values divided by L.

### 6.2 One population
| Statistic | Weight wᵢ (unfolded) | Folded? | Source |
|---|---|---|---|
| S | 1 | yes | |
| θ_W | 1/aₙ | yes | [@watterson1975number] |
| θ_π | i(n − i)/C(n,2) | yes | [@tajima1983evolutionary] |
| θ_H | i²/C(n,2) | no | [@fay2000hitchhiking] |
| θ_L | i/(n − 1) | no | [@zeng2006statistical] |
| θ_ξ₁ (derived singletons) | 1 if i = 1 | no | [@fu1993statistical] |
| θ_η (folded singletons) | (n − 1)/n · [i = 1 or i = n − 1] | yes | [@fu1993statistical] |

**Neutrality tests**
- **Tajima's D:** (θ_π − θ_W)/√(e₁S + e₂S(S − 1)) [@tajima1989statistical].
- **Fu and Li's D and F** (unfolded, using ξ₁) and **D\* and F\*** (folded, using η₁) [@fu1993statistical]. The variances of F and F\* follow the corrected formulas of Simonsen et al. [@simonsen1995properties].
- **Fay and Wu's H:**
  - the raw value is θ_π − θ_H [@fay2000hitchhiking];
  - the normalised H of Zeng et al. [@zeng2006statistical] is (θ_π − θ_L)/√Var. Note that θ_π − θ_H = 2(θ_π − θ_L).
  - The app shows both and names them clearly.
- **Zeng's E:** (θ_L − θ_W)/√Var [@zeng2006statistical].

**How the tests are computed and checked**
- The variances use θ̂ = θ_W and θ̂² = S(S − 1)/(aₙ² + bₙ).
- In model mode, a test is a **ratio of expectations**: the expected SFS is put into the formula. This is not the expected value of the test over loci, and the app says so.
- Every formula is unit-tested against egglib [@siol2022egglib] and, for D, against scikit-allel and tskit.

### 6.3 Two populations (joint SFS ξᵢⱼ; p₁ = i/n₁, p₂ = j/n₂)
| Statistic | Weight matrix | Folded? |
|---|---|---|
| π₁, π₂ | i(n₁ − i)/C(n₁,2); j(n₂ − j)/C(n₂,2) | yes |
| d_xy | p₁(1 − p₂) + p₂(1 − p₁) [@nei1979mathematical; @nei1987molecular] | yes |
| d_a | d_xy − (π₁ + π₂)/2 [@nei1979mathematical] | yes |
| Hudson's F_ST | Σ N·ξ / Σ D·ξ, with N = (p₁ − p₂)² − p₁(1 − p₁)/(n₁ − 1) − p₂(1 − p₂)/(n₂ − 1) and D = d_xy. This equals 1 − [(π₁ + π₂)/2]/d_xy as a ratio of averages [@hudson1992estimation; @bhatia2013estimating] | yes |
| WC θ (F_ST), F_IS, F_IT | Σa·ξ / Σ(a + b + c)·ξ, etc. (Section 6.4) [@weir1984estimating] | yes |
| f₂ | Σ N·ξ / L [@peter2016admixture] | yes |
| Fixed differences | ξ(n₁, 0) + ξ(0, n₂) | total only |
| Shared polymorphisms | Σ over 0 < i < n₁, 0 < j < n₂ | yes |
| Private polymorphisms in pop 1 / pop 2 | 0 < i < n₁ with j ∈ {0, n₂}, and the reverse [@wakeley1997estimating] | yes |

**Checks on these weights**
- **Folding:** all weights except the fixed-difference direction are symmetric under (i, j) → (n₁ − i, n₂ − j). A unit test checks that Σ w·fold(ξ) = Σ w·ξ.
- **tskit's F_ST has a different definition.** tskit defines `Fst` = 1 − 2(d₁ + d₂)/(d₁ + 2d₁₂ + d₂). This was checked in the tskit 1.0.4 source, which cites Hudson et al. [@hudson1992estimation] and Slatkin [@slatkin1991inbreeding]. It is not the Hudson/Bhatia ratio above.
- **Validation compares like with like:** the tskit formula is rebuilt from the SFS-based π₁, π₂ and d_xy and compared with `ts.Fst`; the Hudson/Bhatia value is compared with `allel.hudson_fst`.

### 6.4 Weir and Cockerham's θ from the SFS, and the heterozygosity term
For each cell of the joint SFS (r = 2):
- kᵢ = nᵢ/2 individuals; k̄ = (k₁ + k₂)/2; k_c = 2k̄ − (k₁² + k₂²)/(2k̄);
- p̄ = (k₁p₁ + k₂p₂)/(2k̄); s² = [k₁(p₁ − p̄)² + k₂(p₂ − p̄)²]/k̄; h̄ = (k₁h₁ + k₂h₂)/(2k̄);
- a = (k̄/k_c)·[s² − (p̄(1 − p̄) − s²/2 − h̄/4)/(k̄ − 1)];
- b = (k̄/(k̄ − 1))·[p̄(1 − p̄) − s²/2 − h̄(2k̄ − 1)/(4k̄)];
- c = h̄/2.

From these sums:
- θ_WC = Σa·ξ / Σ(a + b + c)·ξ;
- F_IS = 1 − Σc·ξ / Σ(b + c)·ξ;
- F_IT = 1 − Σc·ξ / Σ(a + b + c)·ξ.

The sums are always taken over sites before dividing (ratio of averages) [@bhatia2013estimating].

**Options for hᵢ** (the option in use is shown next to every WC value):
1. **HWE on (default).** Proposed: hᵢ = 2pᵢ(1 − pᵢ)·2kᵢ/(2kᵢ − 1). See the flagged point below.
2. **HWE off, F_IS given.** hᵢ = (1 − F_IS,ᵢ) times the value above. In model mode F comes from the inbreeding toggle. In calculator mode the user types F_IS or H_obs, with F_IS = 1 − H_obs/H_exp. This assumes the same F_IS at every site, so it is an approximation; Phase 1 reports its error.
3. **HWE off, exact (calculator mode only).** The user supplies per-site genotype counts (hom-ref, het, hom-alt per population), for example from `bcftools +fill-tags` [@danecek2021twelve] or `vcftools --hardy` [@danecek2011variant], or a VCF of at most 50 MB parsed in a Web Worker. This option no longer uses the SFS alone, and the app says so.
4. **Haploid or pooled data.** WC without the h̄ term: c = 0, and the sample sizes are the numbers of gene copies. *Resolved in Phase 2:* this equals the one-level analysis of variance (MSP − MSG)/(MSP + (n_c − 1)·MSG). It was checked against egglib's `FstWC` ("Weir and Cockerham for haploid data") to 1e-12 (VALIDATION.md, Section 11.3). Weir & Hill [@weir2002estimating] is cited only as a general review.

**⚑ Flagged point (needs your decision).**
- The prompt gives h̄ = 2p(1 − p) under HWE.
- Under HWE, the alleles of a sample are paired into individuals at random. Given an allele count c out of 2k, the **expected** proportion of heterozygotes is 2p(1 − p)·2k/(2k − 1), with p = c/2k.
- a, b and c are linear in h̄, so using this conditional expectation gives exactly the expected numerator and denominator of WC over random pairings.
- With plain 2p(1 − p) there is a small bias, about 1/(2k) (2.5 % for k = 20).
- I propose the corrected form. Phase 1 will show both against scikit-allel on HWE genotypes simulated with msprime.

**Model mode.** Switching on inbreeding changes two separate things:
- (a) the expected SFS itself (Section 4.7) [@blischak2020inferring];
- (b) how WC uses heterozygosity.

The text explains both. Hudson's F_ST uses allele frequencies only, so the HWE toggle does not change it. A deficit of heterozygotes can come from inbreeding or selfing, from hidden structure inside a sample (Wahlund effect [@wahlund1928zusammensetzung]), or from genotyping errors. The SFS alone cannot test HWE.

### 6.5 Model mode and calculator mode
- **Model mode:** the expected SFS × θ (θ per site × L). The app reports per-dataset and per-site values. For large θL, Tajima's D approaches a limit that depends only on the shape of the SFS; the text explains this.
- **Calculator mode:** the user gives the sample sizes and L, including monomorphic sites. Without L, only per-dataset values are shown, with a warning. When the file includes the monomorphic corner bins, L is the sum of all bins.

### 6.6 File formats
- **dadi/moments `.fs`** (also the easySFS output):
  - lines starting with `#` are comments;
  - a header with the dimensions, `folded` or `unfolded`, and optional population names;
  - the data, row-major;
  - an optional mask line.
- **ANGSD realSFS** [@korneliussen2014angsd]:
  - one line per spectrum. Several lines (bootstrap replicates or windows): the app uses the first line by default and offers the mean;
  - 1D has n + 1 values; 2D has (n₁ + 1)(n₂ + 1) values, row-major with population 1 as rows (as in `moments.Spectrum.from_angsd`);
  - the user gives n₁ and n₂;
  - when the reference was used as the ancestral sequence (`-anc ref`), the app recommends folding.
- **Plain matrix** (comma, tab or space separated): 1D is one row; 2D has n₁ + 1 rows and n₂ + 1 columns.
- **Local test only:** your own `cal_spn.2dsfs` (ANGSD, 21 × 23) is used to test the 2D parser and the L handling. It goes into `private_test_data/`, which is gitignored, and is never committed.

### 6.7 Residuals
- The model is first scaled optimally to the data (`optimally_scaled_sfs`).
- The app then shows the Poisson residuals (`linear_Poisson_residual`) and the Anscombe residuals (`Anscombe_Poisson_residual`). These are ports of the functions of the same name in `dadi.Inference` and `moments.Inference` (checked to exist in both).
- No p-values are shown: the expected values ignore linkage and sampling variance.

---

## 7. Front end

### 7.1 Stack
| Part | Choice | Why |
|---|---|---|
| Build | Vite + TypeScript (strict) | Fast; static output in `app/dist/`; the `base` path is set for GitHub Pages |
| UI | **Plain TypeScript** with a small typed state store (state → render functions); controls are generated from a parameter schema | No framework to learn or update; the bundle stays small; the code is easy to review (relevant for the AI declaration). Svelte would shorten the control code, but it adds a compiler and its own concepts |
| Plots and diagram | **D3 v7 modules** (selection, scale, axis, shape, array, format, scale-chromatic) | The tube diagram must be custom SVG anyway. D3 gives full control and a small bundle (Plotly.js is several MB), and exporting SVG and PNG is simple. Hover and zoom are added where useful |
| Maths | KaTeX + markdown-it, rendered **at build time** | No maths rendering cost at run time; the teaching text stays in Markdown |
| Engine | Web Worker (module worker) | The page never freezes |
| Tests | Vitest (engine, statistics, parsers); pytest (Python validation) | As required |
| Colours | Okabe–Ito for categories; viridis/cividis for heatmaps (log scale) | Colourblind-safe; contrast checked against WCAG AA |

### 7.2 Wireframe (laptop; on a tablet the control column becomes a drawer)
```
┌────────────────────────────────────────────────────────────────────────────────┐
│ Demographic history and the expected SFS [Beta]   Model | Statistics | Learn | About │
├─────────────────────┬──────────────────────────────┬───────────────────────────┤
│ CONTROLS            │ HISTORY DIAGRAM              │ SFS                       │
│ Mode: (•)1 pop ( )2 │  time                        │  [1D bars | 2D heatmap]   │
│ Preset: [IM      ▾] │   ▲      ┌────┐              │  ▓▓                       │
│ Structure: (2, 1)   │   │      │anc │ ν, dyn.      │  ▓▓ ▓                     │
│ ─ Ancestral ─────── │   │   ┌──┘    └──┐           │  ▓▓ ▓ ▓ ▁ ▁ ▁             │
│  ep.1 ν[──●─] T[─●] │   │   │ p1 ⇄ p2  │ M12, M21  │  ··· neutral  ░ ghost     │
│  ep.2 ν[─●──] T[●─] │   │   │    ↘ f   │ pulse     │  ratio to neutral ─────   │
│ ─ After split ───── │   0   └──┘  └────┘           ├───────────────────────────┤
│  p1 ν… p2 ν… T…     │  [years | 2N gen.]           │ STATISTICS (compact)      │
│ ☐ Migration ☐ Sym.  │                              │ S θW θπ D H E | FST dxy da│
│ ☐ Masks ☐ Admixture │                              ├───────────────────────────┤
│ ▸ Advanced (γ,h,F,ε)│                              │ WHAT CHANGED?             │
│ ▸ Sampling/display  │                              │ "Excess of rare variants…"│
│ [Pin] [Share] [⇩]   │                              │                           │
├─────────────────────┴──────────────────────────────┴───────────────────────────┤
│ v0.1.0-beta · Beta: provided "as is"; check important results with established tools. Details │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 7.3 History diagram
- **Style:** tubes in the style of demesdraw [@gower2022demes]. Width = size (log or linear), the vertical axis = time, and linear or exponential flanks for the dynamics.
- **Gene flow:** arrows for migration, with direction and rate shown; masked intervals are drawn dashed. A separate arrow shows an admixture pulse.
- **Time axis:** in 2·N_ref generations or, with the physical-units panel, in years.

### 7.4 Plots
- **1D SFS:** bars with an optional neutral overlay, a ratio panel, a "ghost" for a pinned spectrum, and linear or log scales.
- **2D SFS:** a heatmap with a log colour scale and the two marginal spectra on the sides.
- **Folded 2D SFS:** the masked half is drawn hatched.

### 7.5 State, URL and exports
- **State:** one typed model object.
- **URL:** `?v=1&s=<base64url(JSON)>`. It is versioned so that old links keep working.
- **Exports:**
  - CSV;
  - dadi/moments `.fs` (header, data, mask);
  - PNG and SVG of the current figure;
  - **Demes YAML** [@gower2022demes]. Absolute values come from N_ref and the generation time. Linear and exponential size functions, migrations with start and end times, and pulses are written in Demes form. Selection, inbreeding and ε go under `metadata`.
- The Phase 1 validation uses this same YAML export (Section 8), so the export is tested too.

### 7.6 Accessibility
- **Controls:** native range inputs paired with number inputs. Everything is keyboard-operable, with visible focus and ARIA labels.
- **Data tables:** each plot has an alternative data table.
- **Motion:** `prefers-reduced-motion` is respected.
- **Contrast:** colour contrast meets WCAG AA in light and dark themes.

### 7.7 Content pipeline
- The teaching text lives in `app/src/content/*.md`, written in plain British English.
- Citations are written as `[@` + citation key + `]` and resolved at build time against `REFERENCES.bib`: inline (author, year) with a DOI link, plus a reference list.
- The version and the date of the last change are read at build time from `package.json` and `CHANGELOG.md`.

---

### 7.8 Updated in Phase 2 (2026-11-18)
- **Built as designed:** plain TypeScript, D3 7.9.2, KaTeX and markdown-it at build time, a Web Worker, and a URL state `?v=1&s=…`.
- **Additions:**
  - `?preset=<id>` opens a preset (for teaching links);
  - `bench.html` times the engine in the visitor's browser;
  - a headless Firefox check of the built site (`app/scripts/browser_check.mjs`);
  - a "Related tools" list on the About page (links checked by `tools/check_related_tools.py`).
- **Selection limits** of STOP 2: |γ| ≤ 20 in two populations (warning above 10) and ≤ 50 in one (warning for γ > 30 with h > 0.5). They are set in `app/src/engine/limits.ts`, shared by the sliders and the model check.
- **Weir & Cockerham in calculator mode:** the five options are HWE, F_IS, H_obs (converted with F_IS = 1 − H_obs/H_exp), exact and haploid. The exact option takes a VCF (at most 50 MB, .vcf or .vcf.gz, read in the worker) with a population map, a 6-column genotype table, or two `vcftools --hardy` files.

## 8. Validation plan (Phase 1)

### 8.1 Test models (`validation/models.csv`, 34 rows; one SLURM array task per row; row index = `SLURM_ARRAY_TASK_ID + 2`)
| # | Group | Models |
|---|---|---|
| 1–13 | 1D demography | Standard neutral model; recent and ancient sudden expansion; recent and ancient exponential expansion; linear expansion; three bottleneck-and-recovery models (severity × timing); recent contraction (sudden, exponential, linear); three-epoch mixed dynamics |
| 14–19 | 1D advanced | γ = −10 and +5 (h = 0.5); γ = −10 with h = 0.1 and h = 0.9; misidentification ε = 0.02; inbreeding F = 0.5 |
| 20–32 | 2D demography | Split without gene flow (recent, old); IM symmetric; IM asymmetric; IM + exponential; IM + linear; secondary contact (mask); ancient migration (mask); admixture pulse in both directions; structured population sampled as one (one deme, pooled demes); structure (3, 2) with mixed dynamics |
| 33–34 | 2D advanced | Selection in both populations with migration; inbreeding F₁ = 0.3 (dadi) |

### 8.2 Engine against reference engines
- **Operators first:** the drift, migration, selection and jackknife matrices are compared entry by entry with moments' own (JSON fixtures written by Python, read by Vitest). This finds porting errors early.
- **Whole models:**
  - **Same model in both engines:** a Node CLI (`app/scripts/engine_cli.ts`) writes the TypeScript spectra **and** the Demes YAML of every model. Python computes `moments.Spectrum.from_demes` from the same YAML (with γ and h where needed) and compares.
  - **Targets:** a maximum relative error per bin below 1e-6 (the same algorithm), at most the 1 % of the prompt, for bins with non-trivial mass.
  - **Inbreeding:** compared with dadi `from_phi_inbreeding`, extrapolated over three grid sizes; target < 1 %.
- **Analytic check:** the standard neutral model gives θ/i to machine precision.

### 8.3 Simulation check (msprime)
- **Model and samples:** each preset is loaded through `msprime.Demography.from_demes` [@baumdicker2022efficient; @kelleher2016efficient], with N_ref = 10⁴. Samples are haploid sample nodes under a diploid timescale.
- **Spectrum:** the expected SFS is estimated by the branch-mode AFS (`ts.allele_frequency_spectrum(mode="branch")`), which has no mutation noise. Long sequences with recombination are used, and replicates give the Monte Carlo standard error.
- **Pass criterion:** the mean agrees with the expected SFS within 3 SE in at least 95 % of bins.
- **Linear size change:** msprime has no linear size function, so linear epochs are approximated by at least 100 constant sub-epochs. This is documented.
- **Inbreeding:** checked by duplicating haplotypes for autozygous individuals (site mode).

### 8.4 Statistics
- **Against tskit** [@ralph2020efficiently]: diversity, divergence, `Fst` (tskit definition), segregating sites and Tajima's D in site mode, compared with the same values from `ts.allele_frequency_spectrum` and the TypeScript weights. Target: numerical precision.
- **Against scikit-allel** (`hudson_fst`, `weir_cockerham_fst`, π, θ_W, Tajima's D) on simulated genotypes:
  - genotypes under HWE;
  - genotypes with a heterozygote deficit (haplotypes paired with a known F).
  - With per-site genotypes, the result must match scikit-allel to numerical precision. For the F_IS approximation, the size of the error is reported.
- **Against egglib** [@siol2022egglib]: Fu and Li's D, F, D\* and F\*, normalised H, and E.
- **Teaching plots, checked as numbers:** WC and Hudson against the sample-size ratio, the MAF filter and F_IS.

### 8.5 Folding
fold(unfolded) = folded in 1D and 2D, compared with moments' `fold()`.

### 8.6 Report
- `docs/VALIDATION.md` holds the error tables, figures (PNG at 300 dpi + PDF) and speed benchmarks.
- The Python scripts in `validation/` have pytest tests.

---

## 9. Repository layout
```
Interactive_DemoHis_expSFS/
  app/                  Vite + TypeScript front end
    src/engine/         moment equations, events, Web Worker
    src/stats/          weights, statistics, file parsers
    src/ui/             controls, plots, history diagram
    src/content/        teaching text (Markdown)
    scripts/            engine_cli.ts (Node CLI for validation)
  validation/           Python: moments/dadi/msprime/tskit/scikit-allel/egglib comparisons
    models.csv
    slurm/              *.sbatch (CSV-driven arrays)
    benchmarks/
    logs/               (gitignored)
  tools/                verify_references.py, render_reference_list.py
  docs/                 DESIGN.md, VALIDATION.md, REFERENCES.bib, PROMPT.md, verification report
  envs/                 sfs-validate (gitignored) + sfs-validate.lock.txt
  .github/workflows/    GitHub Pages build and deploy (prepared, not pushed)
  CHANGELOG.md  README.md  LICENSE  CITATION.cff
```

---

## 10. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Porting errors in the jackknife or CN details | Entry-by-entry operator fixtures from moments; whole-model comparison at 1e-6 |
| Slow 2D runs with migration and continuous size change | Draft mode while dragging; cache; limits on n; spinner with the old plot kept |
| Strong selection is inaccurate at small n | Limit |γ|; internal larger n; report the error against moments |
| Integrator switch at M = 0 (moments behaviour) | Follow moments; explain in the app that "migration on with rate 0" can differ from "migration off" by the discretisation error |
| Users read expected statistics as observed ones | Clear labels: "expected under the model; ratio of expectations; no linkage, no sampling variance" |
| Unverified or wrong references | The script-based verification (Section 12) is repeated before each stop point |

---

## 11. Decisions needed at STOP 1

**Answered 2026-11-18 (STOP 1):** all proposals accepted (items 1–5: MIT + CC BY 4.0; the corrected h̄; shared post-split epochs; the limits as proposed; plain TypeScript). Item 6: the screenshots are now in `docs/reference_screenshot/`; they are an inspiration, not a strict template. Item 7: Amin confirmed the Sinauer 2013 edition; the reference is restored. Item 8: the environment is kept as it is. The original questions follow.

1. **Licences:** MIT for the code and **CC BY 4.0** for the teaching text. Is this fine?
2. **WC under HWE:** use h̄ = 2p(1 − p)·2k/(2k − 1) (proposed), or 2p(1 − p) as in the prompt (Section 6.4)?
3. **Epochs after the split:** shared intervals as in GADMA (proposed), or separate epoch boundaries per population (Section 4.1)?
4. **Accuracy and limits:** dt_fac = 0.02 (final) and 0.1 (draft); n ≤ 40 per population in 2D, ≤ 100 in 1D; |γ| ≤ 50; ν ∈ [0.01, 100]. Is this fine?
5. **UI technology:** plain TypeScript (proposed) or Svelte?
6. **Reference screenshot:** the GADMA screenshot named in the prompt is not in the folder. If you want the controls and the diagram to follow it closely, please put it in `docs/reference_screenshot/`.
7. **Nielsen & Slatkin (2013):** if you can confirm the 2013 Sinauer imprint (copyright page), I restore it as a "no DOI" book. Otherwise it stays removed.
8. **Validation environment (9.7 GB):** keep it, or rebuild it leaner (matplotlib-base; scikit-allel without PyTorch). A rebuild needs you to delete the current environment first; I would give you the exact `rm` command.

---

## 12. References

### 12.1 How the references were verified
- `tools/verify_references.py` (Python standard library; Crossref, doi.org, Open Library; about one request per second; no personal data sent). Input: `docs/references_input.tsv`. Output: `docs/REFERENCES.bib` and `docs/reference_verification_report.tsv`.
- **Articles:**
  - Crossref metadata for the given DOI, or a Crossref bibliographic search.
  - A DOI is accepted only if title, first author, year and journal all match, and doi.org resolves it. A DOI is never guessed.
  - The .bib entries use the Crossref metadata.
- **Books without a DOI:** an Open Library record with a valid ISBN (checksum), and matching title, author, publisher and year.
- **The chapter without a DOI (Hudson 1990):** the Open Library record of the volume (Oxford Surveys in Evolutionary Biology, volume 7, subtitled "1990"), plus an author-hosted copy of the chapter (HTTP 200).
- **Result:** 66 of 67 entries verified by records at STOP 1 (logs in `validation/logs/`, which is gitignored). After STOP 1, the remaining book (Nielsen & Slatkin 2013) was confirmed by the app author: 67 of 67 (run 7, 2026-11-18).
- **Author-confirmed books:** an entry with `source = author_confirmed_<date>` in `references_input.tsv` is kept even when no open record shows the edition. Its .bib note says so, and the app labels it.

### 12.2 Notes
- **Wahlund (1928):** Crossref lists only the date when the journal archive went online (2010). Title, author, journal, volume (11) and first page (65) match the 1928 print, and the DOI resolves. Accepted with this note.
- **Two extra references** were added and verified: Simonsen et al. (1995), for the corrected variances of Fu and Li's F and F\*, and Siol et al. (2022), for egglib, the validation reference package.
- **moments documentation:** the URL in the prompt (`https://moments.readthedocs.io`) returns HTTP 404. The current URL, from the PyPI project links of moments-popgen, is <https://momentsld.github.io/moments/>.

### 12.3 Unverified – removed
- None at present.
- *History:* Nielsen R, Slatkin M (2013) was listed here at STOP 1, because the only open ISBN record (9781605351537) gives Oxford University Press and 2017. Amin confirmed the 2013 Sinauer edition on 2026-11-18, so it is now in the verified list, labelled "edition confirmed by the app author".

### 12.4 Verified reference list
<!-- REFERENCES:START -->
*67 verified references (all verified), generated from `docs/REFERENCES.bib` by `tools/render_reference_list.py`.*

**Coalescent and SFS theory**

- Achaz G (2009) Frequency Spectrum Neutrality Tests: One for All and All for One. *Genetics* 183: 249–258. [doi:10.1534/genetics.109.104042](https://doi.org/10.1534/genetics.109.104042). `[achaz2009frequency]`
- Fay JC, Wu CI (2000) Hitchhiking Under Positive Darwinian Selection. *Genetics* 155: 1405–1413. [doi:10.1093/genetics/155.3.1405](https://doi.org/10.1093/genetics/155.3.1405). `[fay2000hitchhiking]`
- Fu YX (1995) Statistical Properties of Segregating Sites. *Theoretical Population Biology* 48: 172–197. [doi:10.1006/tpbi.1995.1025](https://doi.org/10.1006/tpbi.1995.1025). `[fu1995statistical]`
- Griffiths RC, Tavaré S (1998) The age of a mutation in a general coalescent tree. *Communications in Statistics. Stochastic Models* 14: 273–295. [doi:10.1080/15326349808807471](https://doi.org/10.1080/15326349808807471). `[griffiths1998age]`
- Hudson RR (1990) Gene genealogies and the coalescent process. In: *Oxford Surveys in Evolutionary Biology* 7: 1–44. Oxford University Press, USA. ISBN 9780195062892, <https://home.uchicago.edu/~rhudson1/popgen356/OxfordSurveysEvolBiol7_1-44.pdf>. *No DOI.* `[hudson1990genealogies]`
- Kingman JFC (1982) The coalescent. *Stochastic Processes and their Applications* 13: 235–248. [doi:10.1016/0304-4149(82)90011-4](https://doi.org/10.1016/0304-4149(82)90011-4). `[kingman1982coalescent]`
- Nielsen R, Slatkin M (2013) An Introduction to Population Genetics: Theory and Applications. Sinauer Associates, Sunderland, MA. *No DOI; edition confirmed by the app author.* `[nielsen2013introduction]`
- Polanski A, Kimmel M (2003) New Explicit Expressions for Relative Frequencies of Single-Nucleotide Polymorphisms With Application to Statistical Inference on Population Growth. *Genetics* 165: 427–436. [doi:10.1093/genetics/165.1.427](https://doi.org/10.1093/genetics/165.1.427). `[polanski2003new]`
- Slatkin M, Hudson RR (1991) Pairwise comparisons of mitochondrial DNA sequences in stable and exponentially growing populations. *Genetics* 129: 555–562. [doi:10.1093/genetics/129.2.555](https://doi.org/10.1093/genetics/129.2.555). `[slatkin1991pairwise]`
- Tajima F (1989) Statistical method for testing the neutral mutation hypothesis by DNA polymorphism. *Genetics* 123: 585–595. [doi:10.1093/genetics/123.3.585](https://doi.org/10.1093/genetics/123.3.585). `[tajima1989statistical]`
- Tajima F (1989) The effect of change in population size on DNA polymorphism. *Genetics* 123: 597–601. [doi:10.1093/genetics/123.3.597](https://doi.org/10.1093/genetics/123.3.597). `[tajima1989effect]`
- Wakeley J (2009) Coalescent Theory: An Introduction. Roberts & Company. ISBN 9780974707754, <https://openlibrary.org/isbn/9780974707754>. *No DOI.* `[wakeley2009coalescent]`
- Watterson GA (1975) On the number of segregating sites in genetical models without recombination. *Theoretical Population Biology* 7: 256–276. [doi:10.1016/0040-5809(75)90020-9](https://doi.org/10.1016/0040-5809(75)90020-9). `[watterson1975number]`

**Demography and the SFS (single population)**

- Marth GT, Czabarka E, Murvai J, Sherry ST (2004) The Allele Frequency Spectrum in Genome-Wide Human Variation Data Reveals Signals of Differential Demographic History in Three Large World Populations. *Genetics* 166: 351–372. [doi:10.1534/genetics.166.1.351](https://doi.org/10.1534/genetics.166.1.351). `[marth2004allele]`
- Williamson SH, Hernandez R, Fledel-Alon A, Zhu L, Nielsen R, Bustamante CD (2005) Simultaneous inference of selection and population growth from patterns of variation in the human genome. *Proceedings of the National Academy of Sciences* 102: 7882–7887. [doi:10.1073/pnas.0502300102](https://doi.org/10.1073/pnas.0502300102). `[williamson2005simultaneous]`

**Joint SFS, structure, migration and admixture**

- Chen H, Green RE, Pääbo S, Slatkin M (2007) The Joint Allele-Frequency Spectrum in Closely Related Species. *Genetics* 177: 387–398. [doi:10.1534/genetics.107.070730](https://doi.org/10.1534/genetics.107.070730). `[chen2007joint]`
- Chikhi L, Sousa VC, Luisi P, Goossens B, Beaumont MA (2010) The Confounding Effects of Population Structure, Genetic Diversity and the Sampling Scheme on the Detection and Quantification of Population Size Changes. *Genetics* 186: 983–995. [doi:10.1534/genetics.110.118661](https://doi.org/10.1534/genetics.110.118661). `[chikhi2010confounding]`
- Mazet O, Rodríguez W, Grusea S, Boitard S, Chikhi L (2016) On the importance of being structured: instantaneous coalescence rates and human evolution—lessons for ancestral population size inference?. *Heredity* 116: 362–371. [doi:10.1038/hdy.2015.104](https://doi.org/10.1038/hdy.2015.104). `[mazet2016importance]`
- Ptak SE, Przeworski M (2002) Evidence for population growth in humans is confounded by fine-scale population structure. *Trends in Genetics* 18: 559–563. [doi:10.1016/s0168-9525(02)02781-6](https://doi.org/10.1016/s0168-9525(02)02781-6). `[ptak2002evidence]`
- Städler T, Haubold B, Merino C, Stephan W, Pfaffelhuber P (2009) The Impact of Sampling Schemes on the Site Frequency Spectrum in Nonequilibrium Subdivided Populations. *Genetics* 182: 205–216. [doi:10.1534/genetics.108.094904](https://doi.org/10.1534/genetics.108.094904). `[stadler2009impact]`
- Wakeley J, Hey J (1997) Estimating Ancestral Population Parameters. *Genetics* 145: 847–855. [doi:10.1093/genetics/145.3.847](https://doi.org/10.1093/genetics/145.3.847). `[wakeley1997estimating]`

**Selection, dominance and inbreeding**

- Blischak PD, Barker MS, Gutenkunst RN (2020) Inferring the Demographic History of Inbred Species from Genome-Wide SNP Frequency Data. *Molecular Biology and Evolution* 37: 2124–2136. [doi:10.1093/molbev/msaa042](https://doi.org/10.1093/molbev/msaa042). `[blischak2020inferring]`
- Huber CD, Durvasula A, Hancock AM, Lohmueller KE (2018) Gene expression drives the evolution of dominance. *Nature Communications* 9: 2750. [doi:10.1038/s41467-018-05281-7](https://doi.org/10.1038/s41467-018-05281-7). `[huber2018gene]`
- Kim BY, Huber CD, Lohmueller KE (2017) Inference of the Distribution of Selection Coefficients for New Nonsynonymous Mutations Using Large Samples. *Genetics* 206: 345–361. [doi:10.1534/genetics.116.197145](https://doi.org/10.1534/genetics.116.197145). `[kim2017inference]`
- Sawyer SA, Hartl DL (1992) Population genetics of polymorphism and divergence. *Genetics* 132: 1161–1176. [doi:10.1093/genetics/132.4.1161](https://doi.org/10.1093/genetics/132.4.1161). `[sawyer1992population]`

**Diversity, divergence and differentiation statistics**

- Bhatia G, Patterson N, Sankararaman S, Price AL (2013) Estimating and interpreting FST: The impact of rare variants. *Genome Research* 23: 1514–1521. [doi:10.1101/gr.154831.113](https://doi.org/10.1101/gr.154831.113). `[bhatia2013estimating]`
- Cruickshank TE, Hahn MW (2014) Reanalysis suggests that genomic islands of speciation are due to reduced diversity, not reduced gene flow. *Molecular Ecology* 23: 3133–3157. [doi:10.1111/mec.12796](https://doi.org/10.1111/mec.12796). `[cruickshank2014reanalysis]`
- Danecek P, Auton A, Abecasis G, Albers CA, Banks E, DePristo MA, et al. (2011) The variant call format and VCFtools. *Bioinformatics* 27: 2156–2158. [doi:10.1093/bioinformatics/btr330](https://doi.org/10.1093/bioinformatics/btr330). `[danecek2011variant]`
- Danecek P, Bonfield JK, Liddle J, Marshall J, Ohan V, Pollard MO, et al. (2021) Twelve years of SAMtools and BCFtools. *GigaScience* 10: giab008. [doi:10.1093/gigascience/giab008](https://doi.org/10.1093/gigascience/giab008). `[danecek2021twelve]`
- Fu YX, Li WH (1993) Statistical tests of neutrality of mutations. *Genetics* 133: 693–709. [doi:10.1093/genetics/133.3.693](https://doi.org/10.1093/genetics/133.3.693). `[fu1993statistical]`
- Hudson RR, Slatkin M, Maddison WP (1992) Estimation of levels of gene flow from DNA sequence data. *Genetics* 132: 583–589. [doi:10.1093/genetics/132.2.583](https://doi.org/10.1093/genetics/132.2.583). `[hudson1992estimation]`
- Korneliussen TS, Albrechtsen A, Nielsen R (2014) ANGSD: Analysis of Next Generation Sequencing Data. *BMC Bioinformatics* 15: 356. [doi:10.1186/s12859-014-0356-4](https://doi.org/10.1186/s12859-014-0356-4). `[korneliussen2014angsd]`
- Nei M, Li WH (1979) Mathematical model for studying genetic variation in terms of restriction endonucleases. *Proceedings of the National Academy of Sciences* 76: 5269–5273. [doi:10.1073/pnas.76.10.5269](https://doi.org/10.1073/pnas.76.10.5269). `[nei1979mathematical]`
- Nei M (1987) Molecular Evolutionary Genetics. Columbia University Press. [doi:10.7312/nei-92038](https://doi.org/10.7312/nei-92038). `[nei1987molecular]`
- Peter BM (2016) Admixture, Population Structure, and F -Statistics. *Genetics* 202: 1485–1501. [doi:10.1534/genetics.115.183913](https://doi.org/10.1534/genetics.115.183913). `[peter2016admixture]`
- Ralph P, Thornton K, Kelleher J (2020) Efficiently Summarizing Relationships in Large Samples: A General Duality Between Statistics of Genealogies and Genomes. *Genetics* 215: 779–797. [doi:10.1534/genetics.120.303253](https://doi.org/10.1534/genetics.120.303253). `[ralph2020efficiently]`
- Simonsen KL, Churchill GA, Aquadro CF (1995) Properties of statistical tests of neutrality for DNA polymorphism data. *Genetics* 141: 413–429. [doi:10.1093/genetics/141.1.413](https://doi.org/10.1093/genetics/141.1.413). `[simonsen1995properties]`
- Slatkin M (1991) Inbreeding coefficients and coalescence times. *Genetical Research* 58: 167–175. [doi:10.1017/s0016672300029827](https://doi.org/10.1017/s0016672300029827). `[slatkin1991inbreeding]`
- Tajima F (1983) Evolutionary relationship of DNA sequences in finite populations. *Genetics* 105: 437–460. [doi:10.1093/genetics/105.2.437](https://doi.org/10.1093/genetics/105.2.437). `[tajima1983evolutionary]`
- Wahlund S (1928) Zusammensetzung von Populationen und Korrelationserscheinungen vom Standpunkt der Vererbungslehre aus betrachtet. *Hereditas* 11: 65–106. [doi:10.1111/j.1601-5223.1928.tb02483.x](https://doi.org/10.1111/j.1601-5223.1928.tb02483.x). `[wahlund1928zusammensetzung]`
- Weir BS, Cockerham CC (1984) Estimating F-Statistics for the Analysis of Population Structure. *Evolution* 38: 1358. [doi:10.2307/2408641](https://doi.org/10.2307/2408641). `[weir1984estimating]`
- Weir BS, Hill WG (2002) Estimating F-Statistics. *Annual Review of Genetics* 36: 721–750. [doi:10.1146/annurev.genet.36.050802.093940](https://doi.org/10.1146/annurev.genet.36.050802.093940). `[weir2002estimating]`
- Zeng K, Fu YX, Shi S, Wu CI (2006) Statistical Tests for Detecting Positive Selection by Utilizing High-Frequency Variants. *Genetics* 174: 1431–1439. [doi:10.1534/genetics.106.061432](https://doi.org/10.1534/genetics.106.061432). `[zeng2006statistical]`

**Limits of SFS-based inference**

- Lapierre M, Lambert A, Achaz G (2017) Accuracy of Demographic Inferences from the Site Frequency Spectrum: The Case of the Yoruba Population. *Genetics* 206: 439–449. [doi:10.1534/genetics.116.192708](https://doi.org/10.1534/genetics.116.192708). `[lapierre2017accuracy]`
- Myers S, Fefferman C, Patterson N (2008) Can one learn history from the allelic spectrum?. *Theoretical Population Biology* 73: 342–348. [doi:10.1016/j.tpb.2008.01.001](https://doi.org/10.1016/j.tpb.2008.01.001). `[myers2008can]`
- Rosen Z, Bhaskar A, Roch S, Song YS (2018) Geometry of the Sample Frequency Spectrum and the Perils of Demographic Inference. *Genetics* 210: 665–682. [doi:10.1534/genetics.118.300733](https://doi.org/10.1534/genetics.118.300733). `[rosen2018geometry]`
- Terhorst J, Song YS (2015) Fundamental limits on the accuracy of demographic inference based on the sample frequency spectrum. *Proceedings of the National Academy of Sciences* 112: 7677–7682. [doi:10.1073/pnas.1503717112](https://doi.org/10.1073/pnas.1503717112). `[terhorst2015fundamental]`

**Software, model formats and simulation**

- Adrion JR, Cole CB, Dukler N, Galloway JG, Gladstein AL, Gower G, et al. (2020) A community-maintained standard library of population genetic models. *eLife* 9: e54967. [doi:10.7554/elife.54967](https://doi.org/10.7554/elife.54967). `[adrion2020community]`
- Baumdicker F, Bisschop G, Goldstein D, Gower G, Ragsdale AP, Tsambos G, et al. (2022) Efficient ancestry and mutation simulation with msprime 1.0. *Genetics* 220: iyab229. [doi:10.1093/genetics/iyab229](https://doi.org/10.1093/genetics/iyab229). `[baumdicker2022efficient]`
- Excoffier L, Dupanloup I, Huerta-Sánchez E, Sousa VC, Foll M (2013) Robust Demographic Inference from Genomic and SNP Data. *PLoS Genetics* 9: e1003905. [doi:10.1371/journal.pgen.1003905](https://doi.org/10.1371/journal.pgen.1003905). `[excoffier2013robust]`
- Gower G, Ragsdale AP, Bisschop G, Gutenkunst RN, Hartfield M, Noskova E, et al. (2022) Demes: a standard format for demographic models. *Genetics* 222: iyac131. [doi:10.1093/genetics/iyac131](https://doi.org/10.1093/genetics/iyac131). `[gower2022demes]`
- Gutenkunst RN, Hernandez RD, Williamson SH, Bustamante CD (2009) Inferring the Joint Demographic History of Multiple Populations from Multidimensional SNP Frequency Data. *PLoS Genetics* 5: e1000695. [doi:10.1371/journal.pgen.1000695](https://doi.org/10.1371/journal.pgen.1000695). `[gutenkunst2009inferring]`
- Jouganous J, Long W, Ragsdale AP, Gravel S (2017) Inferring the Joint Demographic History of Multiple Populations: Beyond the Diffusion Approximation. *Genetics* 206: 1549–1567. [doi:10.1534/genetics.117.200493](https://doi.org/10.1534/genetics.117.200493). `[jouganous2017inferring]`
- Kamm J, Terhorst J, Durbin R, Song YS (2020) Efficiently Inferring the Demographic History of Many Populations With Allele Count Data. *Journal of the American Statistical Association* 115: 1472–1487. [doi:10.1080/01621459.2019.1635482](https://doi.org/10.1080/01621459.2019.1635482). `[kamm2020efficiently]`
- Kelleher J, Etheridge AM, McVean G (2016) Efficient Coalescent Simulation and Genealogical Analysis for Large Sample Sizes. *PLOS Computational Biology* 12: e1004842. [doi:10.1371/journal.pcbi.1004842](https://doi.org/10.1371/journal.pcbi.1004842). `[kelleher2016efficient]`
- Noskova E, Abramov N, Iliutkin S, Sidorin A, Dobrynin P, Ulyantsev VI (2023) GADMA2: more efficient and flexible demographic inference from genetic data. *GigaScience* 12: giad059. [doi:10.1093/gigascience/giad059](https://doi.org/10.1093/gigascience/giad059). `[noskova2023gadma2]`
- Noskova E, Ulyantsev V, Koepfli KP, O'Brien SJ, Dobrynin P (2020) GADMA: Genetic algorithm for inferring demographic history of multiple populations from allele frequency spectrum data. *GigaScience* 9: giaa005. [doi:10.1093/gigascience/giaa005](https://doi.org/10.1093/gigascience/giaa005). `[noskova2020gadma]`
- Ragsdale AP, Nelson D, Gravel S, Kelleher J (2020) Lessons Learned from Bugs in Models of Human History. *The American Journal of Human Genetics* 107: 583–588. [doi:10.1016/j.ajhg.2020.08.017](https://doi.org/10.1016/j.ajhg.2020.08.017). `[ragsdale2020lessons]`
- Siol M, Coudoux T, Ravel S, De Mita S (2022) EggLib 3: A python package for population genetics and genomics. *Molecular Ecology Resources* 22: 3176–3187. [doi:10.1111/1755-0998.13672](https://doi.org/10.1111/1755-0998.13672). `[siol2022egglib]`

**Online documentation**

- **dadi documentation**. dadi developers. <https://dadi.readthedocs.io> (checked 2026-11-18). `[web_dadi_docs]`
- **GADMA repository and documentation**. GADMA developers. <https://github.com/ctlab/GADMA> (checked 2026-11-18). `[web_gadma_repo]`
- **moments documentation**. moments developers. <https://momentsld.github.io/moments/> (checked 2026-11-18). `[web_moments_docs]`
- **easySFS repository**. Overcast I. <https://github.com/isaacovercast/easySFS> (checked 2026-11-18). `[web_easysfs_repo]`
- **Demes specification**. PopSim Consortium. <https://popsim-consortium.github.io/demes-spec-docs/> (checked 2026-11-18). `[web_demes_spec]`
- **scikit-allel documentation**. scikit-allel developers. <https://scikit-allel.readthedocs.io> (checked 2026-11-18). `[web_scikit_allel_docs]`
- **msprime documentation**. tskit developers. <https://tskit.dev/msprime/docs/> (checked 2026-11-18). `[web_msprime_docs]`
- **tskit statistics documentation**. tskit developers. <https://tskit.dev/tskit/docs/stable/stats.html> (checked 2026-11-18). `[web_tskit_stats]`

<!-- REFERENCES:END -->
