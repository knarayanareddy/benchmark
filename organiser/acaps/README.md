# Ground Truth: A Trusted Expert Loop for Humanitarian Risk Analysis

**Hackathon for Good #8** | 6-8 November 2026 | The Hague

**Challenge owners:** Lars Peters and Alexander Harper, [ACAPS](https://www.acaps.org/) — an independent humanitarian analysis organisation monitoring 100+ crises worldwide.

---

## The Challenge

ACAPS analysts build the [Risk List](https://www.acaps.org/en/thematics/all-topics/risk-list): an overview of risks that could trigger a new humanitarian crisis or sharply worsen an existing one. But today, the knowledge of the experts closest to these crises — the people who sense a shift before it shows up in a report — stays locked in informal conversations and disappears.

**Your challenge:** build a system that lets a trusted, moderated network of humanitarian experts challenge, enrich and forecast ACAPS risk analyses, while controlling their own anonymity and contributing in just a few minutes.

> *Example question the solution should handle:*
> *"What are the three biggest risks in Chad that might worsen humanitarian outcomes in the next six months?"*

### Two Directions

| Direction | What it means |
|-----------|---------------|
| **Ground Truthing** | Experts react to ACAPS risk analyses — do they agree? What is missing? Think Delphi-style: independent responses, anonymised group summary, iterative refinement. |
| **Forecasting** | Experts estimate how likely specific events are within six months. Track records emerge over time, surfacing "super estimators". |

Teams can work on one or both. The strongest solutions show how both feed back into ACAPS analysis.

Read the [full challenge brief](docs/challenge-brief.md) for complete details, personas, and criteria.

---

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/Hackathon-for-Good-The-Hague/HFG8-ACAPS-Ground-Truth.git
cd HFG8-ACAPS-Ground-Truth

# 2. Create a virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Explore the data
jupyter notebook notebooks/data-exploration.ipynb
```

Or load the data directly:

```python
import pandas as pd

df = pd.read_csv("data/risk-radar-export.csv")
print(f"{len(df)} risks across {df['Country'].nunique()} countries")
print(df["Risk Level"].value_counts())
```

---

## What's in the Data

The ACAPS Risk Radar export contains **139 humanitarian risks** across **57 countries**, with the full lifecycle of each risk:

| What | Fields |
|------|--------|
| **The risk** | Title, type, country, triggers |
| **ACAPS rating** | Probability (5-point), impact (1-5), risk level, rationale |
| **What happened** | Status (active / materialised / not materialised), materialisation description |

Among resolved risks, ~**84% of "High" risks materialised** — higher ratings predict materialisation significantly better. Run the [starter notebook](notebooks/data-exploration.ipynb) to see exact rates by level.

**Demo risk:** [R1043](docs/challenge-brief.md#data) — *"Escalating cross-border insecurity linked to the Sudan conflict increases protection risks and humanitarian needs in eastern Chad"* (active, high risk, >500K people exposed).

See the [data dictionary](docs/data-dictionary.md) for every field documented.

---

## Repository Structure

```
HFG8-ACAPS-Ground-Truth/
├── README.md                    ← You are here
├── .gitignore
├── LICENSE                      ← MIT
├── CODE_OF_CONDUCT.md
├── CLAUDE.md                    ← Context for AI coding assistants
├── requirements.txt             ← Python dependencies
│
├── docs/
│   ├── challenge-brief.md       ← Full challenge description
│   ├── risk-methodology.md      ← How ACAPS identifies and rates risks
│   ├── data-dictionary.md       ← Every column in the dataset explained
│   ├── evaluation-criteria.md   ← Judging criteria and deliverables
│   └── resources.md             ← Links, APIs, and inspiration
│
├── data/
│   ├── README.md                ← Data overview and quick start
│   ├── risk-radar-export.csv    ← Clean CSV (recommended)
│   └── risk-radar-export.xlsx   ← Original Excel export
│
├── references/
│   ├── acaps-risk-methodology.pdf
│   └── acaps-risk-methodology-infographic.png
│
└── notebooks/
    └── data-exploration.ipynb   ← Guided data walkthrough
```

---

## Key Constraints

- **Anonymity is non-negotiable.** Each expert controls their level: known to ACAPS, pseudonymous to peers, or fully anonymous. Contributions are always anonymous to the public.
- **Respect experts' time.** A contribution should take minutes, not hours.
- **Small trusted groups.** 5-10 experts per country/context, moderated by ACAPS.
- **No real personal data.** Use synthetic users during the hackathon.

---

## What You Deliver

1. A **working prototype or demo**
2. A **3-minute pitch** for the jury
3. A **repository link** with a description of what you built, how it works, and why

---

## Follow-Up

The **2-3 most promising solutions** will be piloted with real ACAPS experts starting December 2026. Solutions that make joining and staying involved easy have a clear head start.

---

## ACAPS Risk Methodology

<p align="center">
  <img src="references/acaps-risk-methodology-infographic.png" alt="ACAPS Risk Methodology" width="700">
</p>

Read the [full methodology explainer](docs/risk-methodology.md).

---

## Resources

- [Full challenge brief](docs/challenge-brief.md)
- [Data dictionary](docs/data-dictionary.md)
- [Evaluation criteria](docs/evaluation-criteria.md)
- [Resources and inspiration](docs/resources.md)
- [ACAPS Risk List](https://www.acaps.org/en/thematics/all-topics/risk-list) (live data)
- [ACAPS API](https://api.acaps.org) (free account, token auth)

**On site:** Alexander Harper (Alex) from ACAPS will be at the hackathon for questions and feedback.

**Hackathon questions:** [info@hackathonforgood.org](mailto:info@hackathonforgood.org)

---

## License

This project is licensed under the MIT License — see [LICENSE](LICENSE).

ACAPS data is used under [ACAPS' terms of use](https://www.acaps.org/en/about/terms-of-use).
