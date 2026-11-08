# Benchmark — scoring rules

*Fixed before the first card is sent, in writing, and shown to every expert. These are the rules that make the number worth having; changing them afterwards is how a Brier score becomes a measure of ambition.*

---

## R1 · Brier score, absolute, not relative

The primary score is the mean squared error between the stated probability and the realised binary outcome. Not a relative index against a baseline. Absolute proper scoring rules are the consensus choice in the methodological literature, and they are what allow a comparison across methods on the same risks.

## R2 · Every score carries a bootstrap interval

10,000 resamples over resolved risks. Report the interval beside the point estimate **always**, including — especially — when it is embarrassing.

The resample count is not a free parameter: `DEFAULT_REPS = 10_000`, `alpha = 0.05` and the seed are recorded in every payload under `interval`, and the same constant is consumed by `aggregate()`, `releaseAggregate()` and `bootstrapBrier()`. An interval whose resample count is not stated cannot be checked.

**Measured standard errors at n = 104** (`npm run ladder`; the bootstrap intervals imply the same figures, which is the point):

| quantity | item SD | SE of the mean |
|---|---|---|
| constant base-rate predictor | 0.0856 | **0.0084** |
| ACAPS rating (ordinal / 5) | 0.1874 | **0.0184** |
| **paired** difference (ACAPS − floor) | 0.1505 | **0.0148** |

The paired item SD is **0.1505**, so an 80%-power two-sided test at `n = 104` can only detect a minimum detectable effect of **0.0413** Brier — and reaching 0.02 requires **n ≈ 445** resolved statements (`data/power-baseline.json`, written by `scripts/measure-baseline.mjs`).

An earlier revision of this document said the standard error was "on the order of 0.04–0.05". That was wrong by 2–5×. The conclusion it was used to support — that no gap in the ladder is distinguishable from zero — still holds, but the reason is pairing, not a large unpaired error: the paired difference of 0.0009 sits inside an SE of 0.0148.

## R3 · Comparisons are paired

Same risks, two methods. The errors are correlated, so a paired difference has far more power than comparing two independent scores. A paired comparison of the panel against ACAPS' 0.2168 is the *only* honest way to state the gap.

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
| **0.2168** | ACAPS' own probability rating — **the bar to beat** |
| 0.2171 | *check:* the same rating read off ACAPS' published percentage bands (midpoints). Differs by 0.0003 — the bar does not move with the reading. |
| 0.2177 | A logistic regression on the same fields, leave-one-out — **it does not beat the bar** |
| **0.0084 / 0.0184** | Standard error on a Brier score at this n (base rate / ACAPS rating); **0.0148** paired |
## Probability bands

`probabilityBand()` maps a probability to ACAPS' five bands. The boundary is
**upper-inclusive**: `p <= band.max`, so `0.2` is Very Low and `0.2001` is Low.

ACAPS publishes integer percentages (0–20, 21–40, …), so a submission sitting
exactly on `0.2` has no ACAPS answer — this is a convention on our side, not a
fact on theirs. The returned band carries `boundary: 'upper-inclusive'` so a
renderer can say which side a value falls on, and the boundaries are pinned by
a table test at 0 / 0.1999 / 0.2 / 0.2001 / 0.4 / 0.4001 / 0.6 / 0.6001 /
0.8 / 0.8001 / 0.999 / 1.

