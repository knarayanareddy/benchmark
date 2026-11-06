# Benchmark — ACAPS, *Ground Truth*

A single-question elicitation card (designed for a ninety-second target budget on a phone) that turns each of ACAPS' own risk statements into a probability — plus a dispatch layer that puts the right question in front of the right expert, and a dissent channel that routes objections back into the language of the risk rather than only its number.

**Status: runnable scaffold, not a product.** The pure core, the shared spine, the gate, the dissent loop and 98 tests are real and green, and they run against the real 139-risk export. The interface layer is not built — see [`BUILD.md`](BUILD.md). Note that Benchmark carries one risk Doorway does not: its central claim is unproven and cannot be proven this weekend.

```bash
npm run verify     # 98 tests, anonymity gate, privacy gate, numbers gate, export gate, baselines, dissent journey
npm run ladder     # regenerates the three baseline figures from data/
```

---

## Start here — code & runnable entrypoints

| Entrypoint | What it is |
|---|---|
| [`BUILD.md`](BUILD.md) | **Build status, runnable commands, module table, and empirical audit findings.** |
| [`packages/core/src/`](packages/core/src/) | Pure domain modules: [`scoring.js`](packages/core/src/scoring.js) (Brier + paired bootstrap), [`aggregate.js`](packages/core/src/aggregate.js) (pooling, intervals, ACAPS 5×5 bridge, static & temporal `releaseAggregate` differencing guards), [`gate.js`](packages/core/src/gate.js) (structural blockers vs calibrated `observable` warning), [`dispatch.js`](packages/core/src/dispatch.js) (weekly cap + dissent bypass), [`anonymity.js`](packages/core/src/anonymity.js) (3-level allowlist attribution + 9,000-slot / collision-free aliases). |
| [`packages/benchmark/src/dissent.js`](packages/benchmark/src/dissent.js) | Strict 5-state dissent lifecycle (`open → routed → actioned → notified → closed`), wired to [`packages/shared/loop.js`](packages/shared/loop.js) (`compose()`, `latency()`) and `anonymity.js`. |
| [`packages/shared/`](packages/shared/) | Integrity-checked shared spine (`card.js`, `validate.js`, `loop.js`, `a11y.js`). |
| [`scripts/`](scripts/) | Reproducible audit & verification scripts: `ingest.py`, `measure-baseline.mjs`, `fit-baseline.mjs`, `gate-export.mjs`, `check-methodology.mjs`, `journey.mjs`, `numbers-gate.mjs`. |
| [`mockups/benchmark-expert-flow.html`](mockups/benchmark-expert-flow.html) | Six-screen static mockup wired live to `anonymity.js` and `releaseAggregate()`. |
| [`organiser/acaps/`](organiser/acaps/) | Canonical read-only ACAPS challenge brief, data dictionary, and risk methodology reference. |

## Active submission & methodology documents

| # | Document | What it is | Read time |
|---|---|---|---|
| 1 | [`docs/01-one-pager.md`](docs/01-one-pager.md) | **The submission one-pager.** | 2 min |
| 2 | [`docs/03-the-gap-to-real.md`](docs/03-the-gap-to-real.md) | **Read this before claiming it works.** Honest audit of statistical power, prospective trigger evaluation, and operational gaps. | 10 min |
| 3 | [`docs/02-scoring-rules.md`](docs/02-scoring-rules.md) | The eight non-negotiable scoring and aggregation rules (`R1`–`R8`). | 4 min |
| 4 | [`design/04-adoption-review.md`](design/04-adoption-review.md) | **What ACAPS' own methodology tells us, and what we adopt.** Five adoptions, one correction to our weighting design, one refusal. | 14 min |
| 5 | [`design/BENCHMARK-blueprint.html`](design/BENCHMARK-blueprint.html) | **The build blueprint.** Architecture, schemas, dissent lifecycle, dispatch layer, scoring module, repo tree, acceptance tests. | 45 min |
| 6 | [`research/market-landscape.html`](research/market-landscape.html) | **The market analysis.** Four layers, the nine ways this dies, the methods literature, and §08 on the UNICRI layer. | 40 min |

<details>
<summary><b>Archive — earlier working notes &amp; superseded drafts</b> (retained for audit trail)</summary>

| Document | Note |
|---|---|
| [`research/00-challenge-analysis.html`](research/00-challenge-analysis.html) | Initial end-to-end read of the ACAPS challenge and its data. |
| [`research/02-repo-audit.html`](research/02-repo-audit.html) | File-by-file audit of the ACAPS starter repo. |
| [`design/01-project-directions.html`](design/01-project-directions.html) | Fourteen candidate directions scored. |
| [`design/03-product-blueprint.html`](design/03-product-blueprint.html) | **Partly superseded** by `BENCHMARK-blueprint.html`. |
| [`planning/BENCHMARK-plan.html`](planning/BENCHMARK-plan.html) | **Superseded** by `BENCHMARK-blueprint.html`; retained for build-order reasoning. |
| [`planning/product-audit.html`](planning/product-audit.html) | 17-finding audit (§09 contains the ACAPS finding that reshaped the pitch). |

</details>

---

## The thesis in three numbers

- **266** date-stamped trigger statements across **139** risks — statements are the unit with volume, while **104 of the 139 risks** have resolved outcomes.
- **~17%** is the one published response rate for this behaviour: ACAPS surveyed *more than 60* external experts for its Afghanistan risk report and **ten replied**. That is the closest thing to a baseline for the exact behaviour a panel depends on, and it is a survey response rate — not matrix completion, a figure earlier drafts of this file got wrong.
- **101 of the 139 triggers that carry a completion rate carry no written resolution criterion** — 73% of ACAPS's own progress tracking is measured against something unstated.
- **31 of 139 risks have no triggers at all**, **11 have no probability rating** and **7 have no status**. The corpus is a working export, and every one of those gaps is a place where an expert could add something in ninety seconds.
- The performance ladder: naive floor **0.2425** → **ACAPS' own judgement 0.2168** → a logistic regression **0.2177** out of sample. **Lower is better, so the regression lost to the experts.** All three rungs are measured by scripts in this repo (`npm run ladder`); none is quoted.
- At n ≈ 104 the standard error on a Brier score is **0.04–0.05** (paired SD **0.1505**, 80%-power MDE **0.0413**, requiring **n ≈ 445** resolved items to detect a **0.02** Brier gain), so neither gap in that ladder is distinguishable from zero — and prospective evaluation must run on the rolling **266** trigger statements rather than hindsight-contaminated historical crises.

---

## The five design commitments

1. A strict 5-state dissent machine (`open → routed → actioned → notified → closed`) composes notifications via `packages/shared/loop.js`, bypasses the weekly dispatch cap for contactable dissenters, and strips IDs for `ANONYMOUS` dissenters.
2. Every score on screen has an interval beside it, and `releaseAggregate()` withholds live updates until Round-1 close or `≥ 3`-respondent cohorts so consecutive medians cannot be differenced.
3. The gate separates hard structural blockers (`window`, `single`, `no_leak`, `condition`) from the lexical `observable` authoring warning (calibrated at **86.2%** warn precision across 50 labelled corpus items).
4. Target budget of ninety seconds per recurring question card (`E3`), one thumb, phone-first (design budget, unmeasured until live user testing).
5. Somebody can say "the bar is ACAPS' 0.2168, and our regression lost" without hesitating — and can show the two scripts that compute it.

---

## Expert-controlled anonymity — built

ACAPS' second Must Have: each expert chooses their own level — known to ACAPS,
pseudonymous to peers, or fully anonymous. Implemented in
`packages/core/src/anonymity.js` with strict allowlist attribution, 9,000-slot /
collision-free panel aliases, two-tier small-cell suppression (`n ≥ 3`
analyst/panel view in `aggregate.js`; `PUBLIC.minCount = 10` for public
regional/thematic rollups), and close/cohort release batching (`releaseAggregate`),
held by `npm run gate:anonymity` in CI and 20 tests. See [`BUILD.md`](BUILD.md).

## What this is not

Nothing here is a working product. And unlike Doorway, Benchmark has a second problem: **no panel has ever been run, and a regression on ACAPS' own fields does not beat ACAPS' own analysts.** The honest position is a pre-registered hypothesis, which is a legitimate submission and a weaker one than "here is the number." See [`docs/03-the-gap-to-real.md`](docs/03-the-gap-to-real.md) §4.

---

*Compiled 6 November 2026 · Hackathon for Good #8 · The Hague.*
