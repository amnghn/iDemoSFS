/**
 * "What changed?": short rule-based sentences that explain the shape of the current spectrum,
 * and what changed since the previous model. The rules use ratios that do not depend on theta:
 * theta_pi / theta_W (rare versus intermediate variants), theta_H / theta_pi (high-frequency
 * derived variants) and the share of singletons compared with the neutral share.
 * The sentences may contain HTML (citation links).
 */

import { Model } from "../engine/model.ts";
import { modelWarnings } from "../engine/limits.ts";
import { StatsBundle } from "./modelStats.ts";
import { harmonic } from "../stats/onepop.ts";
import { fixed, pct, fmt } from "./dom.ts";
import { DisplayState } from "./state.ts";
import { cite } from "./cite.ts";

export interface Summary {
  piOverW: number;
  hOverPi: number;
  singletonShare: number;
  singletonNeutral: number;
  D: number;
  fst?: number;
  shared?: number;
  private?: number;
  fixed?: number;
}

type Trajectory = { present: number; min: number; max: number; first: number };

/**
 * Sizes along the lineage of the viewed sample (ancestral epochs, then one daughter). With
 * sudden dynamics the size jumps at the start of an epoch, so the start size (for example the
 * split fraction of a daughter) is used only for linear and exponential epochs.
 */
export function trajectory(m: Model, view: DisplayState["view1D"]): Trajectory {
  const sizes = [1, ...m.ancestral.map((e) => e.nu)];
  if (m.mode === 2 && view !== "pooled") {
    const q = view === "pop2" ? 1 : 0;
    const anc = m.ancestral[m.ancestral.length - 1].nu;
    if (m.post[0].dyn[q] !== "sudden") sizes.push(m.split.useFraction ? (q === 0 ? m.split.s : 1 - m.split.s) * anc : q === 0 ? m.split.nu1 : m.split.nu2);
    for (const e of m.post) sizes.push(e.nu[q]);
  }
  return { present: sizes[sizes.length - 1], min: Math.min(...sizes), max: Math.max(...sizes), first: 1 };
}

export function summarise(b: StatsBundle, view: DisplayState["view1D"]): Summary {
  const one = b.mode === 1 ? b.one[0] : b.one.find((o) => o.key === view) ?? b.one[0];
  const s = one.s;
  const n = one.n;
  const sum: Summary = {
    piOverW: s.thetaPi / s.thetaW,
    hOverPi: s.thetaH / s.thetaPi,
    singletonShare: s.thetaXi1 / s.S,
    singletonNeutral: 1 / harmonic(n),
    D: s.tajimaD,
  };
  if (b.two) {
    const t = b.two;
    Object.assign(sum, { fst: t.fstHudson, shared: t.shared / t.segregating, private: (t.private1 + t.private2) / t.segregating, fixed: t.fixed / t.segregating });
  }
  return sum;
}

export function explain(m: Model, b: StatsBundle, d: DisplayState): string[] {
  const out: string[] = [];
  const s = summarise(b, d.view1D);
  const tr = trajectory(m, d.view1D);
  const dRel = s.piOverW - 1;
  const hRel = s.hOverPi - 1;
  const who = m.mode === 1 ? "" : d.view1D === "pooled" ? " of the pooled sample" : ` of pop ${d.view1D === "pop2" ? 2 : 1}`;
  const expanded = tr.present > 1.2 * tr.min && tr.min >= 0.8;
  const bottleneck = tr.min < 0.8 && tr.present >= 2 * tr.min;
  const contracted = tr.present < 0.8 && tr.present <= 1.05 * tr.min;
  const structured = m.mode === 2 && m.migration && d.view1D !== "pooled";
  const pooledDiverged = m.mode === 2 && d.view1D === "pooled";
  const sel = m.selection.on ? m.selection.gamma : 0;

  if (Math.abs(dRel) < 0.03 && Math.abs(s.singletonShare / s.singletonNeutral - 1) < 0.05) {
    out.push(`The spectrum${who} is close to the standard neutral expectation (E[ξᵢ] ∝ 1/i), and Tajima's D is near zero (${fixed(s.D)}).`);
    if (m.mode === 1 && tr.max !== tr.min) out.push("Size changes that happened long ago, or that were small, leave little trace: the genealogy has mostly 'forgotten' them.");
  } else if (dRel < 0) {
    out.push(`Excess of rare variants${who} compared with the neutral model (Tajima's D = ${fixed(s.D)}; singletons are ${pct(s.singletonShare)} of SNPs, against ${pct(s.singletonNeutral)} under neutrality).`);
    if (sel < 0) out.push("Purifying selection keeps deleterious derived alleles at low frequency, which adds rare variants.");
    if (expanded) out.push("This is the expected signal of population growth: many new mutations sit on the long external branches of a star-like genealogy.");
    else if (bottleneck) out.push("After a bottleneck, the recovered population gathers new mutations, which are rare at first. Older variants that survived the bottleneck are at intermediate frequencies.");
    else if (m.mode === 2 && d.view1D !== "pooled" && (structured || m.pulse.on))
      out.push("Here no population grew: gene flow brings alleles from the other population into this one, where they start at low frequency, which adds rare variants.");
    else if (sel >= 0 && !m.misid.on) out.push("Rare variants come from mutations on external branches; such a pattern usually points to growth or to purifying selection.");
  } else {
    out.push(`Fewer rare variants and relatively more intermediate-frequency variants${who} than under neutrality (Tajima's D = ${fixed(s.D)}).`);
    if (structured)
      out.push(
        `No size change is needed for this: lineages in different demes must migrate before they can coalesce, which makes internal branches long. Structure can mimic a bottleneck ${cite("ptak2002evidence", "stadler2009impact", "chikhi2010confounding")}.`,
      );
    else if (pooledDiverged) out.push("Pooling two diverged samples puts alleles that are common in one population and rare in the other into the middle of the spectrum.");
    else if (bottleneck || contracted)
      out.push(`This is the expected signal of a recent ${contracted ? "contraction" : "bottleneck"}: many lineages coalesce quickly when the population is small, so the genealogy has relatively long internal branches and few new, rare variants.`);
    else if (m.mode === 2 && m.pulse.on) out.push("The admixture pulse brings in lineages from a diverged population, which adds variants at intermediate frequencies.");
  }
  if (m.misid.on && m.misid.eps > 0 && !d.folded)
    out.push(
      `Ancestral misidentification (ε = ${fmt(m.misid.eps)}) moves a fraction of sites from bin i to bin n − i. Because rare variants are common, mostly the last bins (high-frequency derived variants) rise, which looks like positive selection. Folding the SFS removes this error.`,
    );
  else if (!d.folded && hRel > 0.05) {
    if (sel > 0) out.push("Excess of high-frequency derived variants (θ_H > θ_π): positive selection pushes derived alleles towards fixation.");
    else out.push("Relatively many high-frequency derived variants (θ_H > θ_π, so Fay and Wu's H is negative).");
  }
  if (m.mode === 2 && s.fst !== undefined) {
    const parts = `${pct(s.shared!, 0)} of segregating sites are shared, ${pct(s.private!, 0)} are private to one population and ${pct(s.fixed!, 1)} are fixed differences; Hudson's F_ST = ${fixed(s.fst, 3)}.`;
    if (m.migration && m.post.some((e) => (e.mig12On && e.m12 > 0) || (e.mig21On && e.m21 > 0)))
      out.push(`Migration keeps alleles shared and pulls mass of the joint SFS towards the diagonal. ${parts}`);
    else if (m.pulse.on) out.push(`Without continuous gene flow, mass moves to the axes of the joint SFS (private alleles); the pulse adds shared alleles. ${parts}`);
    else out.push(`Without gene flow, mass moves to the axes of the joint SFS (private alleles) and, with time, to the corners (fixed differences). ${parts}`);
  }
  if (m.inbreeding.on) out.push("Inbreeding pairs identical alleles in the same individual, which changes the sampled spectrum: alleles tend to come in pairs, so even counts become more common.");
  out.push(...modelWarnings(m));
  return out;
}

export function compare(prev: Summary | null, cur: Summary): string | null {
  if (!prev) return null;
  const parts: string[] = [];
  if (Math.abs(prev.D - cur.D) > 0.005) parts.push(`Tajima's D went from ${fixed(prev.D)} to ${fixed(cur.D)}`);
  if (Math.abs(prev.singletonShare - cur.singletonShare) > 0.002) parts.push(`singletons went from ${pct(prev.singletonShare)} to ${pct(cur.singletonShare)} of SNPs`);
  if (prev.fst !== undefined && cur.fst !== undefined && Math.abs(prev.fst - cur.fst) > 0.0005) parts.push(`Hudson's F_ST went from ${fixed(prev.fst, 3)} to ${fixed(cur.fst, 3)}`);
  if (!parts.length) return null;
  return `Since the previous setting: ${parts.join("; ")}.`;
}
