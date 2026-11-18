#!/usr/bin/env python3
"""Render docs/REFERENCES.bib as a Markdown reference list, grouped by the
`keywords` field, and write it between the markers

    <!-- REFERENCES:START -->
    <!-- REFERENCES:END -->

of a Markdown file (default: docs/DESIGN.md). Standard library only.

Usage:
  python3 tools/render_reference_list.py [docs/DESIGN.md] [--cited-only]

With --cited-only, only the entries cited in the Markdown file ([@key]) are listed.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BIB = ROOT / "docs" / "REFERENCES.bib"
START, END = "<!-- REFERENCES:START -->", "<!-- REFERENCES:END -->"
GROUP_ORDER = [
    "Coalescent and SFS theory",
    "Demography and the SFS (single population)",
    "Joint SFS, structure, migration and admixture",
    "Selection, dominance and inbreeding",
    "Diversity, divergence and differentiation statistics",
    "Limits of SFS-based inference",
    "Software, model formats and simulation",
    "Online documentation",
]


def parse_bib(text):
    entries = []
    for m in re.finditer(r"^@(\w+)\{([^,]+),\n(.*?)^\}", text, flags=re.M | re.S):
        etype, key, body = m.group(1), m.group(2), m.group(3)
        fields = {}
        for fm in re.finditer(r"^\s*(\w+) = \{(.*)\},\s*$", body, flags=re.M):
            fields[fm.group(1)] = fm.group(2)
        entries.append((etype, key, fields))
    return entries


def strip_braces(s):
    return s.replace("{", "").replace("}", "").replace(r"\&", "&").replace(r"\%", "%")


def short_authors(a):
    names = [x.strip() for x in strip_braces(a).split(" and ") if x.strip()]
    fam = []
    for n in names:
        if "," in n:
            last, first = [p.strip() for p in n.split(",", 1)]
            initials = "".join(w[0] for w in re.split(r"[\s\-\.]+", first) if w)
            fam.append(f"{last} {initials}".strip())
        else:
            fam.append(n)
    if len(fam) > 6:
        return ", ".join(fam[:6]) + ", et al."
    return ", ".join(fam)


def fmt(etype, key, f):
    au = short_authors(f.get("author", ""))
    year = f.get("year", "")
    title = strip_braces(f.get("title", "")).rstrip(".")
    if etype == "article":
        vol = f.get("volume", "")
        pages = f.get("pages", "").replace("--", "–")
        src = f"*{strip_braces(f.get('journal', ''))}* {vol}: {pages}".strip()
    elif etype == "incollection":
        src = (f"In: *{strip_braces(f.get('booktitle', ''))}* {f.get('volume', '')}: "
               f"{f.get('pages', '').replace('--', '–')}. {strip_braces(f.get('publisher', ''))}")
    elif etype == "book":
        src = strip_braces(f.get("publisher", ""))
    else:
        src = ""
    if etype == "misc":
        return f"- **{title}**. {au}. <{f.get('url', '')}> (checked {f.get('urldate', '')}). `[{key}]`"
    link = f"[doi:{f['doi']}](https://doi.org/{f['doi']})" if f.get("doi") else \
        (f"ISBN {f['isbn']}, <{f['url']}>" if f.get("isbn") else
         (f"<{f['url']}>" if f.get("url") else ""))
    link = f" {link}." if link else ""
    note = " *No DOI.*" if not f.get("doi") else ""
    if "confirmed by the app author" in f.get("note", ""):
        note = " *No DOI; edition confirmed by the app author.*"
    return f"- {au} ({year}) {title}. {src}.{link}{note} `[{key}]`"


def cited_keys(text):
    return set(re.findall(r"@([A-Za-z0-9_:\-]+)", " ".join(re.findall(r"\[[^\]]*@[^\]]*\]", text))))


def render(only=None):
    entries = parse_bib(BIB.read_text(encoding="utf-8"))
    if only is not None:
        entries = [e for e in entries if e[1] in only]
    groups = {}
    for etype, key, f in entries:
        groups.setdefault(f.get("keywords", "Other"), []).append((etype, key, f))
    what = "cited" if only is not None else "verified"
    out = [f"*{len(entries)} {what} references (all verified), generated from `docs/REFERENCES.bib` by "
           f"`tools/render_reference_list.py`.*", ""]
    for g in GROUP_ORDER + sorted(set(groups) - set(GROUP_ORDER)):
        if g not in groups:
            continue
        out.append(f"**{g}**")
        out.append("")
        items = sorted(groups[g], key=lambda e: (strip_braces(e[2].get("author", "")).lower(),
                                                 e[2].get("year", "")))
        out += [fmt(*e) for e in items]
        out.append("")
    return "\n".join(out)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    md = Path(args[0]) if args else ROOT / "docs" / "DESIGN.md"
    text = md.read_text(encoding="utf-8")
    if START not in text or END not in text:
        sys.exit(f"markers not found in {md}")
    only = cited_keys(text.split(START)[0]) if "--cited-only" in sys.argv else None
    new = text.split(START)[0] + START + "\n" + render(only) + "\n" + END + text.split(END, 1)[1]
    md.write_text(new, encoding="utf-8")
    print("reference list written into", md)


if __name__ == "__main__":
    main()
