#!/usr/bin/env python3
"""
Ingest — normalise the ACAPS Risk Radar export to JSON, once.

We do NOT hand-roll a CSV parser. The export contains quoted fields with
embedded newlines, and a naive line-splitter silently misaligns columns
(it turned a 139-row file into 5,970 "rows" on the first attempt).
Python's csv module is correct, battle-tested, and free. Use it.

Output: data/risk-radar.json — the only form the JS scripts read.
"""
import csv, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
# Self-contained: the export lives in this repo, copied from the organisers'
# starter kit. No sibling checkout, no 00-shared.
CANDIDATES = [os.path.join(ROOT, "data", "risk-radar-export.csv")]

src = next((p for p in CANDIDATES if os.path.exists(p)), None)
if not src:
    sys.exit("no export found — put risk-radar-export.csv in data/")

with open(src, encoding="utf-8", errors="replace", newline="") as f:
    rows = list(csv.DictReader(f))

def outcome(status):
    s = (status or "").strip().lower()
    if s == "materialised":     return 1
    if s == "not materialised": return 0
    return None                              # Active / blank = unobservable, excluded

out = []
for r in rows:
    rid = (r.get("Risk ID") or "").strip()
    if not re.match(r"^R\d+$", rid, re.I):
        continue
    out.append({
        "id": rid,
        "title": (r.get("Risk Title") or "").strip(),
        "country": (r.get("Country") or "").strip(),
        "iso": (r.get("ISO") or "").strip(),
        "riskType": (r.get("Risk Type") or "").strip(),
        "riskLevel": (r.get("Risk Level") or "").strip(),
        "intensity": (r.get("Intensity of hazard") or "").strip(),
        "impact": (r.get("Impact") or "").strip(),
        "probability": (r.get("Probability") or "").strip(),
        "status": (r.get("Status") or "").strip(),
        "outcome": outcome(r.get("Status")),
        "triggers": (r.get("Triggers") or "").strip()[:600],
        "rationale": (r.get("Rationale") or "").strip(),
    })

os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
dst = os.path.join(ROOT, "data", "risk-radar.json")
with open(dst, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)

resolved = [x for x in out if x["outcome"] is not None]
print(f"source      : {os.path.relpath(src, ROOT)}")
print(f"blocks      : {len(out)}")
print(f"resolved    : {len(resolved)}  (materialised {sum(x['outcome'] for x in resolved)}, not {sum(1 for x in resolved if x['outcome']==0)})")
print(f"active      : {sum(1 for x in out if x['status'].lower()=='active')}")
print(f"written     : {os.path.relpath(dst, ROOT)}")
