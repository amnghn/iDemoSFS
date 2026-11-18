/// <reference lib="webworker" />
/**
 * Web Worker: computes expected spectra off the main thread, so the page never freezes.
 * It also parses VCF files for the exact Weir & Cockerham option (calculator mode).
 */

import { computeSFS } from "./compute.ts";
import type { Model } from "./model.ts";
import { vcfToGenotypeCounts } from "../stats/vcf.ts";

export type WorkerJob =
  | { kind: "sfs"; id: number; model: Model; dtFac: number }
  | { kind: "vcf"; id: number; buffer: ArrayBuffer; gzip: boolean; popmap: Record<string, 1 | 2> };

export type WorkerReply =
  | { kind: "sfs"; id: number; ok: true; shape: number[]; data: Float64Array; simN: number[]; ms: number; steps: number }
  | { kind: "vcf"; id: number; ok: true; counts: Float64Array; sites: number; skipped: Record<string, number>; samples: [number, number] }
  | { kind: "sfs" | "vcf"; id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

async function gunzip(buf: ArrayBuffer): Promise<string> {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

ctx.onmessage = async (ev: MessageEvent<WorkerJob>) => {
  const job = ev.data;
  try {
    if (job.kind === "sfs") {
      const r = computeSFS(job.model, { dtFac: job.dtFac });
      const data = r.sfs.data;
      const reply: WorkerReply = { kind: "sfs", id: job.id, ok: true, shape: r.sfs.shape, data, simN: r.plan.simN, ms: r.stats.ms, steps: r.stats.steps };
      ctx.postMessage(reply, [data.buffer]);
    } else {
      const text = job.gzip ? await gunzip(job.buffer) : new TextDecoder().decode(job.buffer);
      const r = vcfToGenotypeCounts(text, job.popmap);
      const reply: WorkerReply = { kind: "vcf", id: job.id, ok: true, counts: r.counts, sites: r.sites, skipped: r.skipped, samples: r.samples };
      ctx.postMessage(reply, [r.counts.buffer]);
    }
  } catch (e) {
    ctx.postMessage({ kind: job.kind, id: job.id, ok: false, error: e instanceof Error ? e.message : String(e) } satisfies WorkerReply);
  }
};
