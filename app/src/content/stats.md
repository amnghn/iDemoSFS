<!--
Text of the "Statistics" tab. Licence: CC BY 4.0. Cite only keys of docs/REFERENCES.bib.
Section ids are used by src/ui/statsView.ts; ids that start with "card-" become statistic cards.
-->

Most classic diversity and divergence statistics are **linear functions of the SFS**: each one gives a weight to each frequency bin and adds up the weighted counts [@achaz2009frequency]. This tab computes them from the expected SFS of the current model (model mode) or from your own spectrum (calculator mode), and shows the weights. Your files are read in your browser only; nothing is uploaded.

## Estimator weights {#weights}

Each estimator of $\theta$ is $\hat\theta = \sum_i w_i \xi_i$, with its own weights $w_i$ [@achaz2009frequency]. $\theta_W$ gives the same weight to every segregating site [@watterson1975number]. $\theta_\pi$ weights bin $i$ by $i(n-i)$, so it peaks at intermediate frequencies [@tajima1983evolutionary]. $\theta_H$ weights by $i^2$, so it responds to high-frequency derived alleles [@fay2000hitchhiking], and $\theta_L$ weights by $i$ [@zeng2006statistical]. Under the standard neutral model all of them have the same expectation. A test such as Tajima's $D$ compares two estimators: when rare variants are in excess, $\theta_W$ (which counts every rare site fully) is larger than $\theta_\pi$ (which down-weights them), so $D < 0$ [@tajima1989statistical]. The second panel shows each weight, or each bin's contribution $w_i \xi_i$; the contributions add up to the estimate.

## The weights in two dimensions {#weights-2d}

The same idea works for the joint SFS. The weight matrices of $\pi_1$, $\pi_2$ and $d_{xy}$ show which cells drive each statistic. $\pi_1$ depends only on the row (the count in population 1), $\pi_2$ only on the column, and $d_{xy}$ is largest in the corners where one population carries the derived allele and the other does not. The numerator of Hudson's $F_{ST}$ is negative near the diagonal (shared alleles at similar frequencies) and positive on the axes and in the corners.

## Parameter sweep {#sweep}

Choose one parameter and a range. The app computes the expected SFS at each point (in a separate background thread) and plots several statistics, one small chart each. A classic use: plot $F_{ST}$, $d_{xy}$, $d_a$, $\pi_1$ and $\pi_2$ against split time or migration. $F_{ST}$ can be high because the diversity within populations is low, not because the populations are very divergent; $d_{xy}$ and $d_a$ help to tell these cases apart [@cruickshank2014reanalysis].

## Why are there two F_ST values, and which one should I report? {#fst-two}

The two estimators target slightly different quantities.

- **Hudson's $F_{ST}$** is $1 - \pi_{\mathrm{within}} / \pi_{\mathrm{between}}$ [@hudson1992estimation]. It compares the diversity inside populations with the diversity between them, so it links directly to coalescence times [@slatkin1991inbreeding]. It is defined for the two populations that were sampled and depends little on the sample sizes [@bhatia2013estimating].
- **Weir and Cockerham's $\theta$** is an analysis-of-variance estimator [@weir1984estimating]. It treats the sampled populations as replicates from a set of populations and weights each population by its sample size. It is the long-standing standard for genotype data and is used by many programs, for example VCFtools [@danecek2011variant]. For a review of the estimators, see Weir and Hill [-@weir2002estimating].

Hudson's estimator is easier to interpret with very unequal sample sizes and in genome scans [@bhatia2013estimating]. Whichever you use, say which estimator it is, and combine sites as a **ratio of averages**: add up numerators and denominators over sites and divide once. The "average of ratios" (one $F_{ST}$ per site, then the mean) gives a different, usually smaller value, because sites with rare alleles have small, noisy ratios [@bhatia2013estimating].

## The teaching plots {#fst-plots}

**Left:** one population keeps its full sample, the other is projected to smaller samples; the model stays the same. The WC estimate can change with the ratio $n_1/n_2$; Hudson's stays nearly flat. **Middle:** a minor-allele-frequency filter on the pooled sample removes rare variants; with small samples, a 1 % filter removes nothing, because the smallest frequency is $1/(n_1+n_2)$. **Right:** the spectrum stays the same, but WC is told a different $F_{IS}$. WC moves; Hudson's $F_{ST}$ does not use heterozygosity and stays flat.

## Heterozygosity in Weir and Cockerham's estimator {#hwe-note}

WC needs the observed heterozygosity $\bar h$, but the SFS contains allele counts only, not genotypes. **Assume HWE** uses the expected proportion of heterozygotes when the alleles of the sample are paired at random: $2p(1-p)\cdot 2k/(2k-1)$ for $k$ diploid individuals. The plain $2p(1-p)$ is slightly biased (about $1/(2k)$). **F_IS** multiplies this by $1 - F_{IS}$; this assumes the same $F_{IS}$ at every site, so it is an approximation. In the validation, $\theta_{WC}$ with this option was within 3 % of the exact value, and the reported $F_{IS}$ was 2–4 % higher than the true value. **Exact** uses per-site genotype counts and no longer uses the SFS alone. **Haploid** removes the $\bar h$ term, for haploid or pooled data; the sample sizes are then the numbers of gene copies.

Hudson's $F_{ST}$ uses allele frequencies only, so this option does not change it. Keep two effects apart: inbreeding changes the expected SFS itself (the inbreeding toggle in the Model tab) [@blischak2020inferring], while this option only changes how WC uses heterozygosity. A deficit of heterozygotes can come from inbreeding or selfing, from hidden structure inside a sample (the Wahlund effect) [@wahlund1928zusammensetzung], or from genotyping errors, for example allelic dropout at low coverage. The SFS alone cannot test Hardy–Weinberg proportions; that needs genotypes.

## What the SFS cannot give {#cannot}

The SFS counts alleles at each site on its own. Statistics that need **haplotypes, linkage or positions along the genome** cannot be computed from it:

- linkage disequilibrium ($r^2$, Kelly's $Z_{nS}$);
- haplotype statistics (Fu's $F_S$, H12, EHH, iHS);
- the location of windows along the genome, for example scans for outlier regions;
- $f_3$, $f_4$ and $D$ (ABBA–BABA) statistics, which need three or more populations, so a two-population SFS cannot give them.

These are possible future extensions.

## Segregating sites, S {#card-S}

**Definition.** The number of variable sites, $S = \sum_i \xi_i$. **Bins.** All bins equally. **Up or down.** Rises with $\theta$, sample size and growth; falls after a bottleneck. **Common mistake.** Comparing $S$ between samples of different size: use $\theta_W = S / a_n$ instead.

## Watterson's θ_W {#card-thetaW}

**Definition.** $\theta_W = S / a_n$ [@watterson1975number]. **Bins.** Equal weight per segregating site; since most sites are rare, rare variants dominate it. **Up or down.** Rises relative to $\theta_\pi$ after growth and purifying selection. **Common mistake.** Reporting it per site without the total number of sites $L$, including monomorphic sites.

## Nucleotide diversity θ_π (π) {#card-thetaPi}

**Definition.** The mean number of differences between two sequences, $\sum_i i(n-i)\xi_i / \binom{n}{2}$ [@tajima1983evolutionary; @nei1979mathematical]. **Bins.** Intermediate frequencies. **Up or down.** Rises relative to $\theta_W$ after a bottleneck, with structure, and with balancing selection. **Common mistake.** Dividing by the number of variable sites instead of all sites gives a value that is not comparable between data sets.

## θ_H and Fay and Wu's H {#card-H}

**Definition.** $\theta_H = \sum_i i^2 \xi_i / \binom{n}{2}$; the raw $H = \theta_\pi - \theta_H$ [@fay2000hitchhiking]; the normalised $H$ divides $\theta_\pi - \theta_L$ by its standard deviation [@zeng2006statistical]. **Bins.** High-frequency derived alleles. **Up or down.** Negative when derived alleles at high frequency are in excess, for example near a recent selective sweep. **Common mistake.** Ignoring errors in the ancestral state: a few misidentified sites inflate the high-frequency bins and make $H$ negative. Needs an outgroup.

## θ_L and Zeng's E {#card-E}

**Definition.** $\theta_L = \sum_i i\,\xi_i / (n-1)$; $E = (\theta_L - \theta_W)/\mathrm{sd}$ [@zeng2006statistical]. **Bins.** $\theta_L$ grows with the derived count, so $E$ contrasts high-frequency variants with all segregating sites. **Up or down.** Negative with an excess of rare variants (for example after growth); positive with relatively many high-frequency derived variants. **Common mistake.** Using it on a folded spectrum: it needs the unfolded SFS.

## Singleton-based θ and Fu and Li's tests {#card-FuLi}

**Definition.** $\theta_{\xi_1} = \xi_1$ (derived singletons, needs an outgroup) and $\theta_\eta = \frac{n-1}{n}(\xi_1 + \xi_{n-1})$ (folded singletons); Fu and Li's $D$ and $F$ compare them with $\theta_W$ or $\theta_\pi$; $D^*$ and $F^*$ need no outgroup [@fu1993statistical; @simonsen1995properties]. **Bins.** The first bin (and the last for the folded version). **Up or down.** Negative with an excess of singletons (growth, purifying selection). **Common mistake.** Sequencing errors create false singletons and push these tests down.

## Tajima's D {#card-D}

**Definition.** $D = (\theta_\pi - \theta_W)/\sqrt{e_1 S + e_2 S(S-1)}$ [@tajima1989statistical]. **Bins.** Intermediate ($\theta_\pi$) against all ($\theta_W$). **Up or down.** Negative after growth or with purifying selection; positive soon after a bottleneck, with structure, or with balancing selection [@tajima1989effect]. **Common mistake.** Reading $D \neq 0$ as evidence of selection: demography alone can do this. In model mode, $D$ is a ratio of expectations, not the mean $D$ over loci.

## d_xy and d_a {#card-dxy}

**Definition.** $d_{xy}$ is the mean number of differences between a sequence from population 1 and one from population 2; $d_a = d_{xy} - (\pi_1 + \pi_2)/2$ [@nei1979mathematical; @nei1987molecular]. **Bins.** Cells where the two populations have different frequencies; the corners count fully. **Up or down.** Grow with split time; fall with migration. **Common mistake.** Using $F_{ST}$ alone: a high $F_{ST}$ can come from low diversity within populations, while $d_{xy}$ stays the same [@cruickshank2014reanalysis].

## Hudson's F_ST {#card-fstH}

**Definition.** $1 - [(\pi_1+\pi_2)/2]/d_{xy}$, combined over sites as a ratio of averages [@hudson1992estimation; @bhatia2013estimating]. **Bins.** Positive weight on the axes and corners, negative near the diagonal. **Up or down.** Rises with split time and drift; falls with migration. **Common mistake.** Averaging per-site values ("average of ratios"), which gives a different number.

## Weir and Cockerham's θ {#card-fstWC}

**Definition.** $\theta_{WC} = \sum a / \sum (a + b + c)$ over sites, from the variance components among populations ($a$), among individuals ($b$) and within individuals ($c$) [@weir1984estimating]. **Bins.** Like Hudson's, but each population is weighted by its sample size, and $c$ needs the heterozygosity. **Up or down.** Rises with divergence; also depends on the sample sizes and on the heterozygosity assumption. **Common mistake.** Comparing WC values computed with different heterozygosity assumptions, or with very unequal sample sizes.

## f₂ {#card-f2}

**Definition.** The squared difference in allele frequency between the populations, with a correction for sampling, summed over sites [@peter2016admixture]. **Bins.** The same numerator as Hudson's $F_{ST}$. **Up or down.** Grows with drift since the split; falls with gene flow. **Common mistake.** Comparing $f_2$ from data sets with different sets of sites; it is a sum over sites, so divide by $L$ for a per-site value.

## Shared, private and fixed sites {#card-shared}

**Definition.** Sites polymorphic in both samples (shared), in one sample only (private), or fixed for different alleles (fixed differences) [@wakeley1997estimating]. **Bins.** The interior of the joint SFS (shared), the axes (private) and the two off-diagonal corners (fixed). **Up or down.** Shared sites fall and fixed differences rise with split time; migration and admixture keep sites shared. **Common mistake.** Forgetting that these counts depend on the sample sizes: larger samples find more shared polymorphisms.
