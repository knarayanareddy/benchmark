# Data

This folder contains the ACAPS Risk Radar export provided for Hackathon for Good #8.

## Files

| File | Format | Description |
|------|--------|-------------|
| `risk-radar-export.csv` | CSV (UTF-8) | Clean export — recommended for most use cases |
| `risk-radar-export.xlsx` | Excel | Original export from ACAPS Risk Radar |

The CSV is a cleaned version of the Excel file with `_x000D_` line break artifacts removed. Both files contain the same 139 risk records across 25 fields.

> **Note:** If you use the XLSX directly, the first row is blank — use `pd.read_excel("data/risk-radar-export.xlsx", header=1)` to load it correctly. The CSV does not have this issue.

## Quick Start

```python
import pandas as pd

df = pd.read_csv("data/risk-radar-export.csv")
print(f"Risks: {len(df)}, Countries: {df['Country'].nunique()}")
print(df["Risk Level"].value_counts())
```

## What's in the Data

Each row is a **humanitarian risk** tracked by ACAPS. The data captures the full lifecycle:

1. **What the risk is** — title, type, country, triggers
2. **How ACAPS rated it** — probability, impact, risk level, rationale
3. **What actually happened** — status (active / materialised / not materialised), materialisation description

For a complete description of every field, see the [data dictionary](../docs/data-dictionary.md).

## Data Quality Notes

This is a working export, not a polished dataset. Be aware of:

- **Line breaks in text fields** — the CSV has cleaned `_x000D_` artifacts, but some fields still contain multi-line text
- **Intensity of hazard** — some values in the Excel have trailing whitespace; the CSV is cleaned
- **Multi-country risks** — some risks span multiple countries (comma-separated in ISO and Country fields)
- **Incomplete older records** — earlier risks may have fewer fields populated
- **Mixed date formats** — in the Rationale update field

## Key Statistics

| Metric | Value |
|--------|-------|
| Total risks | 139 |
| Unique countries | 57 |
| Active risks | 28 |
| Materialised risks | 61 |
| Not materialised | 43 |
| Status not recorded | 7 |
| High risk level | 55 |
| Medium risk level | 70 |
| Low risk level | 3 |
| Risk level not recorded | 11 |

## Demo Risk

The challenge brief suggests building your demo around **R1043**:

> *"Escalating cross-border insecurity linked to the Sudan conflict increases protection risks and humanitarian needs in eastern Chad"*

- **Status:** Active
- **Risk Level:** High
- **Country:** Chad
- **Expected exposure:** >500,000
