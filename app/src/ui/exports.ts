/**
 * Exports of the current model: the spectrum as CSV or as a dadi/moments `.fs` file (expected
 * counts, theta = 4 N_ref mu L), and the model as Demes YAML (Gower et al. 2022).
 */

import { NDArray, fold, cornerMask } from "../engine/ndarray.ts";
import { Model } from "../engine/model.ts";
import { toDemesYaml } from "../engine/demes.ts";
import { AppState, theta as thetaOf } from "./state.ts";
import { BUILD } from "../generated/content.ts";

const g17 = (x: number): string => (Number.isFinite(x) ? Number(x.toPrecision(12)).toString() : "nan");

function header(m: Model, s: AppState): string[] {
  return [
    `Expected SFS from the app "Demographic history and the expected SFS" v${BUILD.version}`,
    `theta = 4 N_ref mu L = ${g17(thetaOf(s.units))} (N_ref = ${s.units.Nref}, mu = ${s.units.mu}, L = ${s.units.L})`,
    `model (JSON): ${JSON.stringify(m)}`,
  ];
}

/** The spectrum in counts, folded or not as shown; mask as in moments. */
function shown(sfs: NDArray, s: AppState): { data: Float64Array; mask: Uint8Array; folded: boolean } {
  const th = thetaOf(s.units);
  const counts: NDArray = { shape: sfs.shape, data: sfs.data.map((v) => v * th) };
  if (s.display.folded) {
    const f = fold(counts, cornerMask(counts.shape));
    return { data: f.data, mask: f.mask, folded: true };
  }
  return { data: counts.data, mask: cornerMask(counts.shape), folded: false };
}

export function sfsCsv(sfs: NDArray, m: Model, s: AppState): string {
  const { data, mask, folded } = shown(sfs, s);
  const lines = header(m, s).map((l) => `# ${l}`);
  lines.push(`# ${folded ? "folded (minor allele counts); masked entries are empty" : "unfolded (derived allele counts); the two monomorphic corners are empty"}`);
  if (sfs.shape.length === 1) {
    const n = sfs.shape[0] - 1;
    lines.push(`${folded ? "minor_count" : "derived_count"},expected_sites,proportion_of_snps`);
    let tot = 0;
    for (let i = 0; i <= n; i++) if (!mask[i]) tot += data[i];
    for (let i = 0; i <= n; i++) lines.push(mask[i] ? `${i},,` : `${i},${g17(data[i])},${g17(data[i] / tot)}`);
  } else {
    const [d1, d2] = sfs.shape;
    lines.push(`# rows: derived count in pop 1 (i = 0..${d1 - 1}); columns: derived count in pop 2 (j = 0..${d2 - 1})`);
    lines.push(["i\\j", ...Array.from({ length: d2 }, (_, j) => String(j))].join(","));
    for (let i = 0; i < d1; i++) lines.push([String(i), ...Array.from({ length: d2 }, (_, j) => (mask[i * d2 + j] ? "" : g17(data[i * d2 + j])))].join(","));
  }
  return lines.join("\n") + "\n";
}

/** dadi/moments `.fs` format (see moments.Spectrum.to_file). */
export function sfsFs(sfs: NDArray, m: Model, s: AppState): string {
  const { data, mask, folded } = shown(sfs, s);
  const pops = sfs.shape.length === 1 ? ['"pop1"'] : ['"pop1"', '"pop2"'];
  return [
    ...header(m, s).map((l) => `# ${l}`),
    `${sfs.shape.join(" ")} ${folded ? "folded" : "unfolded"} ${pops.join(" ")}`,
    Array.from(data, g17).join(" "),
    Array.from(mask, (v) => String(v)).join(" "),
    "",
  ].join("\n");
}

export function demesYaml(m: Model, s: AppState): string {
  return toDemesYaml(m, {
    Nref: s.units.Nref,
    generationTime: s.units.physical ? s.units.gen : undefined,
    description: `Exported from "Demographic history and the expected SFS" v${BUILD.version}`,
  });
}
