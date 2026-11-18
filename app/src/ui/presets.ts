/**
 * One-click presets. Each preset is one of the validation models in validation/models/*.json,
 * so every preset was checked against moments (and most against msprime; docs/VALIDATION.md).
 */

import { Model, modelFromOverrides, defaultModel } from "../engine/model.ts";
import { AppState, DisplayState } from "./state.ts";

const files = import.meta.glob("../../../validation/models/*.json", { eager: true, import: "default" }) as Record<string, unknown>;
const MODELS: Record<string, unknown> = {};
for (const [path, json] of Object.entries(files)) MODELS[path.split("/").pop()!.replace(/\.json$/, "")] = json;

export interface Preset {
  id: string;
  model: string; // validation model id
  label: string;
  group: "One population" | "Two populations" | "Selection, inbreeding and errors";
  note: string;
  view1D?: DisplayState["view1D"];
}

export const PRESETS: Preset[] = [
  { id: "snm", model: "snm", group: "One population", label: "Standard neutral model", note: "Constant size. The expected SFS is proportional to 1/i." },
  { id: "exp_sudden_recent", model: "exp_sudden_recent", group: "One population", label: "Recent expansion (sudden)", note: "A 10-fold sudden expansion 0.02 × 2N_ref generations ago." },
  { id: "exp_exponential_recent", model: "exp_exponential_recent", group: "One population", label: "Recent expansion (exponential)", note: "Exponential growth from 1 to 10 over the last 0.05 × 2N_ref generations." },
  { id: "exp_linear", model: "exp_linear", group: "One population", label: "Recent expansion (linear)", note: "Linear growth from 1 to 5 over the last 0.3 × 2N_ref generations." },
  { id: "exp_sudden_ancient", model: "exp_sudden_ancient", group: "One population", label: "Ancient expansion (sudden)", note: "The same 10-fold expansion, but 1.0 × 2N_ref generations ago: most of the signal is forgotten." },
  { id: "exp_exponential_ancient", model: "exp_exponential_ancient", group: "One population", label: "Ancient expansion (exponential)", note: "Exponential growth from 1 to 10 over a long period (1.0 × 2N_ref generations)." },
  { id: "bottleneck_strong_recent", model: "bottleneck_strong_recent", group: "One population", label: "Bottleneck with recovery (strong, recent)", note: "Size 0.05 for a short time, then recovery 0.05 × 2N_ref generations ago." },
  { id: "bottleneck_mild_recent", model: "bottleneck_mild_recent", group: "One population", label: "Bottleneck with recovery (mild, recent)", note: "Size 0.3 for 0.05 × 2N_ref generations, then recovery." },
  { id: "bottleneck_strong_old", model: "bottleneck_strong_old", group: "One population", label: "Bottleneck with recovery (strong, old)", note: "A strong bottleneck followed by a long recovery (0.5 × 2N_ref generations)." },
  { id: "contraction_sudden", model: "contraction_sudden", group: "One population", label: "Recent contraction (sudden)", note: "A sudden drop to 0.2 of the ancestral size, 0.1 × 2N_ref generations ago." },
  { id: "contraction_exponential", model: "contraction_exponential", group: "One population", label: "Recent contraction (exponential)", note: "Exponential decline from 1 to 0.1 over the last 0.1 × 2N_ref generations." },
  { id: "three_epoch_mixed", model: "three_epoch_mixed", group: "One population", label: "Three epochs, mixed dynamics", note: "Structure (3): linear growth, a sudden drop and exponential recovery." },
  { id: "split_recent_nomig", model: "split_recent_nomig", group: "Two populations", label: "Split, no gene flow (recent)", note: "Two populations split 0.05 × 2N_ref generations ago, with no migration." },
  { id: "split_old_nomig", model: "split_old_nomig", group: "Two populations", label: "Split, no gene flow (old)", note: "An old split (1.0 × 2N_ref generations) with unequal sizes: many private and fixed differences." },
  { id: "im_sym", model: "im_sym", group: "Two populations", label: "Isolation with migration (symmetric)", note: "Split 0.5 × 2N_ref generations ago, then symmetric migration M = 2." },
  { id: "im_asym", model: "im_asym", group: "Two populations", label: "Isolation with migration (asymmetric)", note: "Unequal sizes and unequal migration rates (M12 = 0.5, M21 = 5)." },
  { id: "secondary_contact", model: "secondary_contact", group: "Two populations", label: "Secondary contact", note: "Isolation (migration masked), then recent contact with M = 2." },
  { id: "ancient_migration", model: "ancient_migration", group: "Two populations", label: "Ancient migration, then isolation", note: "Migration just after the split, then isolation (migration masked)." },
  { id: "pulse_1to2", model: "pulse_1to2", group: "Two populations", label: "Admixture pulse (pop 1 → pop 2)", note: "A single pulse: 30 % of pop 2 comes from pop 1, 0.1 × 2N_ref generations ago." },
  { id: "pulse_2to1", model: "pulse_2to1", group: "Two populations", label: "Admixture pulse (pop 2 → pop 1)", note: "A single pulse: 20 % of pop 1 comes from pop 2." },
  { id: "structured_one_deme", model: "structured_one_population", group: "Two populations", label: "Structured population, one deme sampled", note: "Two demes with migration since long ago; the 1D panel shows one deme only. No size ever changed.", view1D: "pop1" },
  { id: "structured_pooled", model: "structured_one_population", group: "Two populations", label: "Structured population, demes pooled", note: "The same model; the 1D panel shows both demes pooled into one sample.", view1D: "pooled" },
  { id: "sel_neg10", model: "sel_neg10", group: "Selection, inbreeding and errors", label: "Purifying selection (γ = −10)", note: "Constant size, additive purifying selection." },
  { id: "sel_neg10_h01", model: "sel_neg10_h01", group: "Selection, inbreeding and errors", label: "Purifying selection, nearly recessive (h = 0.1)", note: "Selection acts weakly on rare alleles, which are mostly in heterozygotes." },
  { id: "sel_pos5_expansion", model: "sel_pos5_expansion", group: "Selection, inbreeding and errors", label: "Positive selection with expansion (γ = +5)", note: "Positive selection pushes derived alleles to high frequency." },
  { id: "inbreeding_F05", model: "inbreeding_F05", group: "Selection, inbreeding and errors", label: "Inbreeding (F = 0.5)", note: "An inbred population (Blischak et al. 2020 model) after an expansion." },
  { id: "misid_expansion", model: "misid_expansion", group: "Selection, inbreeding and errors", label: "Ancestral misidentification (ε = 2 %)", note: "2 % of sites have the wrong ancestral allele, which raises the last bin." },
  { id: "inbreeding_2d", model: "inbreeding_2d", group: "Selection, inbreeding and errors", label: "Two populations with inbreeding", note: "Split without gene flow; F = 0.3 in pop 1 and 0.6 in pop 2." },
];

export function presetModel(p: Preset): Model {
  const json = MODELS[p.model];
  if (!json) throw new Error(`preset ${p.id}: validation model ${p.model} not found`);
  return modelFromOverrides(json, defaultModel());
}

/** Apply a preset: the model and the toggles that it needs; display and units are kept. */
export function applyPreset(s: AppState, p: Preset): void {
  const m = presetModel(p);
  s.model = m;
  s.preset = p.id;
  const mig = m.mode === 2 && m.migration;
  s.symMig = mig && m.post.every((e) => e.m12 === e.m21) && m.post.every((e) => e.mig12On === e.mig21On);
  s.masksOn = mig && m.post.some((e) => !e.mig12On || !e.mig21On);
  s.dominanceOn = m.selection.on && m.selection.h !== 0.5;
  for (const e of m.ancestral) s.dynOn[e.dyn] = true;
  for (const e of m.post) for (const d of e.dyn) s.dynOn[d] = true;
  if (p.view1D) s.display.view1D = p.view1D;
}

export const presetById = (id: string): Preset | undefined => PRESETS.find((p) => p.id === id);
