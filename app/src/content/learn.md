<!--
Teaching text of the "Learn" tab. Licence: CC BY 4.0 (see the About page).
Write in plain British English, short sentences. Cite only keys of docs/REFERENCES.bib as [@key];
the build stops on an unknown key. Sections start with "## Title {#learn-id}".
-->

This page explains why each demographic history leaves its own signature in the site frequency spectrum (SFS). Each section has buttons that open a matching model in the **Model** tab. The text is short on purpose; the references give the full theory.

## What is the SFS? {#learn-sfs}

Take a sample of $n$ chromosomes (for diploids, $n$ is twice the number of individuals). At each variable site, one allele is **ancestral** (it was present in the common ancestor) and the other is **derived** (it arose by mutation). The **unfolded SFS** is a histogram: bin $i$ counts the sites where the derived allele is found $i$ times in the sample, for $i = 1, \dots, n-1$. We write it as $\xi_1, \dots, \xi_{n-1}$.

To know which allele is derived, we need an **outgroup**: a closely related species or population that shows the ancestral state. Without an outgroup, we can only count the **minor** (less common) allele. This gives the **folded SFS** $\eta_i = \xi_i + \xi_{n-i}$ for $i < n/2$ (and $\eta_{n/2} = \xi_{n/2}$ when $n$ is even). Folding loses information: a site with one derived copy and a site with $n-1$ derived copies fall into the same bin.

With two populations, the **joint SFS** $\xi_{ij}$ counts the sites with $i$ derived copies in a sample of $n_1$ from population 1 and $j$ derived copies in a sample of $n_2$ from population 2. Summing over $j$ gives the 1D spectrum of population 1 (a **marginal** spectrum), and summing over $i$ gives that of population 2.

The SFS summarises many sites, so it describes the genome-wide pattern of variation. It ignores where sites are along the genome and which alleles sit together on the same chromosome.

## Why does history change the SFS? {#learn-why}

A mutation that falls on a branch of the genealogy is carried by all samples below that branch. If the branch is above $i$ sampled lineages, the mutation appears in bin $i$. Under the infinite-sites model, the expected SFS is therefore a weighted sum of **branch lengths**: $E[\xi_i]$ is proportional to the expected total length of branches that have exactly $i$ descendants in the sample [@fu1995statistical; @griffiths1998age].

The shape of the genealogy depends on the history of population size. In the coalescent, $k$ lineages find a common ancestor at a rate proportional to $\binom{k}{2}$ divided by the population size [@kingman1982coalescent; @hudson1990genealogies]. Small populations coalesce fast; large populations coalesce slowly. A change in size therefore changes the relative lengths of branches, and so the spectrum. In this way, the SFS carries information about history [@wakeley2009coalescent; @nielsen2013introduction].

<div class="inline-plot" data-figure="trees"></div>

Two shapes are useful to remember:

- A **star-like** genealogy, with long external branches and short internal branches, gives many singletons. This is typical after population growth.
- A genealogy with **long internal branches** gives relatively more variants at intermediate frequencies. This is typical after a contraction, or when lineages are kept apart in different demes.

## Constant size: the baseline {#learn-constant}

Under the standard neutral model (constant size, random mating, no selection), the expected SFS is

$$E[\xi_i] = \frac{\theta}{i}, \qquad i = 1, \dots, n-1,$$

where $\theta = 4 N_e \mu$ per site, or $4 N_e \mu L$ for $L$ sites [@watterson1975number; @fu1995statistical]. Singletons are the most common class, and each further bin is smaller. The total number of segregating sites has expectation $\theta a_n$ with $a_n = \sum_{k=1}^{n-1} 1/k$.

All the usual estimators of $\theta$ ($\theta_W$, $\theta_\pi$, $\theta_H$ and others) have the same expectation under this model, so tests that compare them, such as Tajima's $D$, are close to zero [@tajima1989statistical]. Every other history in this app is compared with this baseline: the neutral overlay and the ratio panel in the Model tab show the departure from $1/i$.

<button type="button" class="btn try" data-preset="snm">Open: standard neutral model</button>

## Expansion {#learn-expansion}

After a population grows, most coalescences happen in the past, when the population was small. Recent parts of the genealogy have few coalescences, so the external branches are long and the genealogy is star-like. Many recent mutations sit on these external branches, so the spectrum has an **excess of rare variants** and Tajima's $D$ is negative [@tajima1989effect; @slatkin1991pairwise].

The signal depends on time. A recent expansion leaves a strong excess of singletons. An old expansion leaves a weaker signal: after a long time at the new size, the genealogy comes to equilibrium again and the spectrum returns towards $1/i$. In this sense, old events are "forgotten".

<button type="button" class="btn try" data-preset="exp_sudden_recent">Open: recent expansion (sudden)</button>
<button type="button" class="btn try" data-preset="exp_exponential_recent">Open: recent expansion (exponential)</button>
<button type="button" class="btn try" data-preset="exp_sudden_ancient">Open: ancient expansion</button>

## Bottlenecks and contractions {#learn-bottleneck}

During a bottleneck, the population is small and many lineages coalesce quickly. The effect on the spectrum depends on the **severity** and the **timing** of the bottleneck [@tajima1989effect; @marth2004allele].

- **Soon after a bottleneck**, rare variants are lost, and the variants that survived are mostly at intermediate frequencies. The spectrum shows a **deficit of rare variants** and Tajima's $D$ is positive.
- **During the recovery**, the large population gathers new mutations, which are rare at first. The spectrum then shows an **excess of rare variants** again, and $D$ can become negative.
- A **recent contraction** without recovery acts like a recent bottleneck: lineages coalesce fast in the small population, so internal branches are relatively long and rare variants are few.

Try changing the time of the recovery in the presets below and watch the singleton bin and Tajima's $D$.

<button type="button" class="btn try" data-preset="bottleneck_strong_recent">Open: strong, recent bottleneck</button>
<button type="button" class="btn try" data-preset="bottleneck_strong_old">Open: strong, old bottleneck</button>
<button type="button" class="btn try" data-preset="contraction_sudden">Open: recent contraction</button>

## Structure, migration and admixture {#learn-structure}

With two populations, the **joint SFS** shows how alleles are shared [@wakeley1997estimating; @chen2007joint; @gutenkunst2009inferring].

- **Just after a split**, the two samples share almost all variants, and the mass of the joint SFS lies near the diagonal $i/n_1 \approx j/n_2$.
- **After a split without gene flow**, drift moves allele frequencies apart. New mutations in one population are absent from the other, so mass moves to the **axes** ($i = 0$ or $j = 0$: private alleles). With more time, some alleles are fixed in one population and lost in the other, so mass reaches the **corners** (fixed differences).
- **Migration** brings alleles from one population into the other and pulls mass back towards the diagonal (shared alleles). F_ST falls and $d_{xy}$ moves closer to the diversity within populations.
- An **admixture pulse** moves a fraction $f$ of lineages at one time. It creates shared alleles at intermediate frequencies in the receiving population.

Structure also affects a sample from **one** population. Lineages in different demes cannot coalesce until one of them migrates. This makes internal branches long, as after a bottleneck. A structured population with constant size can therefore give a spectrum that looks like a bottleneck, or produce apparent changes in size [@ptak2002evidence; @stadler2009impact; @chikhi2010confounding; @mazet2016importance]. Pooling samples from two diverged demes has a similar effect.

<button type="button" class="btn try" data-preset="split_old_nomig">Open: old split, no gene flow</button>
<button type="button" class="btn try" data-preset="im_sym">Open: isolation with migration</button>
<button type="button" class="btn try" data-preset="secondary_contact">Open: secondary contact</button>
<button type="button" class="btn try" data-preset="pulse_1to2">Open: admixture pulse</button>
<button type="button" class="btn try" data-preset="structured_one_deme">Open: structured population, one deme</button>

## Selection, dominance and inbreeding (advanced) {#learn-selection}

The models above assume that sites are neutral. In the Advanced features, every site can be under the same selection, with scaled coefficient $\gamma = 2 N_{\mathrm{ref}} s$ and genotype fitnesses $1$, $1 + 2hs$ and $1 + 2s$.

- **Purifying selection** ($\gamma < 0$) keeps deleterious derived alleles at low frequency, so the spectrum is skewed towards rare variants [@sawyer1992population; @williamson2005simultaneous; @kim2017inference].
- **Positive selection** ($\gamma > 0$) pushes derived alleles towards high frequency and fixation.
- **Dominance** ($h$) sets how strongly selection acts on rare alleles, which are found mostly in heterozygotes. A recessive deleterious allele ($h$ near 0) is almost invisible to selection while it is rare [@huber2018gene].
- **Inbreeding** changes how the alleles of a sample are grouped into individuals: an inbred individual often carries two copies of the same allele. This changes the sampled spectrum, in particular the balance between odd and even counts [@blischak2020inferring].

Selection and demography can produce similar signals. For example, purifying selection and population growth both create an excess of rare variants. Comparing many sites that are likely to be neutral with sites under selection helps to separate the two [@williamson2005simultaneous; @kim2017inference].

<button type="button" class="btn try" data-preset="sel_neg10">Open: purifying selection</button>
<button type="button" class="btn try" data-preset="sel_pos5_expansion">Open: positive selection with expansion</button>
<button type="button" class="btn try" data-preset="inbreeding_F05">Open: inbreeding</button>

## Limits of the SFS {#learn-limits}

The SFS is a summary, and it loses information. Different histories can give the same expected spectrum, or spectra that are very close. With a finite amount of data, such histories cannot be told apart [@myers2008can; @terhorst2015fundamental; @rosen2018geometry; @lapierre2017accuracy]. This is why simple models, prior knowledge and checks of the fitted model are important.

The example below is computed live in your browser. History A grows exponentially from $\nu = 1$ to $\nu = 10$ over the last 0.1 time units. History B expands suddenly to $\nu = 5.1$, 0.075 time units ago. The two histories are clearly different, but their expected spectra for $n = 20$ are almost identical.

<div class="inline-plot" data-figure="limits"></div>

<button type="button" class="btn try" data-preset="limits_A">Open history A</button>
<button type="button" class="btn try" data-preset="limits_B">Open history B</button>

## From the expected SFS to inference {#learn-inference}

Inference programs compare an **observed** SFS with the **expected** SFS of a model and search for the parameters that fit best, usually by maximising a composite likelihood. They differ in how they compute the expected SFS:

- **dadi** solves a diffusion approximation for allele frequencies [@gutenkunst2009inferring];
- **moments** integrates ordinary differential equations for the moments of the SFS [@jouganous2017inferring]; this app uses a port of its method;
- **fastsimcoal2** estimates the expected SFS from coalescent simulations [@excoffier2013robust];
- **momi2** computes it from the coalescent for many populations [@kamm2020efficiently];
- **GADMA** searches the space of models and parameters with a genetic algorithm, using dadi, moments or other engines [@noskova2020gadma; @noskova2023gadma2].

The **Demes** format describes a model in a standard way, so that the same model can be used by different programs, and **stdpopsim** collects published models [@gower2022demes; @adrion2020community]. In this app, the button "Download… Model (Demes YAML)" exports the current model in this format.

Errors in the code of a model are easy to make and hard to see. Ragsdale et al. found such errors in published models and recommend standard formats and independent checks, for example by simulation [@ragsdale2020lessons].

## How this app computes the spectrum {#learn-method}

The engine is a TypeScript port of the moment equations of moments 1.7.1 [@jouganous2017inferring; @web_moments_docs]. It runs in your browser, in a background thread. Times are in units of $2 N_{\mathrm{ref}}$ generations, sizes are $\nu = N/N_{\mathrm{ref}}$, migration rates are $M = 2 N_{\mathrm{ref}} m$ and selection is $\gamma = 2 N_{\mathrm{ref}} s$, as in dadi and moments.

The engine was checked against moments for 39 test models, against dadi for inbreeding, and against msprime simulations [@baumdicker2022efficient]; the statistics were checked against tskit, scikit-allel and egglib [@ralph2020efficiently; @siol2022egglib]. The validation report in the repository gives the details.

Some approximations remain, as in any engine of this kind:

- the moment equations follow the diffusion limit, which differs from a finite Wright–Fisher population by terms of order $1/N$;
- with migration or selection, the equations are closed with a jackknife approximation; to keep its error small, the engine computes at a larger internal sample size and then projects down;
- the expected spectrum ignores linkage between sites and the variance of real data.

## Guided exercises {#learn-exercises}

Each task starts from a preset in the Model tab. Try it first, then open the answer.

<details>
<summary>1. Open "Recent expansion (sudden)". Make the expansion older (increase T). What happens to the singleton bin, and why?</summary>

The excess of singletons shrinks, and the spectrum returns towards $1/i$. After a long time at the new, large size, the genealogy comes to equilibrium again: the expansion is "forgotten". Tajima's $D$ moves back towards zero.
</details>

<details>
<summary>2. Open "Bottleneck with recovery (strong, recent)". Move the recovery closer to the present, then further back. How do the singleton bin and Tajima's D change?</summary>

Just after the bottleneck, rare variants are lost and $D$ is positive. Later in the recovery, new mutations add rare variants and $D$ becomes negative. The sign of $D$ alone therefore does not tell whether a population grew or shrank; timing matters [@tajima1989effect].
</details>

<details>
<summary>3. Open "Split, no gene flow (recent)". Increase the duration after the split. Where does the mass of the joint SFS go?</summary>

It moves from the diagonal to the axes (alleles private to one population) and, with more time, to the corners (fixed differences). F_ST and $d_{xy}$ both increase.
</details>

<details>
<summary>4. Open "Isolation with migration (symmetric)" and increase M. What happens to F_ST, d_xy and the joint SFS?</summary>

F_ST falls and mass returns to the diagonal, because migrants make alleles shared. $d_{xy}$ falls towards the diversity within populations. In the Statistics tab, a parameter sweep over $M$ shows this directly.
</details>

<details>
<summary>5. Open "Structured population, one deme sampled". Compare its 1D spectrum with a recent bottleneck. Did the size of any population change?</summary>

No: both demes have constant size. Lineages in different demes must migrate before they can coalesce, which gives long internal branches, fewer rare variants and a positive $D$, as after a bottleneck [@ptak2002evidence; @chikhi2010confounding].
</details>

<details>
<summary>6. Switch on "Ancestral misidentification" with ε = 0.02. Which bins change? Then fold the spectrum. What happens?</summary>

A fraction ε of sites moves from bin $i$ to bin $n - i$. Because rare variants are common, this mostly raises the high-frequency bins, which mimics positive selection (Fay and Wu's $H$ becomes negative). Folding puts bins $i$ and $n - i$ together, so the error disappears.
</details>

<details>
<summary>7. Fold the spectrum and look at the statistics panel. Which statistics disappear, and why?</summary>

$\theta_H$, $\theta_L$, Fay and Wu's $H$, Zeng's $E$ and Fu and Li's $D$ and $F$ (with an outgroup) need to know which allele is derived. A folded spectrum does not say this. $\theta_W$, $\theta_\pi$, Tajima's $D$ and Fu and Li's $D^*$ and $F^*$ remain.
</details>

<details>
<summary>8. Open "Purifying selection (γ = −10)" and note Tajima's D. Can you find an expansion with the same D?</summary>

Yes. A recent expansion can give the same $D$. The two spectra differ in shape (look at the ratio panel), but with few sites the difference is hard to detect. Selection and demography can leave similar signals [@williamson2005simultaneous].
</details>

## Glossary {#learn-glossary}

- **Site frequency spectrum (SFS)**: The number of sites with each count of the derived (unfolded) or minor (folded) allele in a sample.
- **Derived and ancestral allele**: The ancestral allele was present in the common ancestor; the derived allele arose by mutation. An outgroup is needed to tell them apart.
- **Folded and unfolded SFS**: The unfolded SFS counts derived alleles; the folded SFS counts minor alleles and needs no outgroup.
- **Joint SFS and marginal spectrum**: The joint SFS counts sites by their derived counts in two samples at once. Summing over one population gives the marginal 1D spectrum of the other.
- **θ (theta)**: The population-scaled mutation rate, $4 N_e \mu$ per site, or $4 N_e \mu L$ for $L$ sites. The expected number of segregating sites grows with θ.
- **Effective population size, N_e, and N_ref**: The size of an ideal population with the same amount of drift. N_ref is the reference size used to scale times, sizes and rates in the model.
- **Coalescence**: Two lineages meet in a common ancestor, looking back in time. Small populations coalesce fast.
- **Epoch**: A period with its own population size and type of size change (sudden, linear or exponential).
- **ν (nu)**: The relative size $N/N_{\mathrm{ref}}$ at the end of an epoch.
- **T**: The duration of an epoch in units of $2 N_{\mathrm{ref}}$ generations.
- **M**: The scaled migration rate $2 N_{\mathrm{ref}} m$, where $m$ is the fraction of a population that consists of new migrants each generation.
- **γ (gamma)**: The scaled selection coefficient $2 N_{\mathrm{ref}} s$. Negative: purifying selection; positive: positive selection.
- **h**: The dominance coefficient: 0 recessive, 0.5 additive, 1 dominant.
- **F**: The inbreeding coefficient: the probability that the two alleles of an individual are identical by descent.
- **Projection**: Computing the spectrum of a smaller sample from a larger one, by sampling without replacement (a hypergeometric distribution).
- **Ratio of expectations**: A normalised statistic (such as Tajima's D or F_ST) computed by putting expected values into its formula. It is not the expected value of the statistic over loci.
