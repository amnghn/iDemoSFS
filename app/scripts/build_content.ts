/**
 * Build-time content pipeline (run by `npm run content`, and before `dev`, `build` and `test`).
 *
 * - Renders the teaching text in src/content/*.md with markdown-it and KaTeX ($...$ inline,
 *   $$...$$ on their own lines), so no maths is typeset at run time.
 * - Resolves citations: [@key], [@key1; @key2] -> "(Author Year; Author Year)" with DOI links,
 *   and [-@key] -> "(Year)" for narrative use ("Tajima [-@tajima1989statistical]").
 *   Keys are looked up in docs/REFERENCES.bib, which holds verified references only.
 *   An unknown key stops the build.
 * - Splits each file into sections at level-2 headings written as "## Title {#id}".
 * - Writes src/generated/content.ts with the HTML, the reference list and build information
 *   (version from package.json, date of the last CHANGELOG.md entry).
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import katex from "katex";
import { parseBib, citeTable, htmlReference, escapeHtml, BibEntry, CiteInfo } from "./content/bib.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..");
const ROOT = resolve(APP, "..");
const CONTENT_DIR = join(APP, "src", "content");
const OUT_DIR = join(APP, "src", "generated");

// ---------------------------------------------------------------- maths

function mathPlugin(md: MarkdownIt): void {
  md.inline.ruler.after("escape", "math_inline", (state, silent) => {
    const src = state.src;
    const start = state.pos;
    if (src[start] !== "$" || src[start + 1] === "$") return false;
    let end = start + 1;
    while (end < state.posMax) {
      if (src[end] === "\\") {
        end += 2;
        continue;
      }
      if (src[end] === "$") break;
      end++;
    }
    if (end >= state.posMax) return false;
    const content = src.slice(start + 1, end);
    if (!content.trim() || /^\s/.test(content) || /\s$/.test(content)) return false;
    if (!silent) {
      const t = state.push("math_inline", "math", 0);
      t.content = content;
    }
    state.pos = end + 1;
    return true;
  });
  md.block.ruler.before("fence", "math_block", (state, startLine, endLine, silent) => {
    const pos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const first = state.src.slice(pos, max).trim();
    if (!first.startsWith("$$")) return false;
    if (silent) return true;
    let content: string;
    let next = startLine;
    if (first.length > 4 && first.endsWith("$$")) content = first.slice(2, -2);
    else {
      const lines: string[] = [first.slice(2)];
      let found = false;
      while (++next < endLine) {
        const line = state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next]);
        if (line.trim().endsWith("$$")) {
          lines.push(line.trim().slice(0, -2));
          found = true;
          break;
        }
        lines.push(line);
      }
      if (!found) throw new Error(`unclosed $$ block at line ${startLine + 1}`);
      content = lines.join("\n");
    }
    state.line = next + 1;
    const t = state.push("math_block", "math", 0);
    t.block = true;
    t.content = content;
    t.map = [startLine, state.line];
    return true;
  });
  const render = (tex: string, display: boolean): string =>
    katex.renderToString(tex, { displayMode: display, throwOnError: true, output: "htmlAndMathml", strict: "warn" });
  md.renderer.rules.math_inline = (tokens, idx) => render(tokens[idx].content, false);
  md.renderer.rules.math_block = (tokens, idx) => `<div class="math-display">${render(tokens[idx].content, true)}</div>\n`;
}

// ---------------------------------------------------------------- citations

const citedKeys = new Set<string>();

function citeLink(c: CiteInfo, text: string): string {
  return `<a class="cite" href="${escapeHtml(c.href)}" title="${escapeHtml(c.plain)}" rel="noopener" data-key="${c.key}">${escapeHtml(text)}</a>`;
}

export function resolveCitations(text: string, table: Map<string, CiteInfo>, file: string): string {
  return text.replace(/\[(-?@[A-Za-z0-9_:-]+(?:\s*;\s*-?@[A-Za-z0-9_:-]+)*)\]/g, (_m, inner: string) => {
    const parts = inner.split(/\s*;\s*/).map((p) => {
      const yearOnly = p.startsWith("-");
      const key = p.replace(/^-?@/, "");
      const c = table.get(key);
      if (!c) throw new Error(`${file}: unknown citation key "${key}" (not in docs/REFERENCES.bib)`);
      citedKeys.add(key);
      if (!c.year) return citeLink(c, c.author); // web resource
      return citeLink(c, yearOnly ? c.year : `${c.author} ${c.year}`);
    });
    return `(${parts.join("; ")})`;
  });
}

// ---------------------------------------------------------------- sections

export interface Section {
  id: string;
  title: string;
  html: string;
}

function renderFile(md: MarkdownIt, file: string, table: Map<string, CiteInfo>): { intro: string; sections: Section[] } {
  const raw = readFileSync(file, "utf-8").replace(/<!--[\s\S]*?-->/g, "");
  const text = resolveCitations(raw, table, file);
  const lines = text.split("\n");
  const sections: { id: string; title: string; body: string[] }[] = [];
  const intro: string[] = [];
  for (const line of lines) {
    const h = /^## (.+?)\s*\{#([A-Za-z0-9-]+)\}\s*$/.exec(line);
    if (h) sections.push({ id: h[2], title: h[1], body: [] });
    else if (sections.length) sections[sections.length - 1].body.push(line);
    else intro.push(line);
  }
  const ids = new Set<string>();
  for (const s of sections) {
    if (ids.has(s.id)) throw new Error(`${file}: duplicate section id ${s.id}`);
    ids.add(s.id);
  }
  return {
    intro: md.render(intro.join("\n")),
    sections: sections.map((s) => ({ id: s.id, title: md.renderInline(s.title), html: md.render(s.body.join("\n")) })),
  };
}

// ---------------------------------------------------------------- reference list

const GROUP_ORDER = [
  "Coalescent and SFS theory",
  "Demography and the SFS (single population)",
  "Joint SFS, structure, migration and admixture",
  "Selection, dominance and inbreeding",
  "Diversity, divergence and differentiation statistics",
  "Limits of SFS-based inference",
  "Software, model formats and simulation",
  "Online documentation",
];

function referenceList(entries: BibEntry[]): { group: string; items: { key: string; html: string }[] }[] {
  const groups = new Map<string, BibEntry[]>();
  for (const e of entries) {
    const g = e.fields.keywords ?? "Other";
    groups.set(g, [...(groups.get(g) ?? []), e]);
  }
  const order = [...GROUP_ORDER, ...[...groups.keys()].filter((g) => !GROUP_ORDER.includes(g)).sort()];
  return order
    .filter((g) => groups.has(g))
    .map((g) => ({
      group: g,
      items: groups
        .get(g)!
        .slice()
        .sort((a, b) => (a.fields.author ?? "").toLowerCase().localeCompare((b.fields.author ?? "").toLowerCase()) || (a.fields.year ?? "").localeCompare(b.fields.year ?? ""))
        .map((e) => ({ key: e.key, html: htmlReference(e) })),
    }));
}

// ---------------------------------------------------------------- main

function lastChangelogDate(text: string): string {
  const stamps = [...text.matchAll(/^### (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[+-]\d{2}:\d{2})/gm)].map((m) => m[1]);
  if (!stamps.length) throw new Error("CHANGELOG.md has no timestamped entries");
  return stamps.sort().slice(-1)[0];
}

export function buildContent(): { files: number; cited: number } {
  const bibEntries = parseBib(readFileSync(join(ROOT, "docs", "REFERENCES.bib"), "utf-8"));
  const table = citeTable(bibEntries);
  const md = new MarkdownIt({ html: true, linkify: false, typographer: false });
  md.use(mathPlugin);
  // external links open safely
  const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const href = tokens[idx].attrGet("href") ?? "";
    if (/^https?:/.test(href)) tokens[idx].attrSet("rel", "noopener");
    return defaultLinkOpen(tokens, idx, options, env, self);
  };
  const files = readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".md")).sort();
  const docs: Record<string, { intro: string; sections: Section[] }> = {};
  for (const f of files) docs[f.replace(/\.md$/, "")] = renderFile(md, join(CONTENT_DIR, f), table);
  const pkg = JSON.parse(readFileSync(join(APP, "package.json"), "utf-8"));
  const build = {
    version: pkg.version as string,
    lastChange: lastChangelogDate(readFileSync(join(ROOT, "CHANGELOG.md"), "utf-8")),
    referenceCount: bibEntries.length,
  };
  // related tools: only entries whose URL returned HTTP 200 in docs/related_tools_check.tsv
  const readTsv = (f: string): Record<string, string>[] => {
    const [head, ...rows] = readFileSync(f, "utf-8").trim().split(/\r?\n/).map((l) => l.split("\t"));
    return rows.map((r) => Object.fromEntries(head.map((h, k) => [h, r[k] ?? ""])));
  };
  const checked = new Map(readTsv(join(ROOT, "docs", "related_tools_check.tsv")).map((r) => [r.url, r]));
  const related = readTsv(join(ROOT, "docs", "related_tools.tsv"))
    .filter((r) => checked.get(r.url)?.status === "200")
    .map((r) => ({ name: r.name, url: r.url, what: r.what, checked: checked.get(r.url)!.checked }));
  const cites: Record<string, { author: string; year: string; href: string; plain: string }> = {};
  for (const [k, c] of table) cites[k] = { author: c.author, year: c.year, href: c.href, plain: c.plain };
  mkdirSync(OUT_DIR, { recursive: true });
  const out =
    `// Generated by scripts/build_content.ts. Do not edit; edit src/content/*.md and docs/REFERENCES.bib.\n` +
    `export const BUILD = ${JSON.stringify(build)} as const;\n` +
    `export const DOCS: Record<string, { intro: string; sections: { id: string; title: string; html: string }[] }> = ${JSON.stringify(docs)};\n` +
    `export const REFERENCE_LIST: { group: string; items: { key: string; html: string }[] }[] = ${JSON.stringify(referenceList(bibEntries))};\n` +
    `export const CITATIONS: Record<string, { author: string; year: string; href: string; plain: string }> = ${JSON.stringify(cites)};\n` +
    `export const CITED_KEYS: string[] = ${JSON.stringify([...citedKeys].sort())};\n` +
    `export const RELATED_TOOLS: { name: string; url: string; what: string; checked: string }[] = ${JSON.stringify(related)};\n`;
  writeFileSync(join(OUT_DIR, "content.ts"), out, "utf-8");
  return { files: files.length, cited: citedKeys.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = buildContent();
  console.log(`content: ${r.files} Markdown files, ${r.cited} cited references -> src/generated/content.ts`);
}
