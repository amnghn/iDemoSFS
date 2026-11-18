# Changelog

All notable changes to this project are recorded in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html) with a `-beta` suffix.
Every entry has an ISO 8601 timestamp in Vienna time (`TZ=Europe/Vienna date -Iminutes`).

## [Unreleased] (target: 0.1.0-beta)

### 2026-11-18T14:35+01:00 | Phase 0, step 0.1: project skeleton

#### Added
- Folder skeleton: `docs/`, `tools/`, `validation/slurm/`, `validation/logs/`, `validation/benchmarks/`, `app/`, `envs/`.
- `docs/PROMPT.md`: byte-identical copy of the original prompt (checked with `cmp`), with a dated "Follow-up instructions" section for the decisions of 2026-11-18.
- `CHANGELOG.md` (this file).
- `.gitignore` (local environments, `node_modules/`, `app/dist/`, SLURM logs, local-only logs, private test data).
- Local git repository (`git init`, branch `main`). Nothing is pushed.

### 2026-11-18T15:06+01:00 | Phase 0, steps 0.2–0.4: validation environment, moments speed baseline, verified references

#### Added
- `validation/slurm/create_env_sfs-validate.sbatch` and `validation/smoke_test_env_imports.py`. The local environment `./envs/sfs-validate` (Python 3.12.16) was created by SLURM job 8080694 and is not tracked by git. It contains moments-popgen 1.7.1, dadi 2.4.3, msprime 1.4.5, tskit 1.0.4, demes 0.2.3, demesdraw 0.4.1, scikit-allel 1.3.13, egglib 3.6.1, numpy 2.5.5, scipy 1.18.1, matplotlib 3.11.2, pandas 3.1.1 and pytest 9.2.0. The smoke test passed: every import works, and the standard neutral model with n = 20 gives E[ξᵢ] = θ/i with a maximum relative error of 1.9e-16.
- `envs/sfs-validate.lock.txt`: conda explicit list plus pip freeze, so the environment can be rebuilt.
- `validation/benchmarks/benchmark_moments_timing_n20.py`, `validation/slurm/benchmark_moments_timing_n20.sbatch` and the result `validation/benchmarks/moments_timing_n20.tsv` (job 8080695, one core of an Intel Xeon Silver 4114). Run times for moments: 2–8 ms for the 1D models (n = 20); 38 ms (split), 59 ms (isolation with migration), 88 ms (secondary contact), 128 ms (admixture pulse via Demes) and 304 ms (isolation with migration plus exponential growth) for the 2D models (20 × 20). At the default `dt_fac` = 0.02, the time-step error of moments is at most 2.8e-4 relative to `dt_fac` = 0.002.
- `docs/references_input.tsv`: the starting list from prompt Section 7.2, plus two extra references (Simonsen et al. 1995; Siol et al. 2022).
- `tools/verify_references.py` (Python standard library only; uses Crossref, doi.org and Open Library). It produced `docs/REFERENCES.bib` (66 verified entries) and `docs/reference_verification_report.tsv`. Of the 67 input entries, 66 were verified:
  - 56 articles and 1 book through Crossref, with a DOI that resolves;
  - Wahlund (1928) with a note: Crossref lists only the 2010 online-archive date, but the volume and pages match;
  - 2 references without a DOI, checked through an ISBN record: Wakeley (2009), and Hudson (1990), which was also checked through the author's own copy of the chapter;
  - 8 web resources.
- `tools/render_reference_list.py`: writes the reference list into Markdown files.

#### Changed
- The moments documentation URL is now <https://momentsld.github.io/moments/>. The URL in the prompt (moments.readthedocs.io) returns HTTP 404; the new URL comes from the PyPI project links of moments-popgen.

#### Removed
- Nielsen & Slatkin (2013) is listed as "Unverified – removed". The only open ISBN record (9781605351537) shows Oxford University Press and 2017, so the 2013 Sinauer edition could not be confirmed.

### 2026-11-18T15:15+01:00 | Phase 0, step 0.5 and ⏸ STOP 1: design note

#### Added
- `docs/DESIGN.md`, the Phase 0 design note. It covers:
  - the LiSC environment check;
  - the engine options A–D and the recommendation (A: a TypeScript port of the moments 1.7.1 algorithms; exact admixture through `admix_into_new`; inbreeding as an exact post-processing step under the Blischak et al. model);
  - the numerical method and the speed estimates against the measured moments baseline;
  - the statistics framework (weights, Hudson and WC F_ST from the SFS, a flagged point on the expected heterozygosity under HWE);
  - the file parsers, the front-end stack (Vite, plain TypeScript, D3, KaTeX) and an ASCII wireframe;
  - the Phase 1 validation plan (34 test models), risks, eight decisions for STOP 1, and the verified reference list (generated from `docs/REFERENCES.bib`). All 33 citation keys used in DESIGN.md exist in the .bib file (checked with `tools/verify_references.py --check-keys`).

#### Changed
- `tools/verify_references.py`: ISBN checksum check; Crossref book records ("monograph") are written as books with a publisher check; author initials for books without a DOI; retry with back-off for network time-outs. Final run 6: 66 of 67 references verified, with the same result as before.

#### Notes
- The SLURM scripts now use `${SLURM_SUBMIT_DIR:-$PWD}` instead of a hard-coded LiSC path.
- First local git commit (branch `main`). Nothing was pushed.

### 2026-11-18T16:37+01:00 | STOP 1 answered: design approved, start of Phase 1

#### Added
- `docs/PROMPT.md`: the STOP 1 answers under "Follow-up instructions" (the original text is unchanged; checked with `cmp`).
- `docs/reference_screenshot/`: three GADMA "Additional controls" screenshots (structure (2, 1), toggle panel, tube diagram with migration arrows), given by Amin as design inspiration.
- `tools/verify_references.py`: books marked `author_confirmed_<date>` in `docs/references_input.tsv` are kept when no open record shows the edition, and the .bib note says so.

#### Changed
- Nielsen & Slatkin (2013), *An Introduction to Population Genetics: Theory and Applications* (Sinauer Associates), is restored. Amin confirmed the 2013 Sinauer edition. Verification run 7: 67 of 67 references verified (66 by records, 1 confirmed by the app author).
- `docs/DESIGN.md`: status "approved"; Section 11 records the answers (all proposals accepted; the environment is kept; the screenshots are an inspiration, not a strict template); Section 12 updated.
- `tools/render_reference_list.py`: entries without a URL, and author-confirmed editions, are rendered correctly.

### 2026-11-18T16:57+01:00 | Phase 1, step 1.1: TypeScript engine (port of moments 1.7.1)

#### Added
- `app/`: Vite + TypeScript project (`package.json` version 0.1.0-beta; dev dependencies pinned: vite 8.3.5, vitest 5.1.0, typescript 5.9.3, tsx 4.23.15, @types/node 22.20.5). `app/.npmrc` sets `legacy-peer-deps=true`, because npm 10.9.2 fails on vitest's optional peer dependencies ("Cannot read properties of null (reading 'edgesOut')").
- `app/src/engine/`: the engine.
  - `jackknife.ts`: jackknife closure matrices.
  - `operators.ts`: drift, selection and migration operators.
  - `linalg.ts`: tridiagonal solver; sparse matrices; banded LU with partial pivoting (a port of LAPACK dgbtf2/dgbtrs).
  - `integrate.ts`: the three moments integrators, with the same time-step rules and integrator choice.
  - `ndarray.ts`: projection, split, exact admixture (`admix_into_new`), pooling, folding, misidentification.
  - `postprocess.ts`: exact inbreeding sampling transform.
  - `model.ts`: GADMA-style model, compiled into intervals with the interval logic of `moments.Demes`.
  - `compute.ts`: computes the expected SFS of a model.
  - `demes.ts`: Demes YAML export.
- `app/scripts/engine_cli.ts`: writes the engine's spectra and Demes YAML for every validation model, and runs speed benchmarks.
- `validation/make_validation_models.py`, `validation/models.csv` (39 models: 14 1D demography, 7 1D advanced, 14 2D demography, 4 2D advanced) and `validation/models/*.json`.
- `validation/sfsval/common.py` and `validation/compare_engine_vs_moments.py`.

#### Notes
- First check (5 models, login node): the TypeScript engine matches `moments.Spectrum.from_demes` on its own Demes export to 1e-13 or better (standard neutral model 3.8e-16; IM 9.4e-15; admixture pulse 6.2e-14; selection 1.0e-15). The full comparison runs through SLURM.

### 2026-11-18T17:21+01:00 | Phase 1, steps 1.2–1.6: validation pipeline, statistics, selection limits

#### Added
- Validation scripts (Python, run through SLURM).
  - `validation/compare_engine_vs_moments.py`: compares with `from_demes`, plus moments' own API with a double-precision start; also checks folding, the marginal spectra and the pooled sample.
  - `validation/compare_inbreeding_vs_dadi.py` (dadi `from_phi_inbreeding`, extrapolated over three grid sizes).
  - `validation/simulate_msprime_branch_sfs.py` (one SLURM array task per row of `models.csv`; branch-mode AFS; 4,000 replicates of 1 Mb) and `validation/compare_engine_vs_msprime.py` (z-scores).
  - `validation/stats_reference_from_simulations.py` and `validation/compare_stats.py` (statistics against tskit, scikit-allel and egglib).
  - `validation/export_moments_fixtures.py` (moments results as Vitest fixtures).
  - `validation/benchmarks/benchmark_moments_from_demes.py`.
  - `validation/make_validation_report.py` (figures and tables for `docs/VALIDATION.md`).
  - `validation/tests/` (pytest).
  - SLURM scripts in `validation/slurm/`.
- `app/src/stats/onepop.ts` and `app/src/stats/twopop.ts`.
  - Statistics as weight vectors and matrices: S, θ_W, θ_π, θ_H, θ_L and singleton estimators; Tajima's D; Fu and Li's D, F, D*, F* (F and F* with the corrected variances of Simonsen et al. 1995); Fay and Wu's H (raw) and Zeng's normalised H and E.
  - Two-population statistics: π₁, π₂, d_xy, d_a; Hudson's F_ST (ratio of averages) and tskit's Fst definition; Weir and Cockerham's θ, F_IS and F_IT from the SFS (three heterozygosity options) and from per-site genotype counts (exact); f₂; fixed, shared and private sites.
- `app/src/engine/coalescent.ts`: an independent coalescent expectation for neutral one-population models.
- `app/src/engine/diffusion.ts`: the exact equilibrium SFS of the diffusion under selection and dominance.
- `app/scripts/selection_closure_study.ts`: closure error of the jackknife under selection.
- Vitest suites `app/test/engine.test.ts` and `app/test/selection.test.ts`, with the moments fixtures in `app/test/fixtures/`.
- `engine_cli.ts stats`: TypeScript statistics for given spectra.

#### Fixed
- Demes export and model compiler: epoch end times are now sums from the present. Before, the last epoch could end at 2.8e-13 generations instead of 0, and moments then treated the sample as an ancient sample.
- msprime script: population ids are taken from the msprime demography (tskit `Population` has no `name` attribute).

#### Changed
- **Selection defaults** (DESIGN.md Section 4.8 said Phase 1 would adjust them):
  - selection is now integrated at an internal sample size of max(n, 100) in 1D and max(n, 40) per population in 2D, then projected;
  - before, this happened only for |γ| > 10, and at 40.
  - Reason: against the exact equilibrium of the diffusion, n = 20 used directly gives 2–17 % error in the main bins for |γ| ≥ 5. With n = 100 the error is below 0.5 % for γ from −50 to +30 at any h.
  - The study also confirms moments' selection convention: fitnesses 1, 1 + 2hs, 1 + 2s, and γ = 2N_ref·s.

#### Notes (results; full report in `docs/VALIDATION.md`)
- **Engine against moments 1.7.1** (39 models): all within 1 %; 38 within 1e-6, most at 1e-14 to 1e-16.
  - The exception (h = 0.9, 1.8e-6) comes from moments: its `steady_state_1D` takes single-precision Cython `float` arguments, so h is rounded to float32.
  - With a double-precision start, the engine matches moments to 8.6e-12 for that model.
- **Statistics:** all 242 comparisons with tskit, scikit-allel and egglib agree to within 1e-9.
- **WC heterozygosity term**, averaged over 200 random pairings of the same haplotypes:
  - h̄ = 2p(1−p)·2k/(2k−1) agrees with scikit-allel to 0.02–0.15 %;
  - plain 2p(1−p) is 0.4–11.6 % off;
  - under a heterozygote deficit, the F_IS approximation is within 0.07–2.9 % for θ_WC, and its F_IS is 2–4 % too high.
- **Inbreeding against dadi:** the exact transform agrees with dadi's beta-binomial integral to 5.6e-4 (1D) and 1.3e-3 (2D), and the agreement improves on finer dadi grids. dadi's own outbred 2D spectrum differs from moments by 0.3–0.6 % in the main bins, and by up to 4.5 % in small bins along the axes.

### 2026-11-18T17:42+01:00 | Phase 1, step 1.7 and ⏸ STOP 2: validation report

#### Added
- `docs/VALIDATION.md`: the Phase 1 validation report. Figures are in `docs/validation/figures/` (PNG at 300 dpi and PDF; Okabe–Ito colours checked with a colour-vision validator; cividis for heatmaps); result tables are in `docs/validation/tables/`. A cited-only reference list is generated by `tools/render_reference_list.py --cited-only`.
- **Migration rule:** with migration on, each population is integrated at max(n, 20) chromosomes and then projected (option `migrationMinN2D`). Reason: the msprime check showed a 1.4–2.9 % closure error with a sample of 10 chromosomes.
- msprime script: environment overrides for an independent extra run (`MSPRIME_REPLICATES`, `MSPRIME_SEED_BASE`, `MSPRIME_OUT_DIR`).
- `compare_engine_vs_msprime.py`: `--ms-dir` and `--out` options.

#### Changed
- **msprime pass criterion:** |z| ≤ 3 in at least 95 % of the bins that hold at least 0.01 % of the polymorphic mass, the same "non-trivial" bins as in the moments comparison. The fraction over all bins is still reported.
- **Vitest fixtures** now store the internal sample sizes (`sim_n`), so they stay valid when the engine's defaults change.
- `docs/DESIGN.md`: the selection convention is confirmed, and Section 4.8 records the new internal sample sizes.
- `.gitignore`: `validation/output/` (raw outputs; the summary tables are copied to `docs/validation/tables/`) and `docs/reference_screenshot/` (kept local; possibly third-party images).

#### Notes (final results; jobs listed in `validation/logs/clean_run_job_ids.txt`)
- **Engine against moments:** all 39 models agree within 1e-6, largest 3.4e-8. The three largest come from moments' float32 steady state for h ≠ 0.5; with a double-precision start they agree to 1.2e-13 or better. Folding, marginal spectra and the pooled sample agree to rounding error, and the folded masks are identical.
- **msprime** (28 models, 4,000 replicates each): 27 pass. exp_sudden_recent had one of its 19 bins at |z| = 3.48. The independent extra run (16,000 replicates, new seed) has all 19 bins within 3 SE (max |z| 2.3), and split_recent_nomig has 99.7 %.
- **Inbreeding against dadi:** the transform agrees to 5.6e-4 (1D) and 1.3e-3 (2D) on the fine grids.
- **Statistics:** 242 of 242 exact comparisons agree within 1e-9.
- **Tests:** Vitest 50 of 50; pytest 8 of 8.
- **Speed** (one core, Xeon Silver 4114):
  - one-population models 0.4–2.7 ms; two-population models with constant sizes 6–60 ms;
  - the slowest cases 204–290 ms at full accuracy and 41–185 ms in draft mode;
  - faster than moments for 38 of 39 models; the exception is 2D selection with migration at 40 × 40 (288 against 248 ms).
- Local commit at STOP 2. Nothing was pushed.
