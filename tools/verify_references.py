#!/usr/bin/env python3
"""Verify the reference list and write docs/REFERENCES.bib.

Rules (prompt section 7.1 and decisions of 2026-11-18):
  * Articles with a DOI given: fetch Crossref metadata for that DOI, check that
    https://doi.org/<DOI> resolves (HTTP 30x), and compare title, first author,
    year and journal (plus volume and first page when available).
  * Articles without a DOI: search Crossref (query.bibliographic). A DOI is
    accepted only when title, first author, year and journal all match. A DOI is
    never guessed.
  * Books / chapters without a DOI: Crossref first (some books have DOIs); if
    none matches, look for an Open Library record (title, author, year,
    publisher) and keep the ISBN. Such entries are labelled "no DOI".
  * Web resources: the URL must answer with HTTP 200.
Only verified entries are written to the .bib file. Everything else is listed
as "Unverified - removed" in the report.

Standard library only (runs with the system python3 on the LiSC login node).
Network use is light: about one request per second, generic User-Agent, no
personal data in any request.

Usage:
  python3 tools/verify_references.py            # verify, write .bib + report
  python3 tools/verify_references.py --check-keys docs/DESIGN.md
"""

import argparse
import csv
import difflib
import html
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INPUT = ROOT / "docs" / "references_input.tsv"
BIB = ROOT / "docs" / "REFERENCES.bib"
REPORT = ROOT / "docs" / "reference_verification_report.tsv"
UA = "sfs-teaching-app-reference-check/0.1 (python-urllib; no contact)"
PAUSE = 1.0
TITLE_MIN = 0.90

JOURNAL_ALIASES = {
    "proceedings of the national academy of sciences": [
        "proceedings of the national academy of sciences",
        "proceedings of the national academy of sciences of the united states of america",
        "pnas"],
    "communications in statistics stochastic models": [
        "communications in statistics stochastic models", "stochastic models"],
    "genetical research": ["genetical research", "genetics research"],
    "american journal of human genetics": [
        "american journal of human genetics", "the american journal of human genetics"],
    "journal of the american statistical association": [
        "journal of the american statistical association"],
}


# ---------------------------------------------------------------- helpers

def norm(s):
    """Lower case, strip accents, tags and punctuation, collapse spaces."""
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace("ß", "ss").lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def title_sim(a, b):
    a, b = norm(a), norm(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    # allow a sub-title on one side only
    if a.startswith(b) or b.startswith(a):
        short, long_ = sorted([a, b], key=len)
        if len(short) >= 0.6 * len(long_):
            return 0.97
    return difflib.SequenceMatcher(None, a, b).ratio()


def first_surname(authors):
    first = authors.split(";")[0].strip()
    # "Fu Y-X" -> "Fu"; "Pääbo S" -> "Pääbo"; "Huerta-Sánchez E" stays
    return norm(first.rsplit(" ", 1)[0] if " " in first else first)


def journal_ok(expected, found_list):
    e = norm(expected)
    candidates = JOURNAL_ALIASES.get(e, [e])
    for f in found_list:
        fn = norm(f)
        for c in candidates:
            if fn == c or fn.startswith(c) or c.startswith(fn):
                return True
            if difflib.SequenceMatcher(None, fn, c).ratio() >= 0.9:
                return True
    return False


def http_get_json(url, tries=3):
    """GET JSON with up to `tries` attempts (back-off 5 s, 10 s) on network errors."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for k in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError) as e:
            if isinstance(e, urllib.error.HTTPError) and e.code == 404:
                raise
            if k == tries - 1:
                raise
            time.sleep(5 * (k + 1))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def doi_resolves(doi):
    """True if https://doi.org/<doi> answers with a redirect (30x)."""
    opener = urllib.request.build_opener(NoRedirect)
    req = urllib.request.Request("https://doi.org/" + urllib.parse.quote(doi, safe="/"),
                                 headers={"User-Agent": UA}, method="HEAD")
    try:
        r = opener.open(req, timeout=30)
        return 200 <= r.status < 400, str(r.status)
    except urllib.error.HTTPError as e:
        return 300 <= e.code < 400, str(e.code)
    except Exception as e:  # network error
        return False, type(e).__name__


def url_ok(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status == 200, str(r.status)
    except urllib.error.HTTPError as e:
        return False, str(e.code)
    except Exception as e:
        return False, type(e).__name__


def cr_year(msg):
    years = set()
    for k in ("published-print", "published-online", "issued", "published"):
        parts = msg.get(k, {}).get("date-parts", [[None]])
        if parts and parts[0] and parts[0][0]:
            years.add(int(parts[0][0]))
    return years


def cr_first_surname(msg):
    authors = msg.get("author", [])
    if not authors:
        return ""
    a = authors[0]
    return norm(a.get("family") or a.get("name") or "")


def compare(ref, msg):
    """Compare one input row with one Crossref record. Returns a dict of checks."""
    found_title = " ".join(msg.get("title", [""]))
    sub = " ".join(msg.get("subtitle", []) or [])
    t = max(title_sim(ref["title"], found_title),
            title_sim(ref["title"], (found_title + " " + sub).strip()))
    exp_sur = first_surname(ref["authors"])
    got_sur = cr_first_surname(msg)
    author = bool(exp_sur) and (exp_sur == got_sur or exp_sur in got_sur or got_sur in exp_sur)
    years = cr_year(msg)
    year = int(ref["year"]) in years if ref["year"] else False
    containers = (msg.get("container-title") or []) + (msg.get("short-container-title") or [])
    if ref["type"] == "article":
        journal = journal_ok(ref["container"], containers)
    else:  # book or chapter found in Crossref: the publisher must match instead
        pub = norm(msg.get("publisher", ""))
        want = norm(ref["container"])
        journal = bool(pub) and (want in pub or pub in want or
                                 difflib.SequenceMatcher(None, want, pub).ratio() >= 0.8)
    vol = (not ref["volume"]) or (str(msg.get("volume", "")).strip() == ref["volume"].strip())
    page_exp = ref["pages"].split("-")[0].strip() if ref["pages"] else ""
    page_got = str(msg.get("page", "") or msg.get("article-number", "")).split("-")[0].strip()
    page = (not page_exp) or page_exp.lower() == page_got.lower() or not page_got
    # Old articles: Crossref often lists only the date when the journal archive went
    # online (for example 2010 for a 1928 paper). Accept this case only when the
    # volume AND the first page given in the input both match the record.
    archive_date = (not year and ref["year"] and int(ref["year"]) < 1997 and years
                    and min(years) >= 1997 and ref["volume"] and page_exp
                    and str(msg.get("volume", "")).strip() == ref["volume"].strip()
                    and page_exp.lower() == page_got.lower())
    return dict(title_sim=round(t, 3), author_ok=author, year_ok=year, journal_ok=journal,
                volume_ok=vol, page_ok=page, cr_title=clean(found_title),
                cr_journal="; ".join(msg.get("container-title") or []),
                cr_year=",".join(str(y) for y in sorted(years)), cr_first_author=got_sur,
                archive_date=bool(archive_date))


def clean(s):
    """Remove markup and line breaks (keeps the TSV report valid)."""
    s = html.unescape(re.sub(r"<[^>]+>", "", s or ""))
    return re.sub(r"\s+", " ", s).strip()


def core_ok(c):
    year = c["year_ok"] or c.get("archive_date", False)
    return c["title_sim"] >= TITLE_MIN and c["author_ok"] and year and c["journal_ok"]


def status_ok(c):
    """'verified', or 'verified_note' when the year check used the archive-date rule."""
    if not c["year_ok"] and c.get("archive_date"):
        c["note"] = ("Crossref lists only the online-archive date (" + c["cr_year"] +
                     "); volume and first page match the print year.")
        return "verified_note"
    return "verified"


# ---------------------------------------------------------------- verifiers

def verify_with_doi(ref):
    doi = ref["doi_given"].strip()
    msg = http_get_json("https://api.crossref.org/works/" + urllib.parse.quote(doi, safe="/"))["message"]
    time.sleep(PAUSE)
    c = compare(ref, msg)
    res_ok, code = doi_resolves(doi)
    time.sleep(PAUSE)
    c.update(doi=doi, doi_resolves=f"{res_ok}({code})", method="crossref-doi")
    c["status"] = status_ok(c) if (core_ok(c) and res_ok) else "mismatch"
    return c, msg


def verify_by_search(ref):
    q = f'{ref["title"]} {ref["authors"].split(";")[0]} {ref["year"]}'
    url = ("https://api.crossref.org/works?rows=8&query.bibliographic="
           + urllib.parse.quote(q))
    items = http_get_json(url)["message"]["items"]
    time.sleep(PAUSE)
    best, best_c = None, None
    for it in items:
        c = compare(ref, it)
        if best_c is None or (core_ok(c), c["title_sim"]) > (core_ok(best_c), best_c["title_sim"]):
            best, best_c = it, c
    if best is None:
        return dict(status="not_found", method="crossref-search", doi="", doi_resolves=""), None
    doi = best.get("DOI", "")
    if core_ok(best_c) and doi:
        res_ok, code = doi_resolves(doi)
        time.sleep(PAUSE)
        best_c.update(doi=doi, doi_resolves=f"{res_ok}({code})", method="crossref-search")
        best_c["status"] = status_ok(best_c) if res_ok else "mismatch"
    else:
        best_c.update(doi="", doi_resolves="", method="crossref-search",
                      status="mismatch" if best_c["title_sim"] >= 0.75 else "not_found",
                      note_candidate_doi=doi)
    return best_c, best


def ol_edition(isbn):
    """Open Library edition record for one ISBN (follows the redirect), or {}."""
    try:
        d = http_get_json(f"https://openlibrary.org/isbn/{isbn}.json")
    except Exception:
        d = {}
    time.sleep(PAUSE)
    return d


def isbn_valid(i):
    """True for a valid ISBN-13 (978/979 prefix, checksum) or ISBN-10 (checksum)."""
    i = i.replace("-", "").upper()
    if len(i) == 13 and i.isdigit() and i[:3] in ("978", "979"):
        return sum(int(c) * (1 if k % 2 == 0 else 3) for k, c in enumerate(i)) % 10 == 0
    if len(i) == 10 and i[:9].isdigit() and (i[9].isdigit() or i[9] == "X"):
        return sum((10 - k) * (10 if c == "X" else int(c)) for k, c in enumerate(i)) % 11 == 0
    return False


def years_in(text):
    return {int(y) for y in re.findall(r"\b(1[89]\d\d|20\d\d)\b", text or "")}


def verify_book(ref):
    """Crossref first (some books have DOIs), then Open Library (work + ISBN edition).

    Book: main title (before any colon), first author, publisher and year must
    match. The year may come from the work's list of publication years or from
    the edition record. Chapter: the volume record (container + volume number)
    must exist and show the year; the chapter itself is checked through the
    url_given (an author-hosted copy that must answer HTTP 200).
    """
    c, msg = verify_by_search(ref)
    if c.get("status") == "verified":
        c["method"] = "crossref-search(book)"
        return c, msg, None
    chapter = ref["type"] == "chapter"
    main_title = ref["title"].split(":")[0].strip()
    surname = ref["authors"].split(";")[0].strip().split(" ")[0]
    if chapter:
        params = {"q": f'{ref["container"]} volume {ref["volume"]}', "limit": "20"}
        want = f'{ref["container"]} Volume {ref["volume"]}'
    else:
        params = {"title": main_title, "author": surname, "limit": "10"}
        want = main_title
    params["fields"] = "key,title,subtitle,author_name,first_publish_year,publish_year,publisher,isbn"
    ol = http_get_json("https://openlibrary.org/search.json?" + urllib.parse.urlencode(params))
    time.sleep(PAUSE)
    exp_sur = first_surname(ref["authors"])
    best = None
    for d in ol.get("docs", []):
        t = title_sim(want, d.get("title", ""))
        if t < 0.8:
            continue
        isbns = [i for i in (d.get("isbn", []) or []) if isbn_valid(i)]
        isbn = (sorted(i for i in isbns if len(i) == 13) or sorted(isbns) or [""])[0]
        ed = ol_edition(isbn) if isbn else {}
        years = set(d.get("publish_year", []) or [])
        if d.get("first_publish_year"):
            years.add(d["first_publish_year"])
        years |= years_in(ed.get("publish_date", "")) | years_in(ed.get("subtitle", "")) | years_in(ed.get("title", ""))
        authors = [norm(a) for a in d.get("author_name", []) or []]
        a_ok = chapter or any(exp_sur in a for a in authors)
        y_ok = int(ref["year"]) in years
        pubs = [norm(x) for x in (d.get("publisher") or []) + (ed.get("publishers") or [])]
        p_ok = chapter or any(norm(ref["container"]).split(" ")[0] in x for x in pubs)
        vol_ok = (not chapter) or bool(re.search(r"\b" + re.escape(ref["volume"]) + r"\b",
                                                 d.get("title", "") + " " + (ed.get("title") or "")))
        ok = t >= TITLE_MIN and a_ok and y_ok and p_ok and vol_ok
        info = dict(title_sim=round(t, 3), author_ok=a_ok, year_ok=y_ok, journal_ok=p_ok,
                    volume_ok=vol_ok, page_ok=True, isbn=isbn,
                    openlibrary_key=ed.get("key") or d.get("key", ""),
                    cr_title=clean(" ".join(x for x in [ed.get("title") or d.get("title", ""), ed.get("subtitle") or ""] if x)),
                    cr_journal="; ".join(sorted(set((d.get("publisher") or []) + (ed.get("publishers") or [])))[:4]),
                    cr_year=",".join(str(y) for y in sorted(years)),
                    cr_first_author="; ".join((d.get("author_name") or [])[:3]),
                    publisher_record=(ed.get("publishers") or d.get("publisher") or [""])[0])
        if best is None or (ok, t) > best[0]:
            best = ((ok, t), d, info)
    if best is None:
        return dict(status="not_found", method="openlibrary", doi="", doi_resolves=""), None, None
    (ok, _), d, cc = best
    if ok and chapter:
        if ref.get("url_given"):
            u_ok, code = url_ok(ref["url_given"])
            time.sleep(PAUSE)
            cc["http"] = code
            ok = u_ok
        else:
            ok = False
    cc.update(status="verified_no_doi" if ok else "mismatch", method="openlibrary",
              doi="", doi_resolves="")
    return cc, None, d


def verify_web(ref):
    ok, code = url_ok(ref["container"])
    time.sleep(PAUSE)
    return dict(status="verified_web" if ok else "not_found", method="http-get",
                doi="", doi_resolves="", http=code)


# ---------------------------------------------------------------- BibTeX

def bib_escape(s):
    return (s or "").replace("&", r"\&").replace("%", r"\%").replace("#", r"\#")


def authors_from_crossref(msg):
    out = []
    for a in msg.get("author", []):
        if a.get("family"):
            fam, giv = a["family"], a.get("given", "")
            if fam.isupper() and len(fam) > 2:  # archive records in capitals
                fam, giv = fam.title(), giv.title()
            out.append(f"{fam}, {giv}".strip().rstrip(","))
        elif a.get("name"):
            out.append("{" + a["name"] + "}")
    return " and ".join(out)


def bib_article(key, msg, ref):
    raw = " ".join(msg.get("title", [""]))
    raw = re.sub(r"\s*<sub>\s*(.*?)\s*</sub>", r"\1", raw)   # F<sub>ST</sub> -> FST
    title = clean(raw).replace(" :", ":")
    if title.isupper():                     # some archive records are in capitals
        title = ref["title"]
    sub = " ".join(msg.get("subtitle", []) or [])
    if sub and norm(sub) not in norm(title):
        title = f"{title}: {sub}"
    journal = html.unescape((msg.get("container-title") or [ref["container"]])[0])
    years = sorted(cr_year(msg))
    # The input year was checked against Crossref (or, for old papers, against the
    # volume and first page when Crossref only has the online-archive date).
    year = ref["year"] or (years[0] if years else "")
    fields = {
        "author": authors_from_crossref(msg),
        "title": "{" + bib_escape(title) + "}",
        "journal": bib_escape(journal),
        "year": str(year),
        "volume": str(msg.get("volume", "") or ""),
        "number": str(msg.get("issue", "") or ""),
        "pages": str(msg.get("page", "") or msg.get("article-number", "") or "").replace("-", "--"),
        "doi": msg.get("DOI", ""),
        "url": "https://doi.org/" + msg.get("DOI", ""),
        "keywords": ref["group"],
    }
    BOOK_TYPES = ("book", "monograph", "edited-book", "reference-book")
    entry = "book" if msg.get("type", "") in BOOK_TYPES or ref["type"] == "book" else "article"
    if entry == "book":
        fields["publisher"] = bib_escape(msg.get("publisher", ""))
        fields.pop("journal")
    lines = [f"@{entry}{{{key},"]
    for k, v in fields.items():
        if v:
            lines.append(f"  {k} = {{{v}}},")
    lines.append("}")
    return "\n".join(lines)


def bib_book(key, ref, c, d):
    isbn = c.get("isbn", "")
    url = f"https://openlibrary.org/isbn/{isbn}" if isbn else "https://openlibrary.org" + c.get("openlibrary_key", "")
    if ref["type"] == "chapter" and ref.get("url_given"):
        url = ref["url_given"]          # author-hosted copy of the chapter (checked: HTTP 200)
    def initials(given):  # "RR" -> "R. R.", "Y-X" -> "Y.-X."
        if given.replace("-", "").isalpha() and given.replace("-", "").isupper():
            return "-".join(" ".join(ch + "." for ch in part) for part in given.split("-"))
        return given
    authors = " and ".join(
        f'{a.split(" ")[0]}, {initials(" ".join(a.split(" ")[1:]))}' for a in ref["authors"].split("; "))
    if ref["type"] == "chapter":
        lines = [f"@incollection{{{key},", f"  author = {{{authors}}},",
                 f"  title = {{{{{bib_escape(ref['title'])}}}}},",
                 f"  booktitle = {{{bib_escape(ref['container'])}}},",
                 f"  volume = {{{ref['volume']}}},", f"  pages = {{{ref['pages'].replace('-', '--')}}},",
                 f"  year = {{{ref['year']}}},"]
        lines.append(f"  publisher = {{{bib_escape(c.get('publisher_record', ''))}}},")
    else:
        lines = [f"@book{{{key},", f"  author = {{{authors}}},",
                 f"  title = {{{{{bib_escape(ref['title'])}}}}},",
                 f"  publisher = {{{bib_escape(ref['container'])}}},",
                 f"  year = {{{ref['year']}}},"]
    if isbn:
        lines.append(f"  isbn = {{{isbn}}},")
    note = "No DOI; verified through an Open Library ISBN record"
    if ref["type"] == "chapter":
        note += " of the volume and an author-hosted copy of the chapter"
    if c.get("status") == "verified_by_author":
        note = ("No DOI; no open record shows this edition; confirmed by the app author "
                "(" + ref["source"].replace("author_confirmed_", "") + ")")
        url = ""
    if url:
        lines.append(f"  url = {{{url}}},")
    lines += [f"  note = {{{note}}},",
              f"  keywords = {{{ref['group']}}},", "}"]
    return "\n".join(lines)


def bib_web(key, ref):
    return "\n".join([f"@misc{{{key},", f"  author = {{{{{ref['authors']}}}}},",
                      f"  title = {{{{{ref['title']}}}}},",
                      f"  howpublished = {{\\url{{{ref['container']}}}}},",
                      f"  url = {{{ref['container']}}},",
                      f"  urldate = {{{date.today().isoformat()}}},",
                      f"  keywords = {{{ref['group']}}},", "}"])


# ---------------------------------------------------------------- main

COLS = ["key", "type", "source", "status", "method", "doi", "doi_resolves", "title_sim",
        "author_ok", "year_ok", "journal_ok", "volume_ok", "page_ok", "cr_title",
        "cr_journal", "cr_year", "cr_first_author", "isbn", "http", "note_candidate_doi", "note", "error"]


def run():
    refs = list(csv.DictReader(open(INPUT, encoding="utf-8"), delimiter="\t"))
    rows, bib = [], []
    for ref in refs:
        key = ref["key"]
        try:
            if ref["type"] == "web":
                c = verify_web(ref)
                if c["status"] == "verified_web":
                    bib.append(bib_web(key, ref))
            elif ref["type"] in ("book", "chapter"):
                c, msg, d = verify_book(ref)
                if c["status"] in ("verified", "verified_note"):
                    bib.append(bib_article(key, msg, ref))
                elif c["status"] == "verified_no_doi":
                    bib.append(bib_book(key, ref, c, d))
                elif ref["source"].startswith("author_confirmed"):
                    # No open record confirms this edition, but the app author has
                    # confirmed it from the book itself (follow-up instruction,
                    # docs/PROMPT.md). Kept, and labelled as such in the .bib.
                    c.update(status="verified_by_author",
                             note="confirmed by the app author: " + ref["source"])
                    bib.append(bib_book(key, ref, c, d))
            elif ref["doi_given"].strip():
                c, msg = verify_with_doi(ref)
                if c["status"] in ("verified", "verified_note"):
                    bib.append(bib_article(key, msg, ref))
            else:
                c, msg = verify_by_search(ref)
                if c["status"] in ("verified", "verified_note"):
                    bib.append(bib_article(key, msg, ref))
        except Exception as e:
            c = dict(status="error", error=f"{type(e).__name__}: {e}")
        c.update(key=key, type=ref["type"], source=ref["source"])
        rows.append(c)
        print(f'{c.get("status", ""):16s} {key:30s} {c.get("doi", "")} {c.get("title_sim", "")}',
              flush=True)

    with open(REPORT, "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLS, delimiter="\t", extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in COLS})

    header = [
        "% REFERENCES.bib - generated by tools/verify_references.py on " + date.today().isoformat(),
        "% Only verified entries are included. Metadata of DOI entries is taken from Crossref.",
        "% Do not edit by hand: edit docs/references_input.tsv and re-run the script.", ""]
    BIB.write_text("\n".join(header) + "\n\n".join(bib) + "\n", encoding="utf-8")

    n_ok = sum(r["status"].startswith("verified") for r in rows)
    print(f"\n{n_ok}/{len(rows)} verified; report: {REPORT}; bib: {BIB}")
    bad = [r for r in rows if not r["status"].startswith("verified")]
    if bad:
        print("NOT verified:", ", ".join(f'{r["key"]}({r["status"]})' for r in bad))


def check_keys(md_path):
    """Every [@key] in a Markdown file must exist in REFERENCES.bib."""
    text = Path(md_path).read_text(encoding="utf-8")
    used = set(re.findall(r"@([A-Za-z0-9_:\-]+)", " ".join(re.findall(r"\[[^\]]*@[^\]]*\]", text))))
    have = set(re.findall(r"^@\w+\{([^,]+),", BIB.read_text(encoding="utf-8"), flags=re.M))
    missing = sorted(used - have)
    print(f"{len(used)} keys cited in {md_path}; {len(missing)} missing from REFERENCES.bib")
    for k in missing:
        print("  MISSING", k)
    return 1 if missing else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check-keys", metavar="MARKDOWN")
    args = ap.parse_args()
    if args.check_keys:
        sys.exit(check_keys(args.check_keys))
    run()
