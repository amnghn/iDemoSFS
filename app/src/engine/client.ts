/**
 * Main-thread client of the engine worker.
 *
 * - `Engine.compute(model, dtFac)`: one spectrum, with an LRU cache keyed by the canonical
 *   model JSON. Without Worker support (tests), it computes synchronously.
 * - `LiveRunner`: for the live view. At most one job runs; only the newest waiting request is
 *   kept ("latest request wins"). A result is shown unless a newer one is already shown.
 *   A spinner is requested when the newest result takes longer than 200 ms; the old plot stays.
 */

import { computeSFS } from "./compute.ts";
import type { Model } from "./model.ts";
import type { WorkerJob, WorkerReply } from "./worker.ts";
import { vcfToGenotypeCounts } from "../stats/vcf.ts";

export interface SfsResult {
  shape: number[];
  data: Float64Array; // unfolded, theta = 1
  simN: number[];
  ms: number;
  steps: number;
  dtFac: number;
  key: string;
}

export const FINAL_DT = 0.02;
export const DRAFT_DT = 0.1;

export const modelKey = (m: Model, dtFac: number): string => `${dtFac}|${JSON.stringify(m)}`;

class LRU<V> {
  private map = new Map<string, V>();
  constructor(private max: number) {}
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: string, v: V): void {
    this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
}

export class Engine {
  private worker: Worker | null = null;
  private seq = 0;
  private waiting = new Map<number, { resolve: (r: WorkerReply) => void; reject: (e: Error) => void }>();
  private cache = new LRU<SfsResult>(96);

  constructor(useWorker = typeof Worker !== "undefined") {
    if (!useWorker) return;
    try {
      this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (ev: MessageEvent<WorkerReply>) => {
        const w = this.waiting.get(ev.data.id);
        if (!w) return;
        this.waiting.delete(ev.data.id);
        w.resolve(ev.data);
      };
      this.worker.onerror = (ev) => {
        // a broken worker: answer every waiting job with an error and fall back to the main thread
        for (const w of this.waiting.values()) w.reject(new Error(ev.message || "worker error"));
        this.waiting.clear();
        this.worker = null;
      };
    } catch {
      this.worker = null;
    }
  }

  cached(m: Model, dtFac: number): SfsResult | undefined {
    return this.cache.get(modelKey(m, dtFac));
  }

  private post(job: WorkerJob, transfer: Transferable[] = []): Promise<WorkerReply> {
    return new Promise((resolve, reject) => {
      this.waiting.set(job.id, { resolve, reject });
      this.worker!.postMessage(job, transfer);
    });
  }

  async compute(model: Model, dtFac: number = FINAL_DT): Promise<SfsResult> {
    const key = modelKey(model, dtFac);
    const hit = this.cache.get(key);
    if (hit) return hit;
    let res: SfsResult;
    if (!this.worker) {
      await Promise.resolve();
      const r = computeSFS(model, { dtFac });
      res = { shape: r.sfs.shape, data: r.sfs.data, simN: r.plan.simN, ms: r.stats.ms, steps: r.stats.steps, dtFac, key };
    } else {
      const reply = await this.post({ kind: "sfs", id: ++this.seq, model, dtFac });
      if (!reply.ok) throw new Error(reply.error);
      if (reply.kind !== "sfs") throw new Error("unexpected reply");
      res = { shape: reply.shape, data: reply.data, simN: reply.simN, ms: reply.ms, steps: reply.steps, dtFac, key };
    }
    this.cache.set(key, res);
    return res;
  }

  /** Parse a VCF in the worker (calculator mode); falls back to the main thread. */
  async vcf(buffer: ArrayBuffer, gzip: boolean, popmap: Record<string, 1 | 2>): Promise<{ counts: Float64Array; sites: number; skipped: Record<string, number>; samples: [number, number] }> {
    if (!this.worker) {
      let text: string;
      if (gzip) {
        const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
        text = await new Response(stream).text();
      } else text = new TextDecoder().decode(buffer);
      return vcfToGenotypeCounts(text, popmap);
    }
    const reply = await this.post({ kind: "vcf", id: ++this.seq, buffer, gzip, popmap }, [buffer]);
    if (!reply.ok) throw new Error(reply.error);
    if (reply.kind !== "vcf") throw new Error("unexpected reply");
    return { counts: reply.counts, sites: reply.sites, skipped: reply.skipped, samples: reply.samples };
  }

  get usesWorker(): boolean {
    return this.worker !== null;
  }
}

export class LiveRunner {
  private seq = 0;
  private shown = 0;
  private queued: { id: number; model: Model; dtFac: number } | null = null;
  private busy = false;
  private spinnerTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private engine: Engine,
    private onResult: (r: SfsResult, model: Model) => void,
    private onError: (msg: string) => void,
    private onBusy: (busy: boolean) => void,
    private spinnerDelay = 200,
  ) {}

  request(model: Model, draft: boolean): void {
    const id = ++this.seq;
    const dtFac = draft ? DRAFT_DT : FINAL_DT;
    // a final result in the cache is always good enough, also for a draft request
    const hit = this.engine.cached(model, FINAL_DT) ?? this.engine.cached(model, dtFac);
    if (hit) {
      this.queued = null;
      this.show(id, hit, model);
      return;
    }
    this.queued = { id, model, dtFac };
    this.armSpinner();
    if (!this.busy) void this.pump();
  }

  private armSpinner(): void {
    if (this.spinnerTimer) return;
    this.spinnerTimer = setTimeout(() => {
      this.spinnerTimer = null;
      if (this.shown < this.seq) this.onBusy(true);
    }, this.spinnerDelay);
  }

  private show(id: number, r: SfsResult, model: Model): void {
    if (id <= this.shown) return;
    this.shown = id;
    if (id === this.seq) {
      if (this.spinnerTimer) clearTimeout(this.spinnerTimer);
      this.spinnerTimer = null;
      this.onBusy(false);
    }
    this.onResult(r, model);
  }

  private async pump(): Promise<void> {
    this.busy = true;
    while (this.queued) {
      const job = this.queued;
      this.queued = null;
      try {
        const r = await this.engine.compute(job.model, job.dtFac);
        this.show(job.id, r, job.model);
      } catch (e) {
        if (job.id === this.seq) {
          this.shown = job.id;
          this.onBusy(false);
          this.onError(e instanceof Error ? e.message : String(e));
        }
      }
    }
    this.busy = false;
  }
}
