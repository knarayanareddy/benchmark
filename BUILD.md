# BUILD.md — start here

**Scaffolded and verified, not finished.** The scoring, aggregation, gate and dispatch logic is written and tested against the real export; the interface is not written.

```
$ npm run verify
✓ 91 unit tests pass
✓ gate audits raw export without fake windows: 0/139 pass raw (no CSV deadline); 47/139 pass text checks
✓ five-state dissent loop, cap-bypass dispatch and anonymous opt-out verified
```

---

## What works right now

| Module | File | State | Proof |
|---|---|---|---|
| **Shared spine** | `packages/shared/` | **Complete** | 18 tests — card, validation, loop, a11y |
| Scoring | `packages/core/src/scoring.js` | **Complete** | Brier + bootstrap + paired comparison, 9 tests |
| Aggregation | `packages/core/src/aggregate.js` | **Complete** | Pooling + intervals, ≥10-seed Brier skill gate, small-panel suppression, ACAPS 5×5 bridge, 25 tests |
| The Gate | `packages/core/src/gate.js` | **Complete** | 5 deterministic checks, 10 tests, **run honestly on the raw export** |
| Dispatch | `packages/core/src/dispatch.js` | **Complete** | Per-expert weekly cap, string/numeric dissent priority, health, 6 tests |
| Anonymity | `packages/core/src/anonymity.js` | **Complete** | 3 levels, strict allowlist attribution, 9,000-slot / collision-free aliases, 20 tests |
| Dissent loop | `packages/benchmark/src/dissent.js` | **Complete** | 5-state lifecycle + anonymous opt-out, 3 tests + journey script |
| Ingest | `scripts/ingest.py` | **Complete** | 139 blocks / 266 triggers → 104 resolved, matches the benchmark |
| Interface | — | **Not written** | React + Vite PWA, per `design/BENCHMARK-blueprint.html` §11 |

---

## The two findings already in the repo

Both came from running the code, not from reading.

**1. Raw Risk Radar headlines are not forecast-ready cards until gated.** `risk-radar-export.csv` carries no resolution deadline column on risk rows (`139/139` fail `window` when audited without synthetic inputs), and **91 of 139** headlines describe directional trends (*"increased violence"*, *"escalating insecurity"*) without a measurable threshold or discrete event (`47/139` pass the four text checks once given a date window). That confirms why the gate and the analyst-written resolution `objective` exist.

**2. The harness reproduces the benchmark independently.** On the 104 resolved blocks, a constant base-rate predictor scores **0.2425** — exactly the naive floor from the earlier calibration work. That is an independent confirmation that the ingest, the outcome mapping and the Brier implementation are all correct.

---

## Commands

```bash
python3 scripts/ingest.py       # CSV → data/risk-radar.json (uses Python's csv module)
node --test packages/benchmark/test/*.test.js
node scripts/gate-export.mjs    # acceptance test #9
node scripts/journey.mjs        # acceptance test #7
node scripts/backtest.mjs       # the scoring harness
```

**Do not hand-roll a CSV parser.** The export has quoted fields with embedded newlines; a naive line-splitter turned 139 rows into 5,970 and silently misaligned every column. Python's `csv` module is correct and free — use it.

---

## The one thing that is still missing, and it is not code

**The panel has never been run — and the baseline it must beat is ACAPS' own 0.2168, not the regression's 0.2177.** The regression loses to the analysts; that is now measured, in this repo, by `scripts/fit-baseline.mjs`.

`scripts/backtest.mjs` runs synthetic predictors on the 104 resolved blocks to prove the scoring plumbing, and `packages/core/src/aggregate.js` turns panel estimates into an interval-bearing probability. Two methodological constraints govern how the real panel test must run:

1. **Prospective, not retrospective (hindsight contamination).** An earlier draft proposed asking human country specialists to score the 104 already-resolved historical risks retrospectively. That is invalid as an accuracy test: specialists in late 2026 already know whether 2021–2025 crises (Taliban provincial-capital offensives, Sudan, Gaza) materialised. The 104 resolved rows establish the incumbent baselines (`0.2425` / `0.2168` / `0.2177`); the human panel must be evaluated **prospectively** on unresolved statements (**28 Active risks** and **266 dated triggers** as rolling windows close).
2. **Statistical power requires trigger-level volume.** On the 104 resolved risks, the paired Brier difference SD is **0.1505** (`scripts/measure-baseline.mjs`), giving an 80%-power two-sided minimum detectable effect of **0.0413** Brier at `n = 104` and requiring **n ≈ 445** resolved statements to detect a **0.02** Brier gain. Top-level country risks (`139` total) are too scarce; dated trigger statements (`266` per export cycle) are where prospective statistical power lives.

---

## Hard rules

- **No leaderboard.** Panel scores public, individual scores private.
- **Two-tier small-cell suppression.** Country panels of 5–10 experts publish internally to analysts and Round-2 panellists at `MIN_PANEL_SIZE = 3` (`aggregate.js`); public outputs enforce `PUBLIC.minCount = 10` (`anonymity.js`), meaning public views show cross-country regional/thematic rollups rather than single-country cells.
- **Every score renders with its interval.** There is no code path that returns a naked point estimate.
- **Unobservable ≠ miss.** `scoring.js` excludes `null` outcomes; it never counts them as failures.
- **The Declaration decides who is told, never how much weight they carry.** Weighting is by seed-variable performance, and only where a domain has ≥10 seed items.
- **90 seconds is the per-card target budget, not a measured user study.** Onboarding (`E2`) runs once, post-submission context (`E4`) and Round 2 (`E6`) are conditional, and receipts (`E7`) arrive at resolution; timing of the recurring question card (`E3`) requires live usability testing.

---

## What the data turned out to be (added after the first full pass)

Three things were established by writing scripts rather than by reading numbers,
and all three change what the product argues:

**1. 139 is the whole corpus.** The organisers' data README confirms it: 139
risks, 57 countries, 28 active / 61 materialised / 43 not / 7 unrecorded. Our
ingest reproduces every one of those figures. There is no larger dataset to
"resolve" against — the 139 risks carry **266** dated trigger statements, and
the 266 is where the volume lives.

**2. Risk Level is a pure function of Probability alone — 128 of 128 rows.**
ACAPS publishes a 5×5 in `organiser/acaps/risk-methodology.md` (*Risk =
Probability × Impact*) where Impact moves the level. Applied to the **125** rows
carrying all three fields, it holds on **97** and departs on **28** (22 higher
than the matrix, 6 lower). Across all **19** occupied `(Probability, Impact)`
cells, not one is mixed — every departure is the arithmetic of a lookup table
that maps Probability to Risk Level and ignores Impact (an earlier revision of
this file misread those 28 rows as analyst overrides; the 22 resolved departures
materialise at 0.73 vs 0.68 expected from Probability alone, +4.4 points on
n=22). Impact is collected and discarded, and a model reading Probability *and*
Risk Level is reading one field twice.

**3. The baseline had to be re-measured, and the answer is unflattering.**
naive floor **0.2425** → ACAPS' own rating **0.2168** → logistic regression on
the same fields **0.2177** out of sample. **The regression loses.** In-sample it
scores 0.1965, and that number must never be quoted: its optimism is larger than
the entire effect under test. `npm run ladder` reproduces all of it.

**The rule this produced:** no quantitative claim in this repo may appear without
a script that regenerates it. `scripts/numbers-gate.mjs` fails CI if a retired
figure reappears or if `LADDER` drifts from the fitted artefact. It exists
because a hand-typed 0.2204 was, for three weeks, silently the regression's own
score wearing the analyst's name.
