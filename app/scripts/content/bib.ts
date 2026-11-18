/**
 * Minimal reader for docs/REFERENCES.bib (written by tools/verify_references.py; one field per
 * line, `name = {value},`). Used at build time to resolve [@key] citations and to render the
 * reference list. Only verified entries exist in the .bib file, so an unknown key is an error.
 */

export interface BibEntry {
  type: string;
  key: string;
  fields: Record<string, string>;
}

export function parseBib(text: string): BibEntry[] {
  const out: BibEntry[] = [];
  const re = /^@(\w+)\{([^,]+),\n([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const fields: Record<string, string> = {};
    for (const line of m[3].split("\n")) {
      const f = /^\s*(\w+) = \{(.*)\},\s*$/.exec(line);
      if (f) fields[f[1]] = f[2];
    }
    out.push({ type: m[1], key: m[2].trim(), fields });
  }
  return out;
}

export const stripBraces = (s: string): string =>
  s.replace(/[{}]/g, "").replace(/\\&/g, "&").replace(/\\%/g, "%").replace(/\\url/g, "");

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Family names of the authors ("Last, First and ..."), or the corporate author. */
export function familyNames(author: string): string[] {
  const trimmed = author.trim();
  if (/^\{.*\}$/.test(trimmed)) return [stripBraces(trimmed)];
  return trimmed
    .split(/\s+and\s+/)
    .map((a) => stripBraces(a.includes(",") ? a.split(",")[0] : a.split(/\s+/).slice(-1)[0]).trim())
    .filter(Boolean);
}

/** Author part of a short citation: "Kingman", "Slatkin & Hudson", "Marth et al.". */
export function shortAuthor(e: BibEntry): string {
  if (e.type === "misc") return stripBraces(e.fields.title ?? e.key);
  const fam = familyNames(e.fields.author ?? "");
  if (fam.length === 1) return fam[0];
  if (fam.length === 2) return `${fam[0]} & ${fam[1]}`;
  return `${fam[0]} et al.`;
}

export interface CiteInfo {
  key: string;
  author: string; // short author part
  year: string; // with a/b suffix when needed
  href: string; // DOI link or URL
  plain: string; // full reference as plain text (tooltip)
}

/** Short labels for all entries, with a/b suffixes for equal author-year pairs. */
export function citeTable(entries: BibEntry[]): Map<string, CiteInfo> {
  const groups = new Map<string, BibEntry[]>();
  for (const e of entries) {
    const g = `${shortAuthor(e)}|${e.fields.year ?? ""}`;
    groups.set(g, [...(groups.get(g) ?? []), e]);
  }
  const table = new Map<string, CiteInfo>();
  for (const e of entries) {
    const g = groups.get(`${shortAuthor(e)}|${e.fields.year ?? ""}`)!;
    const suffix = g.length > 1 && e.type !== "misc" ? String.fromCharCode(97 + g.indexOf(e)) : "";
    table.set(e.key, {
      key: e.key,
      author: shortAuthor(e),
      year: e.type === "misc" ? "" : `${e.fields.year ?? ""}${suffix}`,
      href: e.fields.doi ? `https://doi.org/${e.fields.doi}` : e.fields.url ?? "",
      plain: plainReference(e),
    });
  }
  return table;
}

function authorList(author: string): string {
  const trimmed = author.trim();
  if (/^\{.*\}$/.test(trimmed)) return stripBraces(trimmed);
  const names = trimmed.split(/\s+and\s+/).map((a) => {
    if (!a.includes(",")) return stripBraces(a).trim();
    const [last, first] = a.split(",", 2).map((x) => stripBraces(x).trim());
    const initials = first
      .split(/[\s.-]+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("");
    return `${last} ${initials}`.trim();
  });
  return names.length > 6 ? `${names.slice(0, 6).join(", ")}, et al.` : names.join(", ");
}

/** Full reference in the style of the design note: "Author (year) Title. Journal vol: pages." */
export function plainReference(e: BibEntry): string {
  const f = e.fields;
  const title = stripBraces(f.title ?? "").replace(/\.$/, "");
  if (e.type === "misc") return `${title}. ${stripBraces(f.author ?? "")}. ${f.url ?? ""} (checked ${f.urldate ?? ""}).`;
  let src = "";
  if (e.type === "article") src = `${stripBraces(f.journal ?? "")} ${f.volume ?? ""}: ${(f.pages ?? "").replace("--", "–")}`;
  else if (e.type === "incollection")
    src = `In: ${stripBraces(f.booktitle ?? "")} ${f.volume ?? ""}: ${(f.pages ?? "").replace("--", "–")}. ${stripBraces(f.publisher ?? "")}`;
  else if (e.type === "book") src = stripBraces(f.publisher ?? "");
  return `${authorList(f.author ?? "")} (${f.year ?? ""}) ${title}. ${src.trim()}.`;
}

/** Full reference as HTML with a DOI (or URL / ISBN) link. */
export function htmlReference(e: BibEntry): string {
  const f = e.fields;
  const title = escapeHtml(stripBraces(f.title ?? "").replace(/\.$/, ""));
  if (e.type === "misc") {
    const url = escapeHtml(f.url ?? "");
    return `<strong>${title}</strong>. ${escapeHtml(stripBraces(f.author ?? ""))}. <a href="${url}" rel="noopener">${url}</a> (checked ${escapeHtml(f.urldate ?? "")}).`;
  }
  let src = "";
  if (e.type === "article") src = `<em>${escapeHtml(stripBraces(f.journal ?? ""))}</em> ${escapeHtml(f.volume ?? "")}: ${escapeHtml((f.pages ?? "").replace("--", "–"))}`;
  else if (e.type === "incollection")
    src = `In: <em>${escapeHtml(stripBraces(f.booktitle ?? ""))}</em> ${escapeHtml(f.volume ?? "")}: ${escapeHtml((f.pages ?? "").replace("--", "–"))}. ${escapeHtml(stripBraces(f.publisher ?? ""))}`;
  else if (e.type === "book") src = escapeHtml(stripBraces(f.publisher ?? ""));
  let link = "";
  if (f.doi) link = ` <a href="https://doi.org/${escapeHtml(f.doi)}" rel="noopener">doi:${escapeHtml(f.doi)}</a>.`;
  else {
    const parts: string[] = [];
    if (f.isbn) parts.push(`ISBN ${escapeHtml(f.isbn)}`);
    if (f.url) parts.push(`<a href="${escapeHtml(f.url)}" rel="noopener">link</a>`);
    const note = (f.note ?? "").includes("confirmed by the app author") ? "No DOI; edition confirmed by the app author" : "No DOI";
    link = ` ${parts.join(", ")}${parts.length ? ". " : ""}<span class="muted">${note}.</span>`;
  }
  return `${escapeHtml(authorList(f.author ?? ""))} (${escapeHtml(f.year ?? "")}) ${title}. ${src}.${link}`;
}
