#!/usr/bin/env python3
"""
Ingest — normalise the ACAPS Risk Radar export to JSON, once.

We do NOT hand-roll a CSV parser. The export contains quoted fields with
embedded newlines, and a naive line-splitter silently misaligns columns
(it turned a 139-row file into 5,970 "rows" on the first attempt).
Python's csv module is correct, battle-tested, and free. Use it.

Output: data/risk-radar.json — the only form the JS scripts read.
"""
import csv, datetime, json, os, re, sys

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

TRIGGER_SPLIT = re.compile(r"(?=Trigger ID:)", re.M)
HEADER_RE = re.compile(
    r"^(Trigger ID|Title|Description|Sources|Completion rate|Completion rate history|Quantitative objective to meet 100%|Trend|Trend history|Date entered|Last update):[ \t]*(.*)",
    re.M,
)

def iso_from_dmy(d, m, y):
    """dd/mm/yyyy or dd-mm-yyyy (day first) to ISO yyyy-mm-dd; None when not a real date."""
    try:
        return datetime.date(int(y), int(m), int(d)).isoformat()
    except ValueError:
        return None

def iso_of_dmy_text(s):
    m = re.fullmatch(r"(\d{2})-(\d{2})-(\d{4})", s or "")
    return iso_from_dmy(*m.groups()) if m else None

HISTORY_LINE = re.compile(r"^[ \t]*(\d{2})-(\d{2})-(\d{4}):[ \t]*(.*?)[ \t]*$", re.M)
PERCENT = re.compile(r"^(\d{1,3})%$")

def parse_history(raw, percent):
    """'dd-mm-yyyy: value' lines in file order. A line with no value is dropped (nothing to plot)."""
    out = []
    for m in HISTORY_LINE.finditer(raw or ""):
        value = m.group(4)
        date = iso_from_dmy(m.group(1), m.group(2), m.group(3))
        if not value or date is None:
            continue
        if percent:
            pm = PERCENT.match(value)
            if not pm:
                continue
            value = int(pm.group(1))
        out.append({"date": date, "value": value})
    return out

UPDATE_HEADER = re.compile(r"^UPDATE (\d{2})/(\d{2})/(\d{4})[ \t]*$", re.M | re.I)

def parse_rationale_updates(raw):
    """Entries headed 'UPDATE dd/mm/yyyy' (day first). Text before the first header is kept with date None."""
    text = (raw or "").strip()
    if not text:
        return []
    headers = list(UPDATE_HEADER.finditer(text))
    if not headers:
        return [{"date": None, "text": text}]
    out = []
    head = text[:headers[0].start()].strip()
    if head:
        out.append({"date": None, "text": head})
    for idx, m in enumerate(headers):
        end = headers[idx + 1].start() if idx + 1 < len(headers) else len(text)
        out.append({"date": iso_from_dmy(*m.groups()), "text": text[m.end():end].strip()})
    return out

def parse_triggers(raw):
    if not raw:
        return []
    parsed = []
    for block in TRIGGER_SPLIT.split(raw):
        block = block.strip()
        if not block.startswith("Trigger ID:"):
            continue
        matches = list(HEADER_RE.finditer(block))
        fields = {}
        for idx, m in enumerate(matches):
            key = m.group(1).strip().lower().replace(" ", "_")
            start = m.end()
            end = matches[idx + 1].start() if idx + 1 < len(matches) else len(block)
            fields[key] = (m.group(2) + block[start:end]).strip()
        tid = fields.get("trigger_id", "")
        parsed.append({
            "triggerId": tid.split("-")[-1].strip() if tid else "",
            "fullId": tid,
            "title": fields.get("title", ""),
            "description": fields.get("description", ""),
            "completionRate": fields.get("completion_rate", ""),
            "objective": fields.get("quantitative_objective_to_meet_100%", ""),
            "trend": fields.get("trend", ""),
            "dateEntered": fields.get("date_entered", ""),
            "lastUpdate": fields.get("last_update", ""),
            "dateEnteredISO": iso_of_dmy_text(fields.get("date_entered", "")),
            "lastUpdateISO": iso_of_dmy_text(fields.get("last_update", "")),
            "completionHistory": parse_history(fields.get("completion_rate_history", ""), percent=True),
            "trendHistory": parse_history(fields.get("trend_history", ""), percent=False),
        })
    return parsed

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
    trig_list = parse_triggers(r.get("Triggers"))
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
        "triggerList": trig_list,
        "triggerCount": len(trig_list),
        "rationale": (r.get("Rationale") or "").strip(),
        "riskTrend": (r.get("Risk trend") or "").strip() or None,
        "rationaleUpdates": parse_rationale_updates(r.get("Rationale update")),
    })

os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
dst = os.path.join(ROOT, "data", "risk-radar.json")
with open(dst, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)

resolved = [x for x in out if x["outcome"] is not None]
total_triggers = sum(x["triggerCount"] for x in out)
print(f"source      : {os.path.relpath(src, ROOT)}")
print(f"blocks      : {len(out)}")
print(f"triggers    : {total_triggers}")
print(f"resolved    : {len(resolved)}  (materialised {sum(x['outcome'] for x in resolved)}, not {sum(1 for x in resolved if x['outcome']==0)})")
print(f"active      : {sum(1 for x in out if x['status'].lower()=='active')}")
print(f"written     : {os.path.relpath(dst, ROOT)}")
