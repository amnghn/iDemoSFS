<!--
Text of the "About" tab. Placeholders in double braces are filled at run time from
src/site_config.ts and the build information (version, date of the last change).
-->

**Demographic history and the expected SFS** is a free teaching tool. It shows how changes in population size, population splits, migration and admixture shape the expected site frequency spectrum, and it computes classic statistics from expected or observed spectra. It runs entirely in your web browser: no data are sent to a server.

## Developer {#about-author}

{{AUTHOR}}, PhD student in Ecology and Evolution, {{AFFILIATION}}.

## Contact and feedback {#about-contact}

New ideas, suggestions and bug reports are very welcome. Please write to {{EMAIL}}, or open an issue on GitHub: {{ISSUES}}.

## How to cite {#about-cite}

{{CITATION}}

The citation metadata are in the file `CITATION.cff` in the repository: {{CITATION_CFF}}. If you use the app in research, please also cite the methods it builds on, in particular moments [@jouganous2017inferring] and the papers of the statistics you report.

## Licence {#about-licence}

The code is released under the **MIT licence**. The teaching text (the Learn and Statistics pages and the statistic cards) is released under the **Creative Commons Attribution 4.0 International licence (CC BY 4.0)**: you may share and adapt it, also commercially, if you give appropriate credit.

## Disclaimer {#about-disclaimer}

This tool is a beta version and a work in progress. It is provided "as is", without warranty of any kind, and you use it at your own risk. I have tried to be careful, and the calculations were checked against established software (see the validation report: {{VALIDATION}}), but I cannot guarantee that all calculations are accurate or correct. Please check important results with established tools such as dadi, moments, msprime or scikit-allel before you use them in research or publications. If you find an error, please report it.

## AI declaration {#about-ai}

This web tool was developed with the help of Claude Code (Anthropic), an AI coding assistant. The author designed the tool, wrote the instructions, reviewed the code and the teaching text, and checked the results. The full prompt used to build the tool is available in the GitHub repository ({{PROMPT}}). A record of all changes is in {{CHANGELOG}}.

## Validation {#about-validation}

The expected spectra of the engine were compared with moments 1.7.1 for 39 test models (all within a relative difference of $10^{-6}$), with dadi for inbreeding, and with msprime coalescent simulations for 28 models. The SFS-based statistics were compared with tskit, scikit-allel and egglib on simulated data (242 of 242 comparisons agree to within $10^{-9}$). The full report, with figures and tables, is in the repository: {{VALIDATION}}.

## Version {#about-version}

Version {{VERSION}}, last changed on {{LAST_CHANGE}}. The version number has a "-beta" suffix while the tool is in development.

## Privacy {#about-privacy}

The app has no server, no cookies and no tracking. Files that you open in the Statistics tab are read by your browser and never leave your computer. The model is stored only in the address of the page, so that you can share it as a link.
