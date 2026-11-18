/**
 * Browser timing of the engine (bench.html): median time of computeSFS for representative
 * validation models at full accuracy (dt_fac 0.02) and in draft mode (0.1), on the main thread.
 * The result is written as JSON into #result; #done appears when finished.
 */

import { computeSFS } from "./engine/compute.ts";
import { modelFromOverrides } from "./engine/model.ts";

const files = import.meta.glob("../../validation/models/*.json", { eager: true, import: "default" }) as Record<string, unknown>;
const pick = ["snm", "exp_exponential_recent", "bottleneck_strong_recent", "three_epoch_mixed", "sel_neg10", "split_old_nomig", "im_sym", "im_exponential", "im_linear", "secondary_contact", "pulse_1to2", "structure_3_2_mixed", "im_selection"];

async function main(): Promise<void> {
  const out: { model: string; full_ms: number; draft_ms: number; sim_n: number[] }[] = [];
  const el = document.getElementById("result")!;
  for (const id of pick) {
    const json = Object.entries(files).find(([p]) => p.endsWith(`/${id}.json`))?.[1];
    if (!json) continue;
    const m = modelFromOverrides(json);
    // browsers round the timer (Firefox: 1 ms), so fast models are timed in batches of at least 100 ms
    const time = (dtFac: number): number => {
      computeSFS(m, { dtFac });
      const t: number[] = [];
      for (let r = 0; r < 5; r++) {
        let k = 0;
        const t0 = performance.now();
        do {
          computeSFS(m, { dtFac });
          k++;
        } while (performance.now() - t0 < 100);
        t.push((performance.now() - t0) / k);
      }
      return t.sort((a, b) => a - b)[2];
    };
    const r = computeSFS(m);
    out.push({ model: id, full_ms: Number(time(0.02).toFixed(2)), draft_ms: Number(time(0.1).toFixed(2)), sim_n: r.plan.simN });
    el.textContent = JSON.stringify(out, null, 1);
    await new Promise((res) => setTimeout(res, 0));
  }
  el.textContent = JSON.stringify({ userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, results: out });
  const done = document.createElement("span");
  done.id = "done";
  document.body.append(done);
}

void main();
