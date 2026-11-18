/**
 * Citations inside TypeScript-generated text, resolved against the verified reference table
 * (docs/REFERENCES.bib, via src/generated/content.ts). An unknown key throws, so a typo cannot
 * produce an unverified reference.
 */

import { CITATIONS } from "../generated/content.ts";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function citeOne(key: string): string {
  const c = CITATIONS[key];
  if (!c) throw new Error(`unknown citation key: ${key}`);
  const text = c.year ? `${c.author} ${c.year}` : c.author;
  return `<a class="cite" href="${esc(c.href)}" title="${esc(c.plain)}" rel="noopener">${esc(text)}</a>`;
}

/** "(Author Year; Author Year)" with DOI links. */
export const cite = (...keys: string[]): string => `(${keys.map(citeOne).join("; ")})`;
