# BUILD.md — start here

**Scaffolded and verified, not finished.** The scoring, gate and dispatch logic is written and tested against the real export; the interface is not written.

```
$ npm run verify
✓ 58 unit tests pass
✓ gate runs on the real export: 139 blocks, 19 rejected (13.7%)
✓ dissent loop closes in <60s
```

---

## What works right now

| Module | File | State | Proof |
|---|---|---|---|
| **Shared spine** | `packages/shared/` | **Complete** | 18 tests — card, validation, loop, a11y |
| Scoring | `packages/core/src/scoring.js` | **Complete** | Brier + bootstrap + paired comparison, 9 tests |
| The Gate | `packages/core/src/gate.js` | **Complete** | 5 deterministic checks, 7 tests, **run on the real export** |
| Dispatch | `packages/core/src/dispatch.js` | **Complete** | Per-expert weekly cap, dissent priority, health, 6 tests |
| Anonymity | `packages/core/src/anonymity.js` | **Complete** | 3 expert-controlled levels, fail-closed attribution, 18 tests |
| Dissent loop | `packages/benchmark/src/dissent.js` | **Complete** | 5-state lifecycle, end-to-end journey script |
| Ingest | `scripts/ingest.py` | **Complete** | 139 blocks / 266 triggers → 104 resolved, matches the benchmark |
| Interface | — | **Not written** | React + Vite PWA, per `design/BENCHMARK-blueprint.html` §11 |

---

## The two findings already in the repo

Both came from running the code, not from reading.

**1. The gate had a 43% false-positive rate.** It split on the word "and", which flattened real ACAPS titles like *"worsens drought and leads to agricultural losses."* Rewritten to fire only on strong conjunctions; rejection rate fell to **13.7%**. A gate that rejects half the corpus is a broken gate, not a strict one.

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

`scripts/backtest.mjs` runs synthetic predictors to prove the plumbing. When real estimates arrive, replace `intensityP()` with panel medians and the answer falls out of the same function. That is the single most valuable thing this repo can produce, and it is worth more than the interface:

> Run the panel retrospectively on the 104 already-resolved risks. You get the answer in weeks instead of a year, before anyone commits to a pilot.

---

## Hard rules

- **No leaderboard.** Panel scores public, individual scores private.
- **Every score renders with its interval.** There is no code path that returns a naked point estimate.
- **Unobservable ≠ miss.** `scoring.js` excludes `null` outcomes; it never counts them as failures.
- **The Declaration decides who is told, never how much weight they carry.** Weighting is by seed-variable performance, and only where a domain has ≥10 seed items.

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
