# Prompt for Claude Code on LiSC: Interactive web app "Demographic history and the expected SFS"

**Working directory:** `/lisc/data/scratch/botany/amin/demographic_inference/Interactive_DemoHis_expSFS`

---

## 0. How to work (read first)

- You are running on LiSC, the University of Vienna HPC cluster (SLURM, EasyBuild modules). This is shared infrastructure. Work in **Plan mode first**. Do not run long or heavy jobs on the login node. Anything that takes more than a few minutes (for example msprime validation runs) must go through `sbatch`.
- All shell scripts start with `set -euo pipefail`. In non-interactive SLURM jobs, `conda activate` may fail unless you first run `eval "$(conda shell.bash hook)"`. Avoid `sort | head` pipelines under `pipefail`; use `awk -v n="$N" 'NR<=n'`.
- Keep everything inside the working directory. Do not install anything system-wide. Do not push to any remote repository. I will do the `git push` myself.
- There are three **stop points** (marked **⏸ STOP**) where you must stop, summarise, and wait for my approval.
- Language for all text in the app: plain English, simple grammar, short sentences, but academic and formal. British spelling.
- Figures and colours: colourblind-safe palettes only (for example Okabe–Ito for categories, viridis/cividis for heatmaps).
- **Never invent a reference.** Every reference in the app must be verified (see Section 7).

---

## 1. Goal

Build an **interactive, public web app** that teaches how **demographic history shapes the expected Site Frequency Spectrum (SFS)**.

The user changes the population history (sizes, times, growth type, split, migration, admixture). The app then updates, **together and immediately**:

1. a drawing of the demographic history, and
2. the expected SFS (1D and 2D, folded and unfolded), and
3. a few summary statistics.

The app is for students and researchers in ecology and evolution. It must explain, in simple language, *why* each history leaves its own signature in the SFS.

The app must cover these four topics:

1. Constant size (equilibrium, standard neutral model)
2. Population expansion
3. Population bottlenecks and contractions
4. Population structure, admixture and migration

It must be **free and open for everyone online**. LiSC cannot host a public website, so the final product must be a **static website** that I can publish on **GitHub Pages** (no server, no login). LiSC is only the place where you build, test and validate it.

---

## 2. Controls (model builder)

The design of the controls follows the "model with structure" idea from GADMA/GADMA2 (Noskova et al. 2020, 2023). My reference screenshot shows:

- **Structure (2, 1):** two time epochs in the ancestral population before the split, and one epoch in each daughter population after the split. Each epoch has its own size and its own size-change dynamics.
- A **toggle panel** with: Migration, Symmetric migration, Migration masks, Selection rate, Dominance rate, Inbreeding, and Dynamics (Sudden, Linear, Exponential). Each toggle switches a feature on or off.

Implement this as follows.

### 2.1 Mode
- **One population** (1D SFS)
- **Two populations** (joint 2D SFS, plus the two marginal 1D spectra)

### 2.2 Structure
- Number of ancestral epochs: 1–3.
- Number of epochs after the split, per population: 1–3 (two-population mode only).
- Show the current structure as text, for example `Structure: (2, 1)`.

### 2.3 Per-epoch parameters
- Relative size at the end of the epoch, ν = N / N_ref (log slider, for example 0.01–100).
- Duration of the epoch, T (in units of 2·N_ref generations, the dadi/moments convention).
- Dynamics: **Sudden** (step change), **Linear**, **Exponential**. Each dynamics option is also a global toggle, as in the screenshot. When a dynamics type is switched off, it disappears from the per-epoch menus.

### 2.4 Two-population features
- Split time and the initial size of each daughter population (or a split fraction).
- **Migration** on/off. When on: rates M12 and M21 (scaled, M = 2·N_ref·m), per epoch.
- **Symmetric migration** on/off (one slider sets both rates).
- **Migration masks** on/off. When on, the user can switch off migration in a given direction and a given epoch (for example "secondary contact only" or "ancient migration only").
- **Admixture pulse**: time of the pulse, direction, and admixture fraction f. Put this here because it is part of topic 4.

### 2.5 Advanced toggles (off by default, in a collapsible "Advanced" panel)
- **Selection**: scaled selection coefficient γ = 2·N_ref·s (negative = purifying, positive = positive selection).
- **Dominance**: dominance coefficient h (0 = recessive, 0.5 = additive, 1 = dominant). Only active when selection is on.
- **Inbreeding**: inbreeding coefficient F per population, following the method of Blischak et al. (2020).
- **Ancestral misidentification** (optional, nice for teaching): a small error rate ε that moves some sites from bin i to bin n−i in the unfolded SFS. This shows why people fold the SFS.

### 2.6 Sampling and display
- Sample size per population (number of haploid chromosomes, or diploid individuals × 2). Keep defaults small (for example n = 20 per population) so the app stays fast.
- **Folded / Unfolded** switch.
- Y axis: counts (scaled by θ) or proportions; linear or log scale.
- Option to **overlay the standard neutral expectation** (E[ξᵢ] ∝ 1/i) and to show the **ratio** SFS / neutral SFS. The ratio plot makes small differences easy to see.
- Option to **pin** the current spectrum as a grey "ghost", so the user can compare before and after a change.
- θ = 4·N_ref·μ·L: either a slider, or show proportions only. Optional "physical units" panel: given N_ref, generation time and μ, convert times to years and sizes to individuals.

### 2.7 Presets (one click)
- Standard neutral model
- Recent expansion (sudden and exponential)
- Ancient expansion (to show that old events are "forgotten")
- Bottleneck with recovery (vary severity and timing)
- Recent contraction
- Split, no gene flow (isolation)
- Isolation with migration (IM)
- Secondary contact
- Admixture pulse
- Structured population sampled as one (two demes with migration, but the user looks at only one deme, or pools both). This shows that structure can mimic a bottleneck or a size change (Ptak & Przeworski 2002; Städler et al. 2009; Chikhi et al. 2010; Mazet et al. 2016).

---

## 3. Outputs (all linked, all live)

1. **Demographic history diagram.** A "tube" drawing in the style of the screenshot and of `demesdraw` (Gower et al. 2022): width = population size, vertical axis = time, arrows = migration, a separate arrow for an admixture pulse. Dashed outlines are fine. It must redraw immediately when any parameter changes.
2. **1D SFS** bar plot (folded or unfolded), with optional neutral overlay, ratio plot and ghost.
3. **2D joint SFS** heatmap (log colour scale, colourblind-safe), with the two marginal 1D spectra on the sides. Folded 2D SFS must follow the dadi/moments convention (fold on the global minor allele, mask the folded half).
4. **Summary statistics panel**: a compact live view of the main statistics for the current model. The full list, formulas and visualisations are in Section 3A.
5. **"What changed?" text box.** A short, rule-based sentence that explains the current shape, for example: *"Excess of rare variants compared with the neutral model. This is the expected signal of recent population growth: many new mutations sit on the long external branches of a star-like genealogy."*
6. **Export:** download the current SFS as CSV and as a dadi/moments `.fs` text file, the current figure as PNG/SVG, and the current model as a **Demes YAML** file. Also allow sharing the current state through the URL (parameters in the query string).

Linking: the plot area and the history diagram must update together, with no "Run" button for normal sizes. If one calculation takes longer than about 200 ms, show a small spinner and keep the old plot visible until the new one is ready (debounce slider input).

---

## 3A. Population genetic statistics: calculator and visualisation

Most classic diversity and divergence statistics are **linear functions of the SFS**. Each one gives a different weight to each frequency bin (Achaz 2009). The app should calculate them, explain them, and show them visually. Put this in its own tab, **"Statistics"**, and also show a compact version next to the SFS plot.

### 3A.1 Two input sources
1. **Model mode:** statistics from the *expected* SFS of the current demographic model. They update live with the sliders.
2. **Calculator mode (user data):** the user uploads or pastes an *observed* SFS and gets the same statistics and plots. Accept:
   - dadi/moments `.fs` files (1D and 2D, folded or unfolded, with mask);
   - ANGSD `realSFS` output (1D and 2D; Korneliussen et al. 2014);
   - easySFS output (dadi format);
   - a plain comma- or space-separated matrix.
   The user must give the **sample sizes** and the **total number of sites L**, including monomorphic sites. Without L, only "per-dataset" values (θ, not θ per site) can be shown; show a clear warning. If the file has the monomorphic corner bins, use them to get L.
   Allow the user to overlay the observed SFS on the expected SFS of the current model, with a residual plot (Anscombe or Poisson residuals, as in dadi/moments).

### 3A.2 Statistics to compute

Notation: n = number of sampled chromosomes, ξᵢ = number of sites with i derived copies (unfolded), ηᵢ = folded SFS, aₙ = Σ_{k=1}^{n−1} 1/k, L = total number of sites. Report each θ both per dataset and per site (÷ L).

**One population (from the 1D SFS, or from each margin of the 2D SFS)**

| Statistic | From the SFS | Folded OK? |
|---|---|---|
| Segregating sites S | Σ ξᵢ | yes |
| Watterson's θ_W | S / aₙ (Watterson 1975) | yes |
| Nucleotide diversity θ_π (= π) | Σ i(n−i) ξᵢ / C(n,2) (Tajima 1983) | yes |
| θ_H | Σ i² ξᵢ / C(n,2) (Fay & Wu 2000) | no |
| θ_L | Σ i ξᵢ / (n−1) (Zeng et al. 2006) | no |
| Singleton-based θ (θ_ξ₁, θ_η) | Fu & Li (1993) | θ_η yes |
| Tajima's D | (θ_π − θ_W) / √Var (Tajima 1989) | yes |
| Fu and Li's D and F; D* and F* | Fu & Li (1993) | D*, F* yes |
| Fay and Wu's H (normalised) | θ_π − θ_H (Fay & Wu 2000; Zeng et al. 2006) | no |
| Zeng's E | θ_L − θ_W (Zeng et al. 2006) | no |

**Two populations (from the joint 2D SFS ξᵢⱼ, with i copies in pop 1 out of n₁ and j copies in pop 2 out of n₂)**

| Statistic | From the joint SFS | Folded OK? |
|---|---|---|
| π₁, π₂ | from each margin, as above | yes |
| d_xy (absolute divergence) | Σ ξᵢⱼ · [i(n₂−j) + j(n₁−i)] / (n₁n₂), then ÷ L (Nei & Li 1979; Nei 1987) | yes (symmetric when both pops are flipped) |
| d_a (net divergence) | d_xy − (π₁ + π₂)/2 (Nei & Li 1979) | yes |
| Hudson's F_ST | 1 − [(π₁+π₂)/2] / d_xy, as a **ratio of averages** across sites (Hudson et al. 1992; Bhatia et al. 2013) | yes |
| Weir and Cockerham's θ (F_ST) | Σ a / Σ (a + b + c) over sites (Weir & Cockerham 1984), ratio of averages. See 3A.2b | yes |
| Fixed differences | ξ_{n₁,0} + ξ_{0,n₂} | partly |
| Shared polymorphisms | Σ ξᵢⱼ with 0<i<n₁ and 0<j<n₂ | yes |
| Private polymorphisms in pop 1 / pop 2 | Wakeley & Hey (1997) categories | yes |
| f₂(pop1, pop2) | from the joint SFS (Peter 2016) | yes |
| Tajima's D, θ_W, θ_π per population | from each margin | yes |

**Implementation rules**
- Write all statistics as **weight vectors (1D) or weight matrices (2D) applied to the SFS**. One function computes "statistic = Σ weight × SFS". This keeps the code simple and makes the visualisation in 3A.3 easy.
- For folded spectra, give only the statistics that are defined. Grey out the others with a short tooltip: *"Needs the unfolded SFS (an outgroup to polarise alleles)."*
- In model mode, a normalised statistic like Tajima's D is calculated as a **ratio of expectations**, not the expected value of D across loci. Say this clearly in the app.
- Use the variance formulas from the original papers for D, Fu & Li's tests, H and E. Unit-test them against published worked examples or a trusted implementation.

### 3A.2b Two F_ST estimators: Hudson and Weir & Cockerham
Show **both**, side by side, with a toggle to plot either one or both. Treat this as a teaching feature, not only as two numbers.

- **Hudson's F_ST** (Hudson et al. 1992; Bhatia et al. 2013): 1 − π_within / π_between. It compares diversity inside populations with diversity between them, so it links directly to coalescence times (Slatkin 1991). It is defined for the two populations that were sampled, and it does not depend much on the sample sizes.
- **Weir and Cockerham's θ** (Weir & Cockerham 1984): an analysis-of-variance estimator. It treats the sampled populations as replicates from a set of populations, and it weights each population by its sample size.
- **Implementation from the SFS:** for each cell (i, j) of the joint SFS, use p₁ = i/n₁ and p₂ = j/n₂, with sample sizes in diploid individuals (n₁/2, n₂/2). Compute the WC variance components a, b and c for that cell, and give each its own weight matrix. Then θ_WC = Σ(w_a·ξ) / Σ((w_a + w_b + w_c)·ξ). Hudson works the same way: one weight matrix for the numerator and one for the denominator.
- **Heterozygosity term and the HWE toggle:** WC needs the observed heterozygosity h̄. The SFS contains allele counts only, not genotypes, so h̄ must come from somewhere else. Add an **"Assume Hardy–Weinberg proportions"** toggle (on by default) with these options:
  1. **HWE on:** h̄ = 2p(1−p) at every site.
  2. **HWE off, give F_IS per population:** h̄ = 2p(1−p)(1 − F_IS). In model mode, F_IS comes from the inbreeding toggle (F). In calculator mode, the user types a genome-wide F_IS or a genome-wide observed heterozygosity (H_obs) for each population; convert H_obs to F_IS with F_IS = 1 − H_obs/H_exp. Explain that this assumes the same F_IS at every site, so it is an approximation.
  3. **HWE off, exact (optional, calculator mode only):** the user uploads per-site genotype counts (a table with columns hom-ref / het / hom-alt per population, which is easy to make with `bcftools +fill-tags` or `vcftools --hardy`), or a small VCF (set a size limit, for example 50 MB, and parse it in a Web Worker). Then compute WC from the real per-site h̄. This is the only exact option, and it no longer uses the SFS alone; say this clearly.
  4. **Haploid option:** WC without the h̄ term, for haploid or pooled data.
  Also report **F_IS** itself (the WC f component) whenever h̄ is known.
  Show which option is in use next to every WC value. Hudson's F_ST uses allele frequencies only, so the HWE toggle does not change it; say this in the UI.
- **Teaching plot for the HWE toggle:** WC θ and Hudson F_ST against F_IS (0 to 0.9) for a fixed model. WC moves and Hudson stays flat. Add a short note that a deficit of heterozygotes can come from inbreeding or selfing, from hidden structure inside a sample (Wahlund effect), or from genotyping errors (for example allelic dropout at low coverage). The SFS alone cannot test for HWE; that needs genotypes.
- **Keep two effects separate in the text:** (a) inbreeding changes the **expected SFS** itself (Blischak et al. 2020; the inbreeding toggle in Section 2.5); (b) the HWE toggle only changes how **WC's estimator** uses heterozygosity. In model mode, switching on inbreeding should change both, and the app should explain why.
- **Always ratio of averages.** For both estimators, sum the numerators and denominators across sites before dividing (Bhatia et al. 2013). Add a short note on why the "average of ratios" gives different values.
- **Teaching plots:**
  1. Both estimators against the **sample size ratio** n₁/n₂, with the model kept fixed. The WC estimate can change with the ratio; Hudson's should stay nearly flat (Bhatia et al. 2013).
  2. Both estimators against a **minor allele frequency filter** (0, 1, 5, 10 %). This shows how rare variants affect the values.
  3. Both estimators against **split time** and **migration rate**, in the parameter sweep.
- **Explanation card:** "Why are there two F_ST values, and which one should I report?" Keep it short and neutral: the two estimators target slightly different quantities. Hudson is easier to interpret with very unequal sample sizes and in genome scans. WC is the long-standing standard for genotype data and is used by many programs, for example VCFtools. Report which one you used, with the ratio-of-averages method, so results can be compared.
- **Validation:** compare the WC values with `scikit-allel` (`weir_cockerham_fst` and `hudson_fst`) on simulated genotypes. Test both HWE genotypes and genotypes with a heterozygote deficit (for example by simulating selfing or by pairing haplotypes non-randomly with a known F). With the exact per-site genotype option, the app must match scikit-allel to numerical precision. With the F_IS approximation, report the size of the error.

### 3A.3 Visualisations
1. **Estimator weights plot (key teaching figure).** For the current n, plot the weight each θ estimator gives to each SFS bin: θ_W (flat), θ_π (peaks at intermediate frequencies), θ_H (high-frequency derived alleles), θ_L, singleton-based θ. Draw it on top of the current SFS. The user sees directly *why* D < 0 when rare variants are in excess, and why H responds to high-frequency derived alleles. Base the explanation on Achaz (2009).
2. **2D weight heatmaps.** For π₁, π₂ and d_xy, show the weight matrix next to the joint SFS. This shows which parts of the joint SFS (axes, diagonal, corners) drive each statistic.
3. **Statistics over a parameter sweep.** The user picks one parameter (for example split time T, migration rate M, bottleneck strength) and a range. The app plots several statistics against that parameter, for example F_ST, d_xy, d_a, π₁ and π₂ against split time with and without migration. Use this to explain the point of Cruickshank & Hahn (2014): F_ST can be high because diversity inside populations is low, not because divergence is high. d_xy and d_a help to tell these cases apart.
4. **Model vs data panel** (calculator mode): observed and expected values side by side for every statistic. Do not show p-values unless they come from a proper method; say that the expected values ignore linkage and sampling variance.
5. **"What does this statistic tell me?" cards.** One short card per statistic: definition in one sentence, which SFS bins drive it, what pushes it up or down (expansion, bottleneck, structure, selection, migration), and one common mistake when interpreting it.

### 3A.4 Statistics that the SFS **cannot** give
Add a short box in the app that lists statistics the SFS cannot give, and explains why: they need haplotypes, linkage or positions along the genome. Examples: LD (r², Z_nS), haplotype statistics (Fu's F_S, H12, EHH, iHS), and the genomic location of windows. f₃/f₄/D-statistics need three or more populations, so they are out of scope for a 2-population SFS. List them as possible future extensions.

### 3A.5 Validation of the statistics
- Simulate tree sequences with msprime for a few presets. Compute diversity, divergence, F_ST, segregating sites and Tajima's D directly with **tskit** (`ts.diversity`, `ts.divergence`, `ts.Fst`, `ts.segregating_sites`, `ts.Tajimas_D`, in "site" mode). Then compute them again from the SFS of the same simulation (`ts.allele_frequency_spectrum`) with your TS functions. The two must agree to numerical precision.
- Cross-check π, θ_W and Tajima's D on 1–2 small VCFs with **scikit-allel**.
- Add these checks to `docs/VALIDATION.md`.

---

## 4. Teaching content (written in the app)

Write these sections in plain, simple English. Use short paragraphs, one small figure or animation each where useful, and cite the references inline (author, year, with a link).

1. **Introduction: What is the SFS?** The SFS is a histogram. Bin i counts the sites where the derived allele is found i times in a sample of n chromosomes. Explain derived vs ancestral alleles, the need for an outgroup, and folded vs unfolded spectra.
2. **Why does history change the SFS?** A mutation that falls on a branch above i sampled lineages appears in bin i. So the expected SFS is a weighted sum of **branch lengths** of the genealogy (Fu 1995; Griffiths & Tavaré 1998). Population size controls the speed of coalescence: small populations coalesce fast, large populations coalesce slowly (Kingman 1982; Hudson 1990). So the shape of the genealogy, and therefore the SFS, carries the history. Include a small schematic of a "star-like" tree (expansion) vs a "long internal branches" tree (contraction / structure).
3. **Constant size.** E[ξᵢ] = θ / i (Watterson 1975; Fu 1995). This is the baseline. Tajima's D ≈ 0.
4. **Expansion.** Star-like genealogy, long external branches, excess of singletons, negative Tajima's D (Tajima 1989; Slatkin & Hudson 1991). Old expansions leave weaker signals.
5. **Bottlenecks and contractions.** Many lineages coalesce during the bottleneck. The result depends on severity and timing: loss of rare variants and a relative excess of intermediate frequencies (positive D) soon after, and an excess of rare variants again during recovery (Tajima 1989; Marth et al. 2004).
6. **Structure, migration and admixture.** In the 2D SFS: after a split without gene flow, mass moves to the axes (private alleles) and, with time, to the corners (fixed differences). Migration pulls mass back to the diagonal (shared alleles). An admixture pulse creates shared alleles at intermediate frequencies (Wakeley & Hey 1997; Chen et al. 2007; Gutenkunst et al. 2009). Structure inside "one" population can produce an SFS that looks like a bottleneck (Ptak & Przeworski 2002; Städler et al. 2009; Chikhi et al. 2010; Mazet et al. 2016).
7. **Selection, dominance and inbreeding (advanced).** Purifying selection makes the SFS more skewed to rare variants; positive selection pushes derived alleles to high frequency (Sawyer & Hartl 1992; Williamson et al. 2005; Kim et al. 2017). Dominance changes how strongly selection acts at low frequency (Huber et al. 2018). Inbreeding changes genotype frequencies and therefore the sampled SFS (Blischak et al. 2020). Point out that selection and demography can produce similar signals.
8. **Limits of the SFS.** Different histories can give almost the same expected SFS (Myers et al. 2008; Terhorst & Song 2015; Rosen et al. 2018; Lapierre et al. 2017). Explain this in simple words and show one example pair inside the app if possible.
9. **From the expected SFS to inference.** One short paragraph on how dadi, moments, fastsimcoal2, momi2 and GADMA compare an observed SFS with the expected SFS, and how Demes/stdpopsim help to share models (Gutenkunst et al. 2009; Excoffier et al. 2013; Jouganous et al. 2017; Kamm et al. 2020; Noskova et al. 2023; Gower et al. 2022; Adrion et al. 2020). Include a short note on common modelling mistakes (Ragsdale et al. 2020).
10. **Guided exercises.** 5–8 short "Try this" tasks with a hidden answer, for example: *"Make the bottleneck more recent. What happens to the singleton bin? Why?"*
11. **Glossary.** SFS, derived allele, θ, N_e, coalescence, epoch, ν, T, M, γ, h, F, folded, projection.

---

## 4A. About page, disclaimer, AI declaration and change log

### 4A.1 "About" page
Add an **About** page, linked from the main menu and the footer. Content (plain, formal English):

- **Who made it:** Amin Ghane, PhD student in Ecology and Evolution, Department of Botany and Biodiversity Research, University of Vienna.
- **Contact:** `[EMAIL_PLACEHOLDER]`. **Do not invent or guess an email address.** Keep this placeholder and ask me for the address at STOP 3. Show the email in a form that is hard for spam bots to read (for example built with JavaScript, or written as "name [at] domain"), with a `mailto:` link for real users.
- **Feedback:** say that new ideas, suggestions and bug reports are very welcome, by email or through GitHub Issues (link to the repository's Issues page; use a placeholder URL until I give you the repository name).
- **How to cite:** link to `CITATION.cff` and show a short citation with the version number.
- **Licence:** MIT for the code. Teaching text under CC BY 4.0 (ask me at STOP 1 if this is fine).

### 4A.2 Beta disclaimer
- Show a small, permanent **"Beta"** badge next to the app title, and the version number (for example `v0.1.0-beta`) in the footer.
- On the About page, add a **Disclaimer** section with this meaning (polish the wording, but keep all points):
  > This tool is a beta version and a work in progress. It is provided "as is", without warranty of any kind. Use it at your own risk. I have tried to be careful, and the calculations were checked against established software (see the validation report), but I cannot guarantee that all calculations are accurate or correct. Please check important results with established tools such as dadi, moments, msprime or scikit-allel before you use them in research or publications. If you find an error, please report it.
- Show a one-line version of the disclaimer in the footer of every page, with a link to the full text.

### 4A.3 AI declaration
On the About page, add an **AI Declaration** section with this meaning:
> This web tool was developed with the help of Claude Code (Anthropic), an AI coding assistant. The author designed the tool, wrote the instructions, reviewed the code and the teaching text, and checked the results. The full prompt used to build the tool is available in the GitHub repository (`docs/PROMPT.md`). A record of all changes is in `CHANGELOG.md`.

- Save this prompt, exactly as I gave it to you, as `docs/PROMPT.md`. If I give you later instructions or changes, add them below the original under a heading "Follow-up instructions", with the date. Do not edit the original text.
- Link both files from the About page (to the GitHub versions; use placeholder URLs until the repository exists).

### 4A.4 Change log
- Create `CHANGELOG.md` in the repository root at the start of Phase 0. Follow the "Keep a Changelog" style (sections Added / Changed / Fixed / Removed).
- **Update it after every step**, not only at the end. A "step" means any finished unit of work: a phase, a stop point, a new feature, a bug fix, a validation run, or a change to the references.
- Every entry has a **timestamp** in ISO 8601 format with the Vienna time zone, for example `2026-11-18T14:05+01:00`. Use `TZ=Europe/Vienna date -Iminutes` to get it; never write the time from memory.
- Each entry says briefly what changed, which files changed, and (for validation runs) the main result.
- Show the current version and the date of the last change on the About page (read them from `CHANGELOG.md` or `package.json` at build time).
- Use semantic versioning with a `-beta` suffix until I decide to drop it.

---

## 5. Technical design

### 5.1 Engine options (decide in Phase 0)
The app needs an engine that computes the expected SFS in the browser, fast enough for live sliders. Compare these options in a short design note and recommend one:

- **(A) Pure client-side engine (TypeScript/JavaScript).** Port the **moment equations** of `moments` (Jouganous et al. 2017) for drift, mutation, migration, size change, split and admixture, for 1D and 2D with small sample sizes. Neutral 1D can also use the coalescent formulas for piecewise size changes (Polanski & Kimmel 2003; Marth et al. 2004) as an independent check. *This is my preferred default*, because it gives a free static site with no server.
- **(B) Python in the browser (Pyodide).** Check honestly whether `moments` or `dadi` can run in Pyodide (they contain compiled extensions; they probably cannot without work).
- **(C) Precomputed grids.** Compute spectra on LiSC with `moments`/`dadi` over a parameter grid and interpolate in the browser. Use this only for the advanced features (selection, dominance, inbreeding) if the JS port of those parts is too hard.
- **(D) Python server app** (for example Shiny for Python or Panel). Only mention it as a fallback; it needs a hosting service.

A hybrid of A (neutral demography, migration, admixture) and C (advanced features) is acceptable if you can justify it.

### 5.2 Front end
- Build with **Vite + TypeScript**. Plots with **D3** or **Plotly.js** (your choice; justify it). No heavy framework is needed; a small one (Svelte or plain TS) is fine.
- Run the engine in a **Web Worker** so the page never freezes.
- Responsive layout (laptop and tablet). Keyboard-accessible controls. Check colour contrast.
- Math rendering with KaTeX.

### 5.3 Validation environment on LiSC
- Create a conda/mamba environment inside the working directory (for example `./envs/sfs-validate`) with: `moments-popgen` (note: **not** `moments`), `dadi`, `msprime`, `tskit`, `scikit-allel`, `demes`, `demesdraw`, `numpy`, `scipy`, `matplotlib`, `pytest`.
- Node.js: first check `module avail nodejs`; otherwise install `nodejs` from conda-forge into a separate local environment.
- To preview the site, run `npm run dev` or `npm run preview` on a port; I will forward the port with VS Code Remote-SSH. Do not open public ports.

### 5.4 Validation (required, not optional)
1. **Analytic check:** constant size must give E[ξᵢ] = θ/i to machine precision (or to the closure error of the method; report it).
2. **Reference engine check:** for at least 30 test models covering every preset and every dynamics type, compare your engine with `moments` (and `dadi` for inbreeding). Report the maximum relative error per bin. Target: < 1 % for bins with non-trivial mass.
3. **Simulation check:** for at least the presets, simulate with **msprime** (Baumdicker et al. 2022) through `demes` YAML, using many replicates via a SLURM array job, and show that the mean simulated SFS matches the expected SFS within Monte Carlo error.
4. **Folding check:** folded = fold(unfolded), for 1D and 2D.
5. Unit tests: **Vitest** for the TS engine, **pytest** for the Python validation scripts.
6. Write `docs/VALIDATION.md` with plots (PNG 300 dpi + PDF) and a table of errors.

Use a CSV-driven SLURM array for the validation runs (one row per test model; row index = `SLURM_ARRAY_TASK_ID + 2` to skip the header).

### 5.5 Repository layout (suggested)
```
Interactive_DemoHis_expSFS/
  app/                 # Vite + TS front end
    src/engine/        # SFS engine (TS), runs in a Web Worker
    src/stats/         # SFS-based statistics as weight vectors/matrices, file parsers
    src/ui/            # controls, plots, history diagram
    src/content/       # teaching text (Markdown), references (BibTeX/CSL-JSON)
  validation/          # Python: moments/dadi/msprime comparisons, SLURM scripts
    models.csv
    slurm/
  docs/
    DESIGN.md          # Phase 0 design note
    VALIDATION.md
    REFERENCES.bib
    PROMPT.md          # this prompt, unchanged, plus dated follow-up instructions
  .github/workflows/   # GitHub Pages build and deploy (prepared, not pushed)
  CHANGELOG.md         # updated after every step, with timestamps
  README.md
  LICENSE              # MIT for code
  CITATION.cff
```

---

## 6. Phases and stop points

**Phase 0 – Plan and design note.**
- Read Sections 1–7. Check the LiSC environment (modules, conda, node, internet access to PyPI, npm and doi.org).
- Write `docs/DESIGN.md`: engine choice (Section 5.1) with pros and cons, numerical method (for example how you integrate the moment ODEs, time step control, closure for selection), expected speed for n = 20 (1D) and n = 20 × 20 (2D), the UI wireframe (ASCII is fine), and the full list of references after verification.
- **⏸ STOP 1:** show me the design note and wait.

**Phase 1 – Engine and validation.**
- Build the engine and the validation pipeline (Section 5.4). Submit SLURM jobs for msprime.
- **⏸ STOP 2:** show me `docs/VALIDATION.md` and the speed benchmarks. Wait.

**Phase 2 – Front end and content.**
- Build the UI, the linked history diagram, all plots, presets, exports, URL sharing, and the teaching text.
- Build the Statistics tab (Section 3A): model mode, calculator mode with file upload, the weights plots, the parameter sweep and the statistic cards.
- Prepare (do not run) the GitHub Actions workflow for GitHub Pages.
- Build the About page, the Beta badge, the disclaimer and the AI declaration (Section 4A).
- **⏸ STOP 3:** give me the preview command, a list of features, known limitations, and the exact `git` commands I need to publish it. Ask me for my contact email and the GitHub repository URL, and replace the placeholders only after I answer.

At every stop point, first update `CHANGELOG.md`.

---

## 7. References

### 7.1 Rules
- Use **only** the references below, plus any extra ones you can **verify** by resolving the DOI (for example `https://doi.org/<DOI>` or the Crossref API). Check title, authors, year and journal.
- If a DOI does not resolve, or the details do not match, **remove the reference** and list it in `docs/DESIGN.md` under "Unverified – removed". Never guess a DOI.
- Store all references in `docs/REFERENCES.bib` and show them in the app as a reference list with DOI links.
- Do not copy long passages from papers into the app. Write the teaching text in your own words.

### 7.2 Starting reference list
DOIs marked † were checked when this prompt was written. Verify all others before use.

**Coalescent and SFS theory**
- Kingman JFC (1982) The coalescent. *Stochastic Processes and their Applications* 13: 235–248.
- Hudson RR (1990) Gene genealogies and the coalescent process. *Oxford Surveys in Evolutionary Biology* 7: 1–44.
- Watterson GA (1975) On the number of segregating sites in genetical models without recombination. *Theoretical Population Biology* 7: 256–276.
- Tajima F (1989) Statistical method for testing the neutral mutation hypothesis by DNA polymorphism. *Genetics* 123: 585–595.
- Tajima F (1989) The effect of change in population size on DNA polymorphism. *Genetics* 123: 597–601. doi:10.1093/genetics/123.3.597
- Slatkin M, Hudson RR (1991) Pairwise comparisons of mitochondrial DNA sequences in stable and exponentially growing populations. *Genetics* 129: 555–562.
- Fu Y-X (1995) Statistical properties of segregating sites. *Theoretical Population Biology* 48: 172–197.
- Griffiths RC, Tavaré S (1998) The age of a mutation in a general coalescent tree. *Communications in Statistics. Stochastic Models* 14: 273–295.
- Fay JC, Wu C-I (2000) Hitchhiking under positive Darwinian selection. *Genetics* 155: 1405–1413.
- Polanski A, Kimmel M (2003) New explicit expressions for relative frequencies of single-nucleotide polymorphisms with application to statistical inference on population growth. *Genetics* 165: 427–436. doi:10.1093/genetics/165.1.427 †
- Achaz G (2009) Frequency spectrum neutrality tests: one for all and all for one. *Genetics* 183: 249–258.
- Wakeley J (2009) *Coalescent Theory: An Introduction.* Roberts & Company.
- Nielsen R, Slatkin M (2013) *An Introduction to Population Genetics: Theory and Applications.* Sinauer.

**Demography and the SFS (single population)**
- Marth GT, Czabarka E, Murvai J, Sherry ST (2004) The allele frequency spectrum in genome-wide human variation data reveals signals of differential demographic history in three large world populations. *Genetics* 166: 351–372. doi:10.1534/genetics.166.1.351 †
- Williamson SH, Hernandez R, Fledel-Alon A, Zhu L, Nielsen R, Bustamante CD (2005) Simultaneous inference of selection and population growth from patterns of variation in the human genome. *PNAS* 102: 7882–7887.

**Joint SFS, structure, migration and admixture**
- Wakeley J, Hey J (1997) Estimating ancestral population parameters. *Genetics* 145: 847–855. doi:10.1093/genetics/145.3.847 †
- Chen H, Green RE, Pääbo S, Slatkin M (2007) The joint allele-frequency spectrum in closely related species. *Genetics* 177: 387–398. doi:10.1534/genetics.107.070730 †
- Ptak SE, Przeworski M (2002) Evidence for population growth in humans is confounded by fine-scale population structure. *Trends in Genetics* 18: 559–563.
- Städler T, Haubold B, Merino C, Stephan W, Pfaffelhuber P (2009) The impact of sampling schemes on the site frequency spectrum in nonequilibrium subdivided populations. *Genetics* 182: 205–216.
- Chikhi L, Sousa VC, Luisi P, Goossens B, Beaumont MA (2010) The confounding effects of population structure, genetic diversity and the sampling scheme on the detection and quantification of population size changes. *Genetics* 186: 983–995.
- Mazet O, Rodríguez W, Grusea S, Boitard S, Chikhi L (2016) On the importance of being structured: instantaneous coalescence rates and human evolution—lessons for ancestral population size inference? *Heredity* 116: 362–371.

**Selection, dominance and inbreeding**
- Sawyer SA, Hartl DL (1992) Population genetics of polymorphism and divergence. *Genetics* 132: 1161–1176.
- Kim BY, Huber CD, Lohmueller KE (2017) Inference of the distribution of selection coefficients for new nonsynonymous mutations using large samples. *Genetics* 206: 345–361.
- Huber CD, Durvasula A, Hancock AM, Lohmueller KE (2018) Gene expression drives the evolution of dominance. *Nature Communications* 9: 2750. doi:10.1038/s41467-018-05281-7 †
- Blischak PD, Barker MS, Gutenkunst RN (2020) Inferring the demographic history of inbred species from genome-wide SNP frequency data. *Molecular Biology and Evolution* 37: 2124–2136. doi:10.1093/molbev/msaa042 †

**Diversity, divergence and differentiation statistics (Section 3A)**
- Tajima F (1983) Evolutionary relationship of DNA sequences in finite populations. *Genetics* 105: 437–460.
- Nei M, Li W-H (1979) Mathematical model for studying genetic variation in terms of restriction endonucleases. *PNAS* 76: 5269–5273.
- Nei M (1987) *Molecular Evolutionary Genetics.* Columbia University Press.
- Fu Y-X, Li W-H (1993) Statistical tests of neutrality of mutations. *Genetics* 133: 693–709.
- Hudson RR, Slatkin M, Maddison WP (1992) Estimation of levels of gene flow from DNA sequence data. *Genetics* 132: 583–589.
- Weir BS, Cockerham CC (1984) Estimating F-statistics for the analysis of population structure. *Evolution* 38: 1358–1370.
- Weir BS, Hill WG (2002) Estimating F-statistics. *Annual Review of Genetics* 36: 721–750.
- Slatkin M (1991) Inbreeding coefficients and coalescence times. *Genetical Research* 58: 167–175.
- Wahlund S (1928) Zusammensetzung von Populationen und Korrelationserscheinungen vom Standpunkt der Vererbungslehre aus betrachtet. *Hereditas* 11: 65–106.
- Danecek P, et al. (2011) The variant call format and VCFtools. *Bioinformatics* 27: 2156–2158.
- Danecek P, et al. (2021) Twelve years of SAMtools and BCFtools. *GigaScience* 10: giab008.
- Zeng K, Fu Y-X, Shi S, Wu C-I (2006) Statistical tests for detecting positive selection by utilizing high-frequency variants. *Genetics* 174: 1431–1439.
- Bhatia G, Patterson N, Sankararaman S, Price AL (2013) Estimating and interpreting FST: the impact of rare variants. *Genome Research* 23: 1514–1521.
- Cruickshank TE, Hahn MW (2014) Reanalysis suggests that genomic islands of speciation are due to reduced diversity, not reduced gene flow. *Molecular Ecology* 23: 3133–3157.
- Peter BM (2016) Admixture, population structure, and F-statistics. *Genetics* 202: 1485–1501.
- Korneliussen TS, Albrechtsen A, Nielsen R (2014) ANGSD: Analysis of Next Generation Sequencing Data. *BMC Bioinformatics* 15: 356.
- Ralph P, Thornton K, Kelleher J (2020) Efficiently summarizing relationships in large samples: a general duality between statistics of genealogies and genomes. *Genetics* 215: 779–797. (tskit statistics)

**Limits of SFS-based inference**
- Myers S, Fefferman C, Patterson N (2008) Can one learn history from the allelic spectrum? *Theoretical Population Biology* 73: 342–348.
- Terhorst J, Song YS (2015) Fundamental limits on the accuracy of demographic inference based on the sample frequency spectrum. *PNAS* 112: 7677–7682. doi:10.1073/pnas.1503717112 †
- Lapierre M, Lambert A, Achaz G (2017) Accuracy of demographic inferences from the site frequency spectrum: the case of the Yoruba population. *Genetics* 206: 439–449.
- Rosen Z, Bhaskar A, Roch S, Song YS (2018) Geometry of the sample frequency spectrum and the perils of demographic inference. *Genetics* 210: 665–682.

**Software, model formats and simulation**
- Gutenkunst RN, Hernandez RD, Williamson SH, Bustamante CD (2009) Inferring the joint demographic history of multiple populations from multidimensional SNP frequency data. *PLoS Genetics* 5: e1000695. (dadi)
- Excoffier L, Dupanloup I, Huerta-Sánchez E, Sousa VC, Foll M (2013) Robust demographic inference from genomic and SNP data. *PLoS Genetics* 9: e1003905. (fastsimcoal2)
- Jouganous J, Long W, Ragsdale AP, Gravel S (2017) Inferring the joint demographic history of multiple populations: beyond the diffusion approximation. *Genetics* 206: 1549–1567. (moments)
- Kamm J, Terhorst J, Durbin R, Song YS (2020) Efficiently inferring the demographic history of many populations with allele count data. *Journal of the American Statistical Association* 115: 1472–1487. (momi2)
- Noskova E, Ulyantsev V, Koepfli K-P, O'Brien SJ, Dobrynin P (2020) GADMA: Genetic algorithm for inferring demographic history of multiple populations from allele frequency spectrum data. *GigaScience* 9: giaa005. doi:10.1093/gigascience/giaa005 †
- Noskova E, Abramov N, Iliutkin S, Sidorin A, Dobrynin P, Ulyantsev VI (2023) GADMA2: more efficient and flexible demographic inference from genetic data. *GigaScience* 12: giad059. doi:10.1093/gigascience/giad059 †
- Kelleher J, Etheridge AM, McVean G (2016) Efficient coalescent simulation and genealogical analysis for large sample sizes. *PLoS Computational Biology* 12: e1004842. (msprime)
- Baumdicker F, et al. (2022) Efficient ancestry and mutation simulation with msprime 1.0. *Genetics* 220: iyab229.
- Adrion JR, et al. (2020) A community-maintained standard library of population genetic models. *eLife* 9: e54967. (stdpopsim)
- Gower G, Ragsdale AP, Bisschop G, Gutenkunst RN, Hartfield M, Noskova E, Schiffels S, Struck TJ, Kelleher J, Thornton KR (2022) Demes: a standard format for demographic models. *Genetics* 222: iyac131. doi:10.1093/genetics/iyac131 †
- Ragsdale AP, Nelson D, Gravel S, Kelleher J (2020) Lessons learned from bugs in models of human history. *American Journal of Human Genetics* 107: 583–588.

**Online documentation (cite as web resources in the app)**
- moments documentation: https://moments.readthedocs.io
- dadi documentation: https://dadi.readthedocs.io
- GADMA repository and documentation: https://github.com/ctlab/GADMA
- Demes specification: https://popsim-consortium.github.io/demes-spec-docs/
- msprime documentation: https://tskit.dev/msprime/docs/
- tskit statistics documentation: https://tskit.dev/tskit/docs/stable/stats.html
- scikit-allel documentation: https://scikit-allel.readthedocs.io
- easySFS repository: https://github.com/isaacovercast/easySFS

---

## 8. Definition of done

- The app runs as a static site from `app/dist/` with no server.
- All four topics are covered by presets, controls and teaching text.
- 1D and 2D, folded and unfolded, migration on/off with rates, symmetric migration, migration masks, admixture, three dynamics types, and the advanced toggles all work and update the history diagram and the SFS together.
- The Statistics tab works in model mode and in calculator mode (uploaded `.fs`, realSFS, easySFS or plain matrix). It shows the weights plots, the parameter sweep, and the list of statistics the SFS cannot give.
- The validation report shows agreement with `moments` (and `dadi` for inbreeding) and with msprime simulations, and shows that the SFS-based statistics match tskit and scikit-allel.
- Every reference is verified and linked by DOI.
- README explains how to run it locally, how to deploy to GitHub Pages, how to cite it, and the known limitations.
- The About page shows the author, the contact email (no placeholder left), the feedback invitation, the Beta disclaimer and the AI declaration, with working links to `docs/PROMPT.md` and `CHANGELOG.md`.
- `CHANGELOG.md` has a timestamped entry for every step of the work.

---

## Follow-up instructions

### 2026-11-18 (answers given in Plan mode, before Phase 0)

1. **References without a DOI** (for example Hudson 1990, Wakeley 2009, Nielsen & Slatkin 2013, possibly Nei 1987): keep them if they can be verified through a book or ISBN record (Open Library or the publisher). Label them "no DOI" and link them to the publisher or ISBN page.
2. **Log files:** keep three files. `CHANGELOG.md` is public (Keep a Changelog style, Vienna ISO 8601 timestamps). `change_log.md` (LiSC-internal detail: job IDs, paths) and `plans_ideas.md` (plans, open questions, "waiting for Amin" list) are kept local and gitignored. Update all three after every step.
3. **egglib 3.6.1** may be added to the local validation environment (`./envs/sfs-validate`). It is the trusted reference for Fu and Li's D, F, D*, F*, normalised Fay and Wu's H and Zeng's E.
4. **Git:** run `git init` in the working directory and make one local commit at each stop point. Never push; Amin pushes.

### 2026-11-18 (answers at STOP 1)

1. **All proposals in `docs/DESIGN.md` Section 11 are accepted:** MIT for the code and CC BY 4.0 for the teaching text; h̄ = 2p(1−p)·2k/(2k−1) under HWE; shared post-split epochs (GADMA style); the proposed accuracy and limits (dt_fac 0.02 final / 0.1 draft; n ≤ 40 per population in 2D, n ≤ 100 in 1D; |γ| ≤ 50; ν ∈ [0.01, 100]); plain TypeScript for the UI.
2. **Validation environment:** keep `./envs/sfs-validate` as it is (no leaner rebuild).
3. **Reference screenshots** are in `docs/reference_screenshot/`. They are an inspiration for the design, not a strict template.
4. **Nielsen & Slatkin (2013)** is a real book. Use this citation (given by Amin):
   ```
   @book{nielsen2013introduction,
     title={An introduction to population genetics: theory and applications},
     author={Nielsen, Rasmus and Slatkin, Montgomery},
     year={2013},
     publisher={Sinauer Associates, Sunderland, MA}
   }
   ```
5. **Go for Phase 1.**

### 2026-11-18 (answers at STOP 2)

1. **All proposals at STOP 2 are accepted:**
   - Selection limits: |γ| ≤ 20 in two-population mode, with a warning above 10; |γ| ≤ 50 in one-population mode, with a warning for γ > 30 when h > 0.5.
   - The internal sample sizes found in Phase 1 are kept: with selection, n = max(n, 100) in one population and max(n, 40) per population in two; with migration, max(n, 20) per population.
   - The WC F_IS caveat is shown in the app.
2. **Reference screenshots** stay out of the public repository (`docs/reference_screenshot/` is gitignored).
3. **Go for Phase 2.**

### 2026-11-19 (answers at STOP 3)

1. **Contact email:** Amin's academic address, aminghane [at] univie.ac.at. Show it on the About page (built at run time) and in the README.
2. **`existing_tools.md`** (Amin's survey of related tools) stays in the project folder but is not public: add it to `.gitignore`.
3. **GitHub repository URL:** Amin will give it later. Keep the repository placeholders until then, and remind Amin.
4. **GitHub repository URL** (given later on 2026-11-19): `https://github.com/amnghn/iDemoSFS.git`. The site will be at `https://amnghn.github.io/iDemoSFS/`.
5. **Git identity:** use Amin's GitHub noreply address for all commits (the local commits were rewritten before the first push).

### 2026-11-19 (after the first deployment)

Amin pushed the repository and set GitHub Pages to GitHub Actions; the site is at https://amnghn.github.io/iDemoSFS/. The download buttons work. Requests:

1. **Upload:** the upload button was hard to find. Make it easy to find.
2. **Theme:** the site opened in dark mode in one browser and in light mode in another. Add a button so that learners can switch between the dark and the light theme.
3. **Links:** references and all other external links (for example GitHub files and the Issues page) open in a new tab, so that the learner does not lose the app.
4. **About page:** write "Developer" instead of "Who made it".
5. **Reset button:** it clears all changes and goes back to the main page with the default parameters. Changing tabs must keep the changes.

### 2026-11-19 (search engines)

1. **Page title:** put "iDemoSFS" in the page title, for example "iDemoSFS: an interactive tool for demographic history and the expected SFS", so that a search for "iDemoSFS" finds the site.
2. **GitHub topics:** add topics such as population-genetics, site-frequency-spectrum and demographic-inference (Amin does this on GitHub).
3. **Google Search Console:** register the site so that Google indexes it sooner (Amin does this with his Google account).
4. **Name in the header and the README title:** show "iDemoSFS" there too.
5. GitHub topics and the website link were added by Amin. Google Search Console ownership tag given by Amin: `<meta name="google-site-verification" content="Y11Pu5A3iYskO289fvly20qk0cCtoevgZqeEALvQ1vQ" />`.
6. **Citation:** add "iDemoSFS" to the citation too (it now uses the page title, "iDemoSFS: an interactive tool for demographic history and the expected SFS").

