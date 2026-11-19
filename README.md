# iDemoSFS: Demographic history and the expected SFS

**An interactive teaching tool (beta, v0.2.1-beta).** Change a population's history (sizes, times, the type of size change, a split, migration, an admixture pulse) and see, at once, a drawing of the history, the expected site frequency spectrum (SFS, 1D and joint 2D, folded and unfolded) and the classic statistics computed from it. A Statistics tab also works as a calculator for your own SFS files. The app runs entirely in the browser: there is no server, and no data leave your computer.

- **Live site:** <https://amnghn.github.io/iDemoSFS/>
- **Repository:** <https://github.com/amnghn/iDemoSFS>
- **Validation report:** [`docs/VALIDATION.md`](docs/VALIDATION.md)
- **Design note:** [`docs/DESIGN.md`](docs/DESIGN.md)
- **Change log:** [`CHANGELOG.md`](CHANGELOG.md)

> **Beta disclaimer.** This tool is a work in progress, provided "as is", without warranty of any kind. The calculations were checked against established software (see the validation report), but please check important results with tools such as dadi, moments, msprime or scikit-allel before you use them in research or publications. Please report errors.

## What it does

- **Model builder** after GADMA's "model with structure":
  - one or two populations, with 1–3 epochs before and after the split;
  - sudden, linear or exponential size change;
  - migration (symmetric, asymmetric, or masked per epoch) and an admixture pulse;
  - selection (γ), dominance (h), inbreeding (F) and ancestral misidentification (ε).
- **Linked outputs:** a tube diagram of the history, the expected 1D SFS (with the neutral expectation, the ratio to it and a pinned "ghost" spectrum), the joint SFS with its marginal spectra, a statistics panel, and a short "What changed?" explanation.
- **28 presets** covering the four topics: constant size, expansion, bottlenecks and contractions, and structure, migration and admixture. Every preset is one of the validated test models.
- **Statistics tab:**
  - θ_W, θ_π, θ_H, θ_L, singleton estimators, Tajima's D, Fu and Li's D, F, D* and F*, Fay and Wu's H, Zeng's E, π₁, π₂, d_xy, d_a, Hudson's and Weir and Cockerham's F_ST, f₂, and shared, private and fixed sites;
  - plots of the estimator weights, 2D weight maps, F_ST teaching plots, a parameter sweep and short explanation cards.
- **Calculator mode** (Statistics tab → **Upload your own SFS**): upload or paste a dadi/moments `.fs` file, easySFS output, ANGSD `realSFS` output or a plain matrix. For Weir and Cockerham's estimator, a VCF or genotype counts can be added. The app compares the data with the current model, with residuals as in dadi and moments.
- **Exports:** the spectrum as CSV or `.fs`, the model as Demes YAML, and the figures as SVG or PNG. The current model is kept in the page address, so it can be shared as a link; `?preset=<id>` opens a preset.
- **Learn tab:** teaching text with references, guided exercises and a glossary.
- **Light and dark themes:** the page follows the system setting; the theme button in the header switches it (the choice is remembered in the browser). The **Reset** button clears all changes and starts again with the default model; changing tabs keeps the changes.

## Run it locally

Requirements: Node.js 22 (with npm).

```bash
cd app
npm ci                 # install the exact versions from package-lock.json
npm run dev            # development server at http://127.0.0.1:5173/
npm test               # Vitest: engine, statistics, calculator and UI tests
npm run build          # static site in app/dist/
npm run preview        # serve app/dist at http://127.0.0.1:4173/
```

On LiSC, load Node first (`module load nodejs/22.17.1-GCCcore-14.3.0`, in a login shell) and forward the port with VS Code Remote-SSH. The servers listen on 127.0.0.1 only.

`app/dist/` is a plain static site; any web server can host it. `app/dist/bench.html` times the engine in your browser.

## Deploy to GitHub Pages

The workflow `.github/workflows/deploy-pages.yml` installs, tests, builds and publishes `app/dist` on every push to `main`. To use it:

1. Create the repository on GitHub and push this folder (branch `main`).
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The site appears at <https://amnghn.github.io/iDemoSFS/> after the workflow finishes (for a fork: `https://<user>.github.io/<repository>/`).

The build uses relative paths, so it works under any repository name.

## Validation

The engine is a TypeScript port of the moment equations of moments 1.7.1 (Jouganous et al. 2017). It was checked against:
- moments, for 39 models (all within 1e-6);
- dadi, for inbreeding;
- msprime simulations, for 28 models.

The statistics were checked against tskit, scikit-allel and egglib (242 of 242 comparisons within 1e-9). The calculator mode was checked against moments, egglib and scikit-allel. Everything is in [`docs/VALIDATION.md`](docs/VALIDATION.md).

The validation pipeline runs on an HPC cluster (SLURM). Its Python environment is described by `envs/sfs-validate.lock.txt`, and its scripts are in `validation/`.

## Known limitations

- **Expected spectra only.** The spectra ignore linkage and the sampling variance of real data. Normalised statistics (Tajima's D, F_ST, …) in model mode are ratios of expectations.
- **The diffusion approximation** of moments: it differs from a finite Wright–Fisher population by terms of order 1/N.
- **The jackknife closure** for migration and selection. The engine computes at a larger internal sample size and projects down. Even so, strong selection in two populations has an error of about 1–3 % in the main bins (|γ| is limited to 20 there, and to 50 in one population).
- **Sample sizes** are limited to 100 chromosomes in one population and 40 per population in two, to keep the app fast. The calculator reads larger spectra, but the model–data comparison needs the same sample sizes.
- **Speed.** The slowest models (migration with continuous size change; selection with migration) take about 150 ms on a fast computer and may take about 300 ms on a slow one. Draft accuracy is used while a slider moves.
- **The Weir and Cockerham F_IS option** assumes the same F_IS at every site. It is an approximation: in the validation, θ_WC was within 3 % and the reported F_IS was 2–4 % too high.
- **Two populations at most.** f₃, f₄ and D statistics, and statistics that need haplotypes or positions (LD, haplotype statistics), cannot be computed from a two-population SFS.

## How to cite

> Ghane A (2026) iDemoSFS: an interactive tool for demographic history and the expected SFS. Version 0.2.1-beta. https://github.com/amnghn/iDemoSFS

See [`CITATION.cff`](CITATION.cff). Please also cite the methods the tool builds on, in particular moments (Jouganous et al. 2017, Genetics 206: 1549–1567, doi:10.1534/genetics.117.200493).

## Licences

- **Code:** MIT licence ([`LICENSE`](LICENSE)).
- **Teaching text and documentation:** CC BY 4.0 ([`LICENSE-CONTENT.md`](LICENSE-CONTENT.md)).

## AI declaration

This web tool was developed with the help of Claude Code (Anthropic), an AI coding assistant. The author designed the tool, wrote the instructions, reviewed the code and the teaching text, and checked the results. The full prompt used to build the tool is in [`docs/PROMPT.md`](docs/PROMPT.md); a record of all changes is in [`CHANGELOG.md`](CHANGELOG.md).

## Repository layout

```
app/                  Vite + TypeScript front end
  src/engine/         SFS engine (port of moments 1.7.1), Web Worker, limits
  src/stats/          statistics as weights, parsers, residuals, VCF reader
  src/ui/             controls, plots, history diagram, tabs
  src/content/        teaching text (Markdown + KaTeX, citations resolved at build time)
  scripts/            content build, engine CLI (validation), headless browser check
  test/               Vitest suites and fixtures from moments, dadi, egglib and scikit-allel
validation/           Python validation (moments, dadi, msprime, tskit, scikit-allel, egglib), SLURM scripts
docs/                 DESIGN.md, VALIDATION.md, REFERENCES.bib, PROMPT.md, related tools
tools/                reference and link checks
.github/workflows/    GitHub Pages build and deployment
```

## Contact and feedback

Author: Amin Ghane, PhD student in Ecology and Evolution, Department of Botany and Biodiversity Research, University of Vienna. Contact: aminghane [at] univie.ac.at. Ideas, suggestions and bug reports are very welcome, by email or through the [GitHub Issues](https://github.com/amnghn/iDemoSFS/issues) of this repository.
