import { describe, expect, it } from "vitest";
import { equilibriumSelectionSFS } from "../src/engine/diffusion.ts";
import { computeSFS } from "../src/engine/compute.ts";
import { defaultModel, Model } from "../src/engine/model.ts";

/** max relative error over bins holding at least `frac` of the polymorphic mass */
function err(a: ArrayLike<number>, b: ArrayLike<number>, frac: number): number {
  const n = b.length - 1;
  let tot = 0;
  for (let i = 1; i < n; i++) tot += Math.abs(b[i]);
  let m = 0;
  for (let i = 1; i < n; i++) if (Math.abs(b[i]) >= frac * tot) m = Math.max(m, Math.abs(a[i] - b[i]) / Math.abs(b[i]));
  return m;
}

describe("selection: exact equilibrium of the diffusion (independent oracle)", () => {
  it("gamma -> 0 gives the neutral spectrum 1/i", () => {
    const x = equilibriumSelectionSFS(20, 1e-9, 0.5);
    for (let i = 1; i < 20; i++) expect(Math.abs(x[i] * i - 1)).toBeLessThan(1e-8);
  });
  for (const h of [0.1, 0.5, 0.9])
    for (const g of [-20, -5, 5, 20]) {
      it(`engine defaults (internal n = 100) within 1 % of the exact equilibrium in the main bins: gamma = ${g}, h = ${h}`, () => {
        const m: Model = { ...defaultModel(), mode: 1, ancestral: [{ nu: 1, T: 0.1, dyn: "sudden" }],
          selection: { on: true, gamma: g, h }, n: [20, 20] };
        const r = computeSFS(m);
        expect(r.plan.simN[0]).toBe(100);
        expect(err(r.sfs.data, equilibriumSelectionSFS(20, g, h), 1e-2)).toBeLessThan(1e-2);
      });
    }
});
