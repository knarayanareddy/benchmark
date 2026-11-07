# Benchmark — scoring rules

*Fixed before the first card is sent, in writing, and shown to every expert. These are the rules that make the number worth having; changing them afterwards is how a Brier score becomes a measure of ambition.*

---

## R1 · Brier score, absolute, not relative

The primary score is the mean squared error between the stated probability and the realised binary outcome. Not a relative index against a baseline. Absolute proper scoring rules are the consensus choice in the methodological literature, and they are what allow a comparison across methods on the same risks.

## R2 · Every score carries a bootstrap interval

10,000 resamples over resolved risks. Report the interval beside the point estimate **always**, including — especially — when it is embarrassing. At n ≈ 104 the standard error is on the order of 0.04–0.05, which is larger than any difference between the methods under comparison.

## R3 · Comparisons are paired

Same risks, two methods. The errors are correlated, so a paired difference has far more power than comparing two independent scores. A paired comparison of the panel against ACAPS' 0.2171 is the *only* honest way to state the gap.

## R4 · Unobservable ≠ miss

If an outcome cannot be observed by the stated date, it is recorded as unobservable and excluded from scoring — not counted as a failure to materialise. Fixed in writing before the first card. Without this rule, the score rewards conservative statements and measures ambition rather than accuracy.

## R5 · Resolution criteria before the question opens

Each card's window and outcome definition are fixed at ingest, not at resolution. A statement whose resolution depends on judgement after the fact is not forecastable and should have been caught by the gate.

## R6 · Two rounds maximum

Round one: independent. Round two: the distribution is shown — **never who said what** — and each expert may revise. The elicitation literature finds little gain beyond two rounds and completion falls fast.

## R7 · No public leaderboard

Panel scores are public. Individual scores are private to the expert and the analyst. A leaderboard converts experts into competitors and degrades the calibration that made the number worth collecting.

## R8 · Weighting by track record, never by self-declaration

The Declaration screen (regions × themes) decides **who gets told**. It does not decide **how much weight their estimate carries**. Weighting comes from realised calibration on statements they were previously notified about. People are reliably overconfident about what they know, and the confidence errors correlate — which makes a self-weighted panel look tight and be wrong.

## R9 · The model baseline is computed before elicitation

The expert adjusts a number rather than inventing one. This is a design rule with a scoring consequence: it makes the expert's contribution measurable as a *deviation* from a known baseline, which is the quantity the whole product is trying to estimate.

Two rules make that baseline defensible:

- **Seed on the band midpoint, not the ordinal.** ACAPS publishes the percentage bands behind its scale (Very Low 0–20 · Low 21–40 · Medium 41–60 · High 61–80 · Very High 81–100). A card opens at the band midpoint (0.10 / 0.305 / 0.505 / 0.705 / 0.905). Reading the ordinal as rating ÷ 5 would open "Very High" at 1.00, a certain forecast, which no analyst means and which is infinitely overconfident under a log score. `BAND_MIDPOINT` in `packages/core/src/aggregate.js` is the single source.
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
| **73%** | Share of scored triggers with no written resolution criterion (101 of 139) |
| **0.2171** | ACAPS' own probability rating, read off ACAPS' published percentage bands (midpoints; "Very High" = 0.905) — **the bar to beat** |
| 0.2168 | *sensitivity:* the same rating read as an ordinal (rating ÷ 5, so "Very High" = 1.00). Differs by 0.0003 — the bar does not move with the reading, but 1.00 is not a defensible forecast. |
| 0.2177 | A logistic regression on the same fields, leave-one-out — **it does not beat the bar; the two are indistinguishable at n=104** |
| **0.04–0.05** | Standard error on a Brier score at this n |
