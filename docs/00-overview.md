# Benchmark — overview

(The one-screen summary is the repo [`README.md`](../README.md).)

A single-question elicitation card (designed for a ninety-second target budget on a phone) that turns each of ACAPS' own risk statements into a probability — plus a dispatch layer that puts the right question in front of the right expert, and a dissent channel that routes objections back into the language of the risk rather than only its number.

**Status: a verified core and a service layer with an HTTP API, plus a draft pre-registration protocol. Not a deployed product, and no panel has been run.** The pure core, the shared spine, the gate, the dissent loop, the service layer and their tests are real and green, and they run against the real 139-risk export. The interface, a Postgres adapter and staff SSO are not built — see [`BUILD.md`](../BUILD.md) and [`05-service-and-privacy.md`](05-service-and-privacy.md). No human panel has been run yet; archived HTML files specify the proposed system, not empirical results.

```bash
npm run verify     # tests, anonymity gate, privacy gate, numbers gate, export gate, baselines, dissent journey
npm run ladder     # regenerates the three baseline figures from data/
```

---

## Authoritative specifications & code entrypoints

The **canonical specifications** in this repository are [`BUILD.md`](../BUILD.md), [`docs/03-the-gap-to-real.md`](03-the-gap-to-real.md), and [`docs/02-scoring-rules.md`](02-scoring-rules.md). Everything else is either executable code/tests or supporting design context.

| Entrypoint | What it is |
|---|---|
| [`BUILD.md`](../BUILD.md) | **Canonical build status, runnable commands, module table, and empirical audit findings.** |
| [`docs/03-the-gap-to-real.md`](03-the-gap-to-real.md) | **Canonical limitations & trial note.** Statistical power, prospective triggers, endogenous labels, and operational gaps. |
| [`docs/02-scoring-rules.md`](02-scoring-rules.md) | **Canonical scoring & aggregation rules (`R1`–`R8`).** |
| [`packages/core/src/`](../packages/core/src/) | Pure domain modules: [`scoring.js`](../packages/core/src/scoring.js) (validated Brier + paired bootstrap), [`aggregate.js`](../packages/core/src/aggregate.js) (pooling, smoothed bootstrap intervals, ACAPS 5×5 bridge, `releaseAggregate` `n ≥ 5` & `<10` order-stat suppression), [`gate.js`](../packages/core/src/gate.js) (structural blockers vs calibrated `observable` warning), [`dispatch.js`](../packages/core/src/dispatch.js) (weekly cap + dissent bypass), [`anonymity.js`](../packages/core/src/anonymity.js) (allowlist attribution + 9,000-slot / collision-free aliases). |
| [`packages/benchmark/src/dissent.js`](../packages/benchmark/src/dissent.js) | Strict 5-state dissent lifecycle (`open → routed → actioned → notified → closed`), wired to [`packages/shared/loop.js`](../packages/shared/loop.js), with contactable-notify enforcement and addressless `cardLedger()` for anonymous dissenters. |
| [`packages/shared/`](../packages/shared/) | Integrity-checked shared spine (`card.js`, `validate.js`, `loop.js`, `a11y.js`). |
| [`scripts/`](../scripts/) | Reproducible audit & verification scripts: `ingest.py`, `measure-baseline.mjs`, `fit-baseline.mjs`, `gate-export.mjs`, `check-methodology.mjs`, `journey.mjs`, `numbers-gate.mjs`. |
| [`mockups/benchmark-expert-flow.html`](../mockups/benchmark-expert-flow.html) | Six-screen static mockup wired live to `anonymity.js` and `releaseAggregate()`. |
| [`organiser/acaps/`](../organiser/acaps/) | Canonical read-only ACAPS challenge brief, data dictionary, and risk methodology reference. |

**Also current:** [`docs/01-one-pager.md`](01-one-pager.md) (two-minute pitch), [`docs/04-adoption-review.md`](04-adoption-review.md) (review of ACAPS' risk methodology), [`docs/05-service-and-privacy.md`](05-service-and-privacy.md) (the service layer, guarantees and residual risk), [`docs/06-protocol.md`](06-protocol.md) (draft pre-registration). Historical design and research documents are in [`archive/`](../archive/README.md).

**The service layer:** [`packages/service/`](../packages/service/src/) — `store.js` and `pg-store.js` (roster and answers kept apart, in memory or Postgres), `service.js` (every guarantee's choke point), `http.js`, `oidc.js` (staff sign-in), `auth.js`, `consent.js`, the [`public/`](../packages/service/public/) pages, and [`db/schema.sql`](../packages/service/db/schema.sql) with [`roles.sql`](../packages/service/db/roles.sql). **Authoring:** [`packages/core/src/authoring.js`](../packages/core/src/authoring.js) and `npm run worklist` / `npm run label` triage the cards and re-measure the `observable` check without inventing labels. Deployment notes are in [`07-deploy.md`](07-deploy.md).

---

## Six measured facts from the export

1. **266** date-stamped trigger statements across **139** risks — statements are the unit with volume, while **104 of the 139 risks** carry resolved `Materialised` (`61`) / `Not materialised` (`43`) labels assigned post-hoc by ACAPS' analysts.
2. **~17%** is the one published response rate for this behaviour: ACAPS surveyed *more than 60* external experts for its Afghanistan risk report and **ten replied** — a survey response rate, not matrix completion.
3. **101 of the 139 triggers that carry a completion rate carry no written resolution criterion** — 73% of ACAPS's own progress tracking is measured against something unstated.
4. **31 of 139 risks have no triggers at all**, **11 have no probability rating** and **7 have no status**.
5. The performance ladder: naive floor **0.2425** → **ACAPS' own judgement 0.2171** → a logistic regression **0.2177** out of sample. **Lower is better, so the regression is nominally behind the experts, by 0.0007 — indistinguishable at n=104** (paired interval spans zero). The ordinal reading of ACAPS' rating (rating ÷ 5) gives 0.2168, the sensitivity check. All three rungs are measured by scripts in this repo (`npm run ladder`).
6. At `n = 104` the paired Brier difference SD is **0.1605** (80%-power MDE **0.0441**, requiring **n ≈ 506** resolved items to detect a **0.02** Brier gain), so neither gap in that ladder is distinguishable from zero — and prospective evaluation must run on statements anchored to external resolution criteria rather than hindsight-contaminated or post-hoc editorial labels. Only **104** statements are open to that today: the **28** Active risks and the **76** triggers under them. The other **190** of the 266 triggers sit under risks whose outcome is already known.

---

## The five design commitments

1. A strict 5-state dissent machine (`open → routed → actioned → notified → closed`) composes notifications via `packages/shared/loop.js`, forbids closing unrouted dissents or closing contactable actioned dissents before `notify()`, and publishes an addressless `cardLedger()` entry so `ANONYMOUS` dissenters also see what changed.
2. Every score on screen carries a variance-preserving smoothed bootstrap interval, and `releaseAggregate()` enforces `n ≥ 5`, suppresses quartiles/extremes below `n = 10`, and updates only at Round-1 close or in `≥ 3`-respondent cohorts so neither order-statistic equations nor consecutive snapshots can invert individual answers.
3. The gate separates hard structural blockers (`window`, `single`, `no_leak`, `condition`) from the lexical `observable` authoring warning (calibrated at **86.2%** warn precision across 50 labelled corpus items).
4. Target budget of ninety seconds per recurring question card (`E3`), one thumb, phone-first (design budget, unmeasured until live user testing).
5. Somebody can say "a regression on ACAPS' own fields is indistinguishable from ACAPS at n=104" without hesitating — and can show the two scripts that compute it.

---

## Expert-controlled anonymity — built

ACAPS' second Must Have: each expert chooses their own level — known to ACAPS,
pseudonymous to peers, or fully anonymous. Implemented in
`packages/core/src/anonymity.js` with strict allowlist attribution, 9,000-slot /
collision-free panel aliases, tiered release suppression (`MIN_RELEASE_PANEL_SIZE = 5`
with `<10` order-statistic suppression and smoothed bootstrap intervals in
`releaseAggregate()`; `PUBLIC.minCount = 10` for public regional/thematic rollups),
held by `npm run gate:anonymity` in CI and its own test suite. See [`BUILD.md`](../BUILD.md).

## What this is not

Nothing here is a deployed product. And unlike Doorway, Benchmark has a second problem: **no panel has ever been run, and a regression on ACAPS' own fields is indistinguishable from ACAPS' own analysts at n=104.** The honest deliverable is a verified core plus a pre-registered prospective trial design. See [`docs/03-the-gap-to-real.md`](03-the-gap-to-real.md).

---

*Compiled 6 November 2026 · Hackathon for Good #8 · The Hague.*
