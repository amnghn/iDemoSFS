/**
 * Share the state through the URL: ?v=1&s=<base64url(JSON)>. The version number lets later
 * versions of the app read old links. Unknown or broken links fall back to the defaults.
 */

import { AppState, defaultState } from "./state.ts";
import { modelFromOverrides } from "../engine/model.ts";

export const URL_VERSION = 1;

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Round numbers to 6 significant digits to keep links short. */
function compact(x: unknown): unknown {
  if (typeof x === "number") return Number.isFinite(x) ? Number(x.toPrecision(6)) : x;
  if (Array.isArray(x)) return x.map(compact);
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, compact(v)]));
  return x;
}

export function encodeState(s: AppState): string {
  const { preset: _preset, ...rest } = s;
  return toBase64Url(JSON.stringify(compact(rest)));
}

/** Merge a decoded object into the defaults (unknown keys are ignored). */
export function decodeState(encoded: string): AppState {
  const raw = JSON.parse(fromBase64Url(encoded)) as Partial<AppState>;
  const d = defaultState();
  const s: AppState = {
    ...d,
    model: modelFromOverrides(raw.model ?? {}, d.model),
    dynOn: { ...d.dynOn, ...(raw.dynOn ?? {}) },
    symMig: Boolean(raw.symMig ?? d.symMig),
    masksOn: Boolean(raw.masksOn ?? d.masksOn),
    dominanceOn: Boolean(raw.dominanceOn ?? d.dominanceOn),
    display: { ...d.display, ...(raw.display ?? {}) },
    units: { ...d.units, ...(raw.units ?? {}) },
    wcMode: raw.wcMode ?? d.wcMode,
    preset: "",
  };
  return s;
}

/** Read the state from a URL search string; returns null when there is none. */
export function stateFromSearch(search: string): { state: AppState | null; error: string | null } {
  const p = new URLSearchParams(search);
  const enc = p.get("s");
  if (!enc) return { state: null, error: null };
  const v = Number(p.get("v") ?? URL_VERSION);
  if (v > URL_VERSION) return { state: null, error: `This link was made with a newer version of the app (link version ${v}).` };
  try {
    return { state: decodeState(enc), error: null };
  } catch {
    return { state: null, error: "The model in this link could not be read. The default model is shown instead." };
  }
}

export function shareUrl(s: AppState, base: string = location.href): string {
  const u = new URL(base);
  u.search = `?v=${URL_VERSION}&s=${encodeState(s)}`;
  return u.toString();
}
