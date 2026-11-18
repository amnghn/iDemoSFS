#!/usr/bin/env python3
"""Check the URLs of docs/related_tools.tsv (HTTP status after redirects; standard library only).

Writes docs/related_tools_check.tsv (name, url, status, final_url, checked). Only entries with
status 200 are listed in the app (app/src/ui/relatedTools.ts). Generic User-Agent, no personal data.
"""
import csv, sys, time, urllib.request, urllib.error
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IN, OUT = ROOT / "docs" / "related_tools.tsv", ROOT / "docs" / "related_tools_check.tsv"
UA = "Mozilla/5.0 (X11; Linux x86_64) link-check (teaching app reference check)"

def check(url):
    for method in ("HEAD", "GET"):
        try:
            req = urllib.request.Request(url, method=method, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=25) as r:
                return r.status, r.geturl()
        except urllib.error.HTTPError as e:
            if method == "HEAD" and e.code in (403, 405, 404, 400):
                continue
            return e.code, url
        except Exception as e:  # noqa: BLE001
            if method == "HEAD":
                continue
            return f"error: {type(e).__name__}", url
    return "error", url

rows = list(csv.DictReader(open(IN, encoding="utf-8"), delimiter="\t"))
with open(OUT, "w", encoding="utf-8", newline="") as fh:
    w = csv.writer(fh, delimiter="\t")
    w.writerow(["name", "url", "status", "final_url", "checked"])
    for r in rows:
        st, final = check(r["url"])
        w.writerow([r["name"], r["url"], st, final, date.today().isoformat()])
        print(f"{st}\t{r['name']}\t{final}")
        time.sleep(1)
