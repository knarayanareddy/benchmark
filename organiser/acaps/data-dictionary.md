# Data Dictionary — ACAPS Risk Radar Export

This document describes every field in the Risk Radar export (`data/risk-radar-export.xlsx` / `.csv`).

The dataset contains **139 risk records** across **57 countries**, with data on how each risk was identified, rated, monitored, and what ultimately happened.

---

## Dataset Overview

| Metric | Value |
|--------|-------|
| Total risks | 139 |
| Countries covered | 57 |
| Risk levels | High (55), Medium (70), Low (3), Unknown (11) |
| Statuses | Active (28), Materialised (61), Not materialised (43), Unknown (7) |
| Risk types | 3 (see below) |

---

## Field Reference

### Identification Fields

| # | Field | Description | Type | Example | Coverage |
|---|-------|-------------|------|---------|----------|
| 1 | **Risk ID** | Unique identifier for each risk | String | `R1043` | 100% |
| 2 | **Risk Title** | Short description of the risk | String | *"Escalating cross-border insecurity linked to the Sudan conflict increases protection risks..."* | 100% |
| 3 | **Risk Type** | Category of risk | Enum | See table below | 96% |
| 4 | **ISO** | ISO 3166-1 alpha-3 country code(s) | String | `TCD` or `TCD, NER, CMR, NGA` | 100% |
| 5 | **Country** | Full country name(s) | String | `Chad` or `Chad, Niger, Cameroon, Nigeria` | 100% |

#### Risk Type Values

| Value | Meaning |
|-------|---------|
| `New emerging risk` | A new hazard that could trigger a humanitarian crisis |
| `Marked deterioration in an existing crisis` | A development that could significantly worsen an ongoing situation |
| `Future impact of a hazard which has already taken place` | Delayed or cascading consequences of a past event |

---

### Rating Fields

| # | Field | Description | Type | Values | Coverage |
|---|-------|-------------|------|--------|----------|
| 6 | **Rationale** | Detailed explanation of why this risk was identified and how it was assessed | Free text | Up to ~8,000 chars | 99% |
| 7 | **Source** | URLs and references supporting the rationale | URLs (multi-line) | — | 91% |
| 8 | **Intensity of hazard** | How severe the hazard itself is | Integer 1-5 | `1` to `5` | 88% |
| 9 | **Impact** | Expected humanitarian impact if materialised | Integer 1-5 | `1` (lowest) to `5` (highest) | 93% |
| 10 | **Probability** | Likelihood of the hazard materialising | Enum | `Very Low`, `Low`, `Medium`, `High`, `Very High` | 92% |
| 11 | **Risk Level** | Overall risk level (derived from Probability x Impact) | Enum | `Low`, `Medium`, `High` | 92% |
| 12 | **Risk trend** | Whether the risk is getting better or worse | Enum | `Improved`, `Stable`, `Deteriorated` | 55% |

---

### Outcome Fields

| # | Field | Description | Type | Values | Coverage |
|---|-------|-------------|------|--------|----------|
| 13 | **Status** | Current status of the risk | Enum | `Active`, `Materialised`, `Not materialised` | 95% |
| 14 | **What materialised?** | What aspect of the risk actually occurred | Enum | `Hazard`, `Impact`, `Hazard and impact` | 40% |
| 15 | **Hazard materialisation** | Description of how the hazard materialised | Free text | — | 38% |
| 16 | **Materialisation sources** | URLs and references for materialisation evidence | URLs (multi-line) | — | 48% |

---

### Context Fields

| # | Field | Description | Type | Coverage |
|---|-------|-------------|------|----------|
| 17 | **Triggers** | Specific events or conditions that could trigger the risk | Structured text | 78% |
| 18 | **Current vulnerability / Coping capacities** | Pre-existing vulnerabilities and community resilience factors | Free text | 86% |
| 19 | **Current vulnerability / Coping capacities sources** | References for vulnerability assessment | URLs (multi-line) | 63% |

---

### Impact Assessment Fields

| # | Field | Description | Type | Values | Coverage |
|---|-------|-------------|------|--------|----------|
| 20 | **Expected exposure** | Estimated number of people who may be affected | Enum | `<20,000`, `20,000-100,000`, `100,000-250,000`, `250,000-500,000`, `>500,000` | 97% |
| 21 | **Expected impact** | Detailed description of anticipated humanitarian consequences | Free text | — | 67% |
| 22 | **Expected impact sources** | References for expected impact assessment | URLs (multi-line) | 64% |
| 23 | **Expected priority needs** | Humanitarian sectors most likely affected | Comma-separated list | Food security, Protection, Health, Livelihoods, WASH, Shelter, Displacement, Nutrition, Humanitarian access | 75% |

---

### History Fields

| # | Field | Description | Type | Coverage |
|---|-------|-------------|------|----------|
| 24 | **Impact materialisation description** | What actually happened to affected populations | Free text | 35% |
| 25 | **Rationale update** | Chronological updates to the original rationale | Multi-line text with dates | 45% |

---

## Data Quality Notes

### Known Issues

- **Line breaks (XLSX only):** The Excel file contains `_x000D_\n` sequences instead of standard line breaks. These are Windows carriage returns. The CSV provided in this repo has already been cleaned — if you use the CSV, you will not encounter this issue.
- **Intensity of hazard (XLSX only):** Some values in the Excel have trailing whitespace or line break characters (e.g., `3_x000D_\n`). The CSV has been cleaned to plain values.
- **XLSX blank first row:** The Excel file has a blank row before the headers. Use `pd.read_excel("data/risk-radar-export.xlsx", header=1)` to load it correctly.
- **Multi-value fields:** ISO codes, countries, and priority needs can contain comma-separated lists for risks spanning multiple countries.
- **Incomplete older records:** Risks imported from the earlier risk list may have fewer fields populated. Recent risks are more complete.
- **Mixed date formats:** Rationale update entries use various date formats. Parse carefully.
- **Long text fields:** Rationale, triggers, and update history can be very long (up to ~13,500 characters). Plan for this in your UI.

### Working with the Triggers Field

The triggers field uses a structured format:

```
Trigger ID: R1043 - T0618
Title: Expansion of cross-border attacks and insecurity
Description: Additional drone strikes, shelling, or armed incursions near the Chad-Sudan border
```

Multiple triggers are separated by line breaks. You may want to parse these into structured objects.

### Scoring and Validation

Among resolved risks (status = Materialised or Not materialised):

- ~**84%** of "High" rated risks materialised (32/38)
- ~**47%** of "Medium" rated risks materialised (27/58)
- "Low" rated risks have only 3 resolved records — too few for reliable rates

You can validate and explore this using the `Risk Level` and `Status` fields. The [starter notebook](../notebooks/data-exploration.ipynb) includes code to compute these rates. Use them to test scoring methods for a "super estimator" scoreboard.
