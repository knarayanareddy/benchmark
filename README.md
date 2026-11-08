# Benchmark — ACAPS, *Ground Truth*

A single-question elicitation card (designed for a ninety-second target budget on a phone) that turns each of ACAPS' own risk statements into a probability — plus a dispatch layer that puts the right question in front of the right expert, and a dissent channel that routes objections back into the language of the risk rather than only its number.

**Status: runnable scaffold and pre-registered evaluation design, not a deployed product.** The pure core, the shared spine, the gate, the dissent loop and 117 tests are real and green, and they run against the real 139-risk export. The interface, persistence and auth layers are not built — see [`BUILD.md`](BUILD.md). No human panel has been run yet; surrounding HTML design files specify the proposed system, not completed empirical trial results.

```bash
npm run verify     # 117 tests, anonymity gate, privacy gate, numbers gate, export gate, baselines, dissent journey
npm run ladder     # regenerates the three baseline figures from data/
```

---

## Authoritative specifications & code entrypoints

The **three canonical specifications** in this repository are [`BUILD.md`](BUILD.md), [`docs/03-the-gap-to-real.md`](docs/03-the-gap-to-real.md), and [`docs/02-scoring-rules.md`](docs/02-scoring-rules.md). Everything else is either executable code/tests or supporting design context.

| Entrypoint | What it is |
|---|---|
| [`BUILD.md`](BUILD.md) | **Canonical build status, runnable commands, module table, and empirical audit findings.** |
| [`docs/03-the-gap-to-real.md`](docs/03-the-gap-to-real.md) | **Canonical limitations & trial note.** Statistical power, prospective triggers, endogenous labels, and operational gaps. |
| [`docs/02-scoring-rules.md`](docs/02-scoring-rules.md) | **Canonical scoring & aggregation rules (`R1`–`R8`).** |
| [`packages/core/src/`](packages/core/src/) | Pure domain modules: [`scoring.js`](packages/core/src/scoring.js) (validated Brier + paired bootstrap), [`aggregate.js`](packages/core/src/aggregate.js) (pooling, smoothed bootstrap intervals, ACAPS 5×5 bridge, `releaseAggregate` `n ≥ 5` & `<10` order-stat suppression), [`gate.js`](packages/core/src/gate.js) (structural blockers vs calibrated `observable` warning), [`dispatch.js`](packages/core/src/dispatch.js) (weekly cap + dissent bypass), [`anonymity.js`](packages/core/src/anonymity.js) (allowlist attribution + 9,000-slot / collision-free aliases). |
| [`packages/benchmark/src/dissent.js`](packages/benchmark/src/dissent.js) | Strict 5-state dissent lifecycle (`open → routed → actioned → notified → closed`), wired to [`packages/shared/loop.js`](packages/shared/loop.js), with contactable-notify enforcement and addressless `cardLedger()` for anonymous dissenters. |
| [`packages/shared/`](packages/shared/) | Integrity-checked shared spine (`card.js`, `validate.js`, `loop.js`, `a11y.js`). |
| [`scripts/`](scripts/) | Reproducible audit & verification scripts: `ingest.py`, `measure-baseline.mjs`, `fit-baseline.mjs`, `gate-export.mjs`, `check-methodology.mjs`, `journey.mjs`, `numbers-gate.mjs`. |
| [`mockups/benchmark-expert-flow.html`](mockups/benchmark-expert-flow.html) | Six-screen static mockup wired live to `anonymity.js` and `releaseAggregate()`. |
| [`organiser/acaps/`](organiser/acaps/) | Canonical read-only ACAPS challenge brief, data dictionary, and risk methodology reference. |

<details>
<summary><b>Supporting &amp; historical design documents</b> (pre-trial design explorations &amp; earlier drafts)</summary>

| Document | Role |
|---|---|
| [`docs/01-one-pager.md`](docs/01-one-pager.md) | Executive pitch summary (2 min). |
| [`design/04-adoption-review.md`](design/04-adoption-review.md) | Review of ACAPS' risk methodology: five adoptions, one weighting correction, one refusal. |
| [`design/BENCHMARK-blueprint.html`](design/BENCHMARK-blueprint.html) | Pre-trial architecture & interface specification (proposed design, not empirical results). |
| [`research/market-landscape.html`](research/market-landscape.html) | Literature and market review across humanitarian forecasting programmes. |
| [`research/00-challenge-analysis.html`](research/00-challenge-analysis.html) | Initial end-to-end read of the ACAPS challenge and export. |
| [`research/02-repo-audit.html`](research/02-repo-audit.html) | File-by-file audit of the ACAPS starter kit. |
| [`design/01-project-directions.html`](design/01-project-directions.html) | Fourteen candidate directions scored. |
| [`design/03-product-blueprint.html`](design/03-product-blueprint.html) | **Partly superseded** by `BENCHMARK-blueprint.html`. |
| [`planning/BENCHMARK-plan.html`](planning/BENCHMARK-plan.html) | **Superseded** by `BENCHMARK-blueprint.html`; retained for build-order reasoning. |
| [`planning/product-audit.html`](planning/product-audit.html) | 17-finding audit (§09 contains the ACAPS finding that reshaped the pitch). |

</details>

---

## Six measured facts from the export

1. **266** date-stamped trigger statements across **139** risks — statements are the unit with volume, while **104 of the 139 risks** carry resolved `Materialised` (`61`) / `Not materialised` (`43`) labels assigned post-hoc by ACAPS' analysts.
2. **~17%** is the one published response rate for this behaviour: ACAPS surveyed *more than 60* external experts for its Afghanistan risk report and **ten replied** — a survey response rate, not matrix completion.
3. **101 of the 139 triggers that carry a completion rate carry no written resolution criterion** — 73% of ACAPS's own progress tracking is measured against something unstated.
4. **31 of 139 risks have no triggers at all**, **11 have no probability rating** and **7 have no status**.
5. The performance ladder: naive floor **0.2425** → **ACAPS' own judgement 0.2168** → a logistic regression **0.2177** out of sample. **Lower is better, so the regression lost to the experts.** All three rungs are measured by scripts in this repo (`npm run ladder`).
6. At `n = 104` the paired Brier difference SD is **0.1505** (80%-power MDE **0.0413**, requiring **n ≈ 445** resolved items to detect a **0.02** Brier gain), so neither gap in that ladder is distinguishable from zero — and prospective evaluation must run on rolling **266** trigger statements anchored to external resolution criteria rather than hindsight-contaminated or post-hoc editorial labels.

---

## The five design commitments

1. A strict 5-state dissent machine (`open → routed → actioned → notified → closed`) composes notifications via `packages/shared/loop.js`, forbids closing unrouted dissents or closing contactable actioned dissents before `notify()`, and publishes an addressless `cardLedger()` entry so `ANONYMOUS` dissenters also see what changed.
2. Every score on screen carries a variance-preserving smoothed bootstrap interval, and `releaseAggregate()` enforces `n ≥ 5`, suppresses quartiles/extremes below `n = 10`, and updates only at Round-1 close or in `≥ 3`-respondent cohorts so neither order-statistic equations nor consecutive snapshots can invert individual answers.
3. The gate separates hard structural blockers (`window`, `single`, `no_leak`, `condition`) from the lexical `observable` authoring warning (calibrated at **86.2%** warn precision across 50 labelled corpus items).
4. Target budget of ninety seconds per recurring question card (`E3`), one thumb, phone-first (design budget, unmeasured until live user testing).
5. Somebody can say "the bar is ACAPS' 0.2168, and our regression lost" without hesitating — and can show the two scripts that compute it.

---

## Expert-controlled anonymity — built

ACAPS' second Must Have: each expert chooses their own level — known to ACAPS,
pseudonymous to peers, or fully anonymous. Implemented in
`packages/core/src/anonymity.js` with strict allowlist attribution, 9,000-slot /
collision-free panel aliases, tiered release suppression (`MIN_RELEASE_PANEL_SIZE = 5`
with `<10` order-statistic suppression and smoothed bootstrap intervals in
`releaseAggregate()`; `PUBLIC.minCount = 10` for public regional/thematic rollups),
held by `npm run gate:anonymity` in CI and 29 tests. See [`BUILD.md`](BUILD.md).

## What this is not

Nothing here is a deployed product. And unlike Doorway, Benchmark has a second problem: **no panel has ever been run, and a regression on ACAPS' own fields does not beat ACAPS' own analysts.** The honest deliverable is a verified core plus a pre-registered prospective trial design. See [`docs/03-the-gap-to-real.md`](docs/03-the-gap-to-real.md).

---

*Compiled 6 November 2026 · Hackathon for Good #8 · The Hague.*
