# Benchmark — is it a full-fledged product?

**Short answer: no. It is a specification, and unlike Doorway it has a second problem — the central claim is unproven and cannot be proven by building.**

---

## Where it sits

```
idea  →  concept  →  specification  →  prototype  →  pilot  →  product
                          ▲
                    you are here
```

Specification plus runnable core and verification scripts (no UI), one unclosed empirical question.

| Requirement | Status |
|---|---|
| Runs, deployed, monitored | Core logic, shared spine, ingest and CI gates written and tested; UI and deployment not written (~4,000 lines specified). |
| Adopts without you | Partly — the four documents exist; the auth story does not. |
| Has a customer | **No. ACAPS has not asked for this.** This is the largest gap. |
| Sustains itself | No owner, no budget for expert incentives, no home for the output. |
| **Proves itself** | **No. The panel has never been run. The baseline is now measured — and it is ACAPS, at 0.2171, not a regression.** |
| Survives scrutiny | Ethics path unbuilt; consent and attribution for named experts unspecified. |

---

## The structural problem, stated plainly

Doorway's missing evidence is a field-wide gap — nobody has shown that warnings work beyond minutes, so Doorway is not behind its competitors. **Benchmark's missing evidence is specific and comparative.** The bar is not "does it work at all," it is **ACAPS' own rating at 0.2171** — and, uncomfortably, a logistic regression on ACAPS' own fields is indistinguishable from it at n=104.

So the product has to argue something narrow and testable: *the regression sees four fields of metadata; the panel reads the actual sentence, and the sentence contains information the fields do not.* That is a good argument. It is not a result.

**With unlimited time, this is what closes it:**

| Phase | Duration | What it produces |
|---|---|---|
| Build | 4–6 weeks, 1–2 engineers | Ingest, gate, card, dispatch, dissent, aggregation, scoring. |
| Rolling pilot | 3–6 months | Prospective elicitation on the **28 Active risks** (the only statements with an ACAPS rating) and the **76 triggers under them** (104 statements), scored against outcomes and a base rate for the triggers, as 30–90 day windows close. The other 190 of the 266 triggers sit under risks whose outcome is already known, so scoring them would be hindsight. |
| Powered evaluation | Not set | No sample size is set. The earlier target of **n ≈ 506** is withdrawn: it rested on a `paired SD = 0.1605` (`scripts/measure-baseline.mjs`) that is the SD of ACAPS minus a base-rate forecast, not panel minus ACAPS. The power analysis is in progress (`docs/14`, not yet written); [`docs/06-protocol.md`](06-protocol.md) has the current position. |

**Why prospective triggers rather than retrospective risks.** The 104 already-resolved risks establish the incumbent baselines (`0.2425` floor, `0.2171` ACAPS, `0.2177` LOO logistic), but asking human country experts today to "forecast" historical 2021–2025 crises (Taliban provincial-capital offensives, Sudan, Gaza) is contaminated by hindsight — experts already know what happened. The earlier sample-size argument (a `0.0441` Brier minimum detectable effect at `n = 104`) is withdrawn; see [`docs/06-protocol.md`](06-protocol.md). Scoring rolling 30–90 day trigger statements prospectively addresses hindsight contamination; whether it also settles the sample size is for the power analysis (`docs/14`, not yet written).

**Why external resolution criteria matter (endogenous labels & selection).** In `risk-radar-export.csv`, `Materialised` / `Not materialised` is assigned post-hoc by ACAPS' own analysts with no fixed end date and no independent oracle — so `0.2171` measures analyst-to-analyst self-consistency as much as exogenous forecast skill, on a non-random sample of published concerns (`61/104 = 58.7%` materialised). A credible prospective trial must bind each trigger's `objective` before opening to an external source (ACLED event logs, IPC Phase releases, UNHCR border counts, official decrees) rather than post-hoc editorial judgement.

---

## What full-fledged would need that the blueprint does not specify

### A recruitment and incentive design
51% expert dropout is the base rate in this literature. A real product budgets for it: incentives, an incentives policy, a funnel, and a reason for a country analyst in Juba to spend ninety seconds on someone else's questionnaire. **Unspecified, and it is the most likely cause of failure.**

### An owner for resolution
Someone has to observe each outcome on the stated date, by the stated rule, and record unobservable as unobservable. That is operational work, it never stops, and it is the hardest part of any forecasting system. Currently a paragraph in a protocol.

### An ethics and consent path
Forecasting humanitarian risk with named experts raises consent, attribution and duty-of-care questions. A real product has an approval and a data agreement. Unspecified.

### A home for the numbers
The output must land beside the statement in the workflow people already use, not in a dashboard. The blueprint says this and does not design it.

### Governance for the dissent channel
If an expert's objection can rewrite an ACAPS risk statement, someone has to decide how much weight that carries and whether it is disclosed. That is an editorial policy question, not a technical one.

---

## What to call it

The accurate framing, which is also the strongest:

> **A specified product built on a falsifiable hypothesis, with incumbent baselines measured and a prospective trigger-level evaluation designed.**

And if a juror asks whether it works, the answer is the one written into the blueprint:

> "We fitted the baseline rather than quoting one. A logistic regression on ACAPS' own structured fields scores 0.2177 out of sample; ACAPS' own analysts score 0.2171 on the same 104 risks. **The model is nominally behind, and indistinguishable.** Neither gap from the base rate is significant at n=104 (for ACAPS against the base rate: paired SD 0.1605, 80%-power MDE 0.0441) — ACAPS' judgement is a real signal sitting just under this sample's noise floor, and retrospective human scoring on resolved crises would be contaminated by hindsight. So the bar for any panel is ACAPS, not the regression, and our claim is specific: the model reads the fields, the panel reads the sentence, and prospective elicitation on the statements still open (104 today: 28 Active risks, the only ones with an ACAPS rating, and 76 triggers scored against outcomes) can test that cleanly, paired, with intervals. The sample size for that test is not yet set; the earlier figure of about 506 is withdrawn (see `docs/06-protocol.md`)."

That is a strong answer. It is not the same as a working product, and saying so is cheaper than being caught.
