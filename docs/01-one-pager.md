# Benchmark — one-pager

## The problem

ACAPS' Risk Radar export contains **139 risks** (**104 resolved**: 61 materialised, 43 not) carrying **266 date-stamped trigger statements**. Every resolved risk can be scored against what actually happened — and nobody is scoring them.

And the demand side is already measured. For its Afghanistan risk report, ACAPS sent a short risk survey to **more than 60 external experts and got 10 responses** — roughly **17%**. That is the only published figure for the exact behaviour a panel depends on, and it is the number to beat.

*(The export this rests on was supplied by ACAPS for this hackathon. It is not one
of the 42 datasets in the public catalogue at `acaps.org/en/data` — a juror can
check that in ten seconds, so we say it first.)*

## The finding the data gave us

ACAPS publishes a **5×5 matrix** deriving Risk Level from Probability × Impact, and
states the rule in their own methodology: *Risk = Probability × Impact*.

We applied that matrix to every row in the export carrying all three fields —
**125 rows**. It holds on **97**. On the other **28** the export's rating sits higher
(22) or lower (6) than the published matrix puts it.

Then we looked for the reason, and did not find what we expected. **Risk Level in the
export is exactly a function of Probability alone — 128 rows out of 128.** Departure
from the matrix is likewise a deterministic function of the Probability/Impact cell:
across 19 occupied cells, not one contains both an agreement and a departure.
`(Probability = High, Impact = 3)` is rated High in all 13 cases; the matrix says
Medium. `(Probability = Medium, Impact = 5)` is rated Medium in all 6; the matrix says
High.

**These are not analyst overrides. They are the arithmetic of a table that uses
Probability and ignores Impact.** An earlier revision of this document described them
as tacit analyst knowledge, and quoted a 73% hit rate. That reading does not survive
the data: the 22 resolved departures have an expected materialisation of 0.68 from
their Probability mix alone, against an observed 0.73 — about one item on n=22.

**The finding that survives, and is worth ACAPS' time:** the matrix collects Impact,
publishes a rule that multiplies by it, and then rates on Probability alone. Impact
does not move the outcome once probability is known — among Medium-probability risks,
those rated Impact 3, 4 and 5 materialise at 0.45, 0.55 and 0.33. The field is
collected and discarded.

That is the gap this product fills, and it is not a scoring problem. A number cannot
carry the reason an analyst had. **The reason has to be elicited from a person, at the
moment of the judgement, and attached to the statement it changed.** ACAPS' brief says
analyst knowledge "travels through informal conversations with peers and then
disappears." The export shows the cost of that: a rating that is reproducible from one
field, and a second field that is filled in and never used.

The supply side is where the loop is starving: **101 of the 139 triggers that carry a completion rate carry no written objective** — 73% of ACAPS's own progress tracking is measured against a criterion nobody wrote down. **31 risks have no triggers at all.** **11 have no probability rating.** Each is a ninety-second question with a named owner and a real consequence for a published risk level.

The obvious product is "get more experts to fill in more cells." The evidence says that product fails: every forecasting system in this literature is pull-based, and pull-based systems leak participants. The X-risk tournament lost **51% of experts against 19% of superforecasters**. RAND's forecasting programme was shut down.

## What we built

**Benchmark** turns each risk statement into a single-question card (designed for a ninety-second target budget on a phone), puts it in front of the expert who can judge it, and — the part nobody builds — closes the loop back to them.

**The Card.** One statement, its window, the historical corpus base rate, any observed trigger progress (explicitly separated from probability), a slider, one optional sentence. Neither peers' numbers nor ACAPS' own rating appear before round-one submission: anchoring and herding are the two best-documented failure modes in expert elicitation and both are caused by the interface.

This is the interface ACAPS' own cognitive-bias brief (March 2016) argues for.
That document is organised as bias → mitigation strategy, and most of its named
biases are properties of how a question is asked rather than of the person
answering it. Independent round one addresses anchoring and herding. Tiered
small-cell & order-statistic suppression (`n ≥ 5` via `releaseAggregate()` with
quartiles/extremes suppressed below `10` and smoothed bootstrap intervals inside
analyst/panel views; `n ≥ 10` for public regional/thematic rollups) addresses
inversion, differencing and social proof. "Make
sense, not data" is the same position: the judgement is the product, and the
interface is what determines whether the judgement is any good. Target budget:
ninety seconds per recurring card, one thumb, phone-first (design target, not yet
timed in a user study).

**The Dispatch.** Experts declare the regions and themes they actually know. When a statement lands in one of them, they are told — instead of having to remember to go looking. Judgement becomes a **matching problem rather than a supply problem**. Capped at three notifications a week, ever; a bounded promise is what makes a push notification acceptable rather than another app to mute.

**The Dissent.** Objections are first-class objects, not comments: *this is two risks · the window is wrong · this is already happening.* The analyst rewrites, splits, retires or resolves early — and then the expert is **told which of those happened, with a link to the new statement.** An expert who objects into silence does not object twice, and then does not forecast twice. This is the retention mechanism, and it is the only feature that literally delivers *"my dissent changed the paragraph."*

## The numbers we will not hide

| Figure | Value | What it means |
|---|---|---|
| Naive floor | 0.2425 | Predicting the constant base rate (58.7%) on every row |
| **ACAPS' own judgement** | **0.2171** | **The incumbent. It is the best of the three.** |
| Logistic regression on the same fields, out of sample | 0.2177 | The model. It does *not* beat the experts. |

Lower is better. **0.2177 > 0.2171 — the regression is nominally worse, by 0.0007, and indistinguishable.** The honest claim is not "a model beat ACAPS." It is:

> **ACAPS' judgement clears the base rate, and no model we can build gets past ACAPS' judgement.**

Both gaps — **0.0255** from the floor to ACAPS, **0.0007** from ACAPS to the model — sit inside a bootstrap interval that spans zero at n=104. So the real finding is subtler and more useful than the one we started with: **expert judgement on this corpus carries a signal that is real but sits just under the noise floor of the sample.** Any panel has to beat a bar that is already near the limit of what 104 observations can distinguish. That is why the test must be paired — same risks, two methods — and why every number here carries an interval.

The in-sample fit scores **0.1965**. We do not quote it. It is the model being graded on risks it was fitted to, and its optimism (**0.021**) is larger than the entire effect the product is trying to measure. A number that flatters us by more than the thing we are measuring is not evidence. It is a trap that a juror should catch us setting, and we would rather set it in the open.

## What it refuses

No leaderboard. No prediction market. No LLM as the forecaster (o3 at 0.1352 trails superforecasters at ~0.086, and parity is projected for 2027 — a two-year moat is not a moat). No weighting by self-declared expertise: that is an **onboarding** mechanism, not a weighting one, because people are reliably overconfident about what they know and the errors correlate. Weighting comes from realised track record, and each expert sees their own calibration curve.

## The ask

A pre-registered test of one hypothesis: **the panel sees the sentence, and the structured fields do not.** That is the whole argument, it is falsifiable, and it is the reason this is a submission rather than a claim.

---

*Hackathon for Good #8 · ACAPS · Ground Truth · 6 November 2026*
