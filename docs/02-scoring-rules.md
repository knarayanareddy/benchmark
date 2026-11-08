# Benchmark — scoring rules

*Fixed before the first card is sent, in writing, and shown to every expert. These are the rules that make the number worth having; changing them afterwards is how a Brier score becomes a measure of ambition.*

---

## R1 · Brier score, absolute, not relative

The primary score is the mean squared error between the stated probability and the realised binary outcome. Not a relative index against a baseline. Absolute proper scoring rules are the consensus choice in the methodological literature, and they are what allow a comparison across methods on the same risks.

## R2 · Every score carries a bootstrap interval

10,000 resamples over resolved risks. Report the interval beside the point estimate **always**, including — especially — when it is embarrassing. At n = 104 the measured standard error of a Brier score is 0.0084 for the constant base-rate predictor, 0.0155 for ACAPS' rating and 0.0157 for their paired difference (`data/power-baseline.json`, written by `npm run baseline`). An earlier revision of this paragraph said 0.04–0.05; that was 2–5× too large.

## R3 · Comparisons are paired

Same risks, two methods. The errors are correlated, so a paired difference has far more power than comparing two independent scores. A paired comparison of the panel against ACAPS' 0.2171 is the *only* honest way to state the gap. Only the 28 Active risks carry an ACAPS rating, so a prospective head-to-head is at risk level; the trigger statements are scored against outcomes and a base rate (see `docs/06-protocol.md`).

## R4 · Unobservable ≠ miss

If an outcome cannot be observed by the stated date, it is recorded as unobservable and excluded from scoring — not counted as a failure to materialise. Fixed in writing before the first card. Without this rule, the score rewards conservative statements and measures ambition rather than accuracy.

## R5 · Resolution criteria before the question opens

Each card's window and outcome definition are fixed at ingest, not at resolution. A statement whose resolution depends on judgement after the fact is not forecastable and should have been caught by the gate.

## R6 · Two rounds maximum

Round one: independent. Round two: the distribution is shown — **never who said what** — and each expert may revise. The elicitation literature finds little gain beyond two rounds and completion falls fast.

## R7 · No public leaderboard

**Amended 7 Nov 2026.** No per-person score is visible to staff. A private "my record" view for each expert, for themself only, is planned and not built.

Panel scores are public. There is no public leaderboard, and no per-person score is shown to staff. A leaderboard converts experts into competitors and degrades the calibration that made the number worth collecting.

> **Superseded (7 Nov 2026):** Panel scores are public. Individual scores are private to the expert and the analyst. A leaderboard converts experts into competitors and degrades the calibration that made the number worth collecting.

## R8 · Equal weight for every answer; the Declaration decides only who is asked

**Amended 7 Nov 2026.** No track-record weighting in any aggregate. The Declaration decides who is asked, never how much an answer counts.

The Declaration screen (countries, regions, themes) decides **who gets asked**. It does not decide **how much weight their estimate carries**, and no released aggregate weights an estimate by the expert's track record or by their self-declaration. The pure core still contains a track-record function, `seedWeights()` in `packages/core/src/aggregate.js`, which is reachable only through an optional `seedHistory` argument that no service route or screen passes. Removing it is a code change, not made by this rule.

> **Superseded (7 Nov 2026):** The Declaration screen (regions × themes) decides **who gets told**. It does not decide **how much weight their estimate carries**. Weighting comes from realised calibration on statements they were previously notified about. People are reliably overconfident about what they know, and the confidence errors correlate — which makes a self-weighted panel look tight and be wrong.

## R9 · Round 1 is blind

**Amended 7 Nov 2026.** The earlier text of this rule said the baseline is computed *before* elicitation so that "the expert adjusts a number rather than inventing one", and cards opened on ACAPS's band midpoint. That was a mistake. A pre-filled number anchors the answer (Tversky & Kahneman 1974), and it anchored it on the very thing the study compares the panel against. A panel that starts from ACAPS's rating can only be shown to resemble ACAPS.

The rule now:

- **In Round 1 an expert sees no ACAPS rating, no panel result and no pre-filled number.** The slider has no thumb position and Submit stays off until they have put a number down (slider or typed, whole numbers 1–99). This is enforced on the server as well as in the page: no inbox, card, status or list payload an expert can reach carries ACAPS's reading, and tests fail if one does (`packages/service/test/blind-round1.test.js`).
- **ACAPS's own reading is still stored on the card** (`acaps_p`, `acaps_band`) because it is the thing the panel is scored against. It is for scoring and analysis. A risk ACAPS never rated has no reading and is not given an invented one (11 of the 139 have none).
- **The first answer is the primary one.** The Round-1 result is ledgered when the round closes and cannot change afterwards, however much Round 2 revises. Round 2 shows an expert the panel distribution and their own first answer, never ACAPS's rating. By default Round 2 carries no ACAPS marker. The marker is an opt-in switch (`BENCHMARK_SHOW_ACAPS_ROUND2=1`) that needs a protocol amendment, because with it on every Round-2 expert sees ACAPS's band, which makes the revision toward ACAPS and the second-look measurements uninformative. It is a secondary, separately scored measurement.
- **Showing ACAPS's reasoning after lock-in is a separate, later decision** (a randomised "second look"), not part of this rule. If it is built, it is an experimental arm and its effect is measured, never assumed neutral.

What this costs, stated honestly: the original argument was that an adjustable number is faster than inventing one, and task length drives dropout. Blind answers will take longer than a nudge of a slider. Time per answer and completion are therefore measured in the pilot rather than assumed.

Two rules remain from the old R9, with the same reasons:

- **Score ACAPS on the band midpoint, not the ordinal.** ACAPS publishes the percentage bands behind its scale (Very Low 0–20 · Low 21–40 · Medium 41–60 · High 61–80 · Very High 81–100); its reading is the midpoint (0.10 / 0.305 / 0.505 / 0.705 / 0.905). Reading the ordinal as rating ÷ 5 would make "Very High" a certain forecast, which no analyst means and which is infinitely overconfident under a log score. `BAND_MIDPOINT` in `packages/core/src/aggregate.js` is the single source.
- **Clamp every forecast to [0.01, 0.99] before scoring.** `clampForecast()` is applied when an estimate is submitted, so no stored probability is ever 0 or 1.

## R10 · Publish the protocol, not just the score

The study design ships with the product. The most recent systematic review of digital prevention interventions concluded it is "not possible to draw any broader conclusions as to the impacts of these digital interventions at this time" — and the equivalent gap for elicitation on risk statements is that nobody has run a paired comparison against a metadata model. Shipping the protocol is the honest response to a missing result.

---

## The five numbers to have in your head

| Number | What it is |
|---|---|
| **139** | Humanitarian risks in the Risk Radar export |
| **104** | Resolved risks (61 materialised, 43 not), and therefore scoreable |
| **266** | Date-stamped trigger statements across those 139 risks |
| **~17%** | Response rate when ACAPS surveyed 60+ experts (10 replied) — the behaviour baseline |
| **73%** | Share of triggers with a completion rate whose "Quantitative objective" field is empty (101 of 139). An empty field is not a resolution criterion. |
| **0.2171** | ACAPS' own probability rating, read off ACAPS' published percentage bands (midpoints; "Very High" = 0.905) — **the bar to beat** |
| 0.2168 | *sensitivity:* the same rating read as an ordinal (rating ÷ 5, so "Very High" = 1.00). Differs by 0.0003 — the bar does not move with the reading, but 1.00 is not a defensible forecast. |
| 0.2177 | A logistic regression on the same fields, leave-one-out — **it does not beat the bar; the two are indistinguishable at n=104** |
| **0.0084–0.0157** | Measured standard error on a Brier score at this n (earlier revision said 0.04–0.05; that was wrong) |
