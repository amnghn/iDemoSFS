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
