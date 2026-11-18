/**
 * Closure error of the jackknife under selection (DESIGN.md Section 4.8), against the exact
 * equilibrium SFS of the diffusion (src/engine/diffusion.ts). For each gamma and h: the
 * equilibrium spectrum at n = 20 computed directly with the moment equations, at n_int = 40 and
 * at n_int = 100 projected to 20. Errors: max relative error over "bulk" bins (>= 1 % of the
 * polymorphic mass) and over all bins with >= 0.01 % of the mass; number of negative bins.
 *   tsx scripts/selection_closure_study.ts > ../validation/output/selection_closure_error.tsv
 */
import { steadyState1D } from "../src/engine/integrate.ts";
import { project } from "../src/engine/ndarray.ts";
import { equilibriumSelectionSFS } from "../src/engine/diffusion.ts";

const n = 20;
const err = (a: ArrayLike<number>, b: ArrayLike<number>, frac: number) => {
  let tot = 0;
  for (let i = 1; i < n; i++) tot += Math.abs(b[i]);
  let m = 0;
  for (let i = 1; i < n; i++) if (Math.abs(b[i]) >= frac * tot) m = Math.max(m, Math.abs(a[i] - b[i]) / Math.abs(b[i]));
  return m;
};
const neg = (x: ArrayLike<number>) => Array.from(x).slice(1, n).filter((v) => v < 0).length;
const cols = ["gamma", "h"];
for (const k of ["n20", "n40_to_20", "n100_to_20"]) cols.push(`${k}_bulk`, `${k}_tail`, `${k}_negative`);
console.log(cols.join("\t"));
for (const h of [0.1, 0.5, 0.9])
  for (const g of [-50, -30, -20, -10, -5, -1, 1, 5, 10, 20, 30, 50]) {
    const exact = equilibriumSelectionSFS(n, g, h);
    const row: (string | number)[] = [g, h];
    for (const nInt of [20, 40, 100]) {
      const s = nInt === n ? steadyState1D(n, g, h).data : project(steadyState1D(nInt, g, h), [n]).data;
      row.push(err(s, exact, 1e-2).toExponential(2), err(s, exact, 1e-4).toExponential(2), neg(s));
    }
    console.log(row.join("\t"));
  }
