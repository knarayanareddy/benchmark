# Benchmark — is it a full-fledged product?

**Short answer: no. It is a specification, and unlike Doorway it has a second problem — the central claim is unproven and cannot be proven by building.**

---

## Where it sits

```
idea  →  concept  →  specification  →  prototype  →  pilot  →  product
                          ▲
                    you are here
```

Complete specification, no code, one unclosed empirical question.

| Requirement | Status |
|---|---|
| Runs, deployed, monitored | Not written. ~4,000 lines specified. |
| Adopts without you | Partly — the four documents exist; the auth story does not. |
| Has a customer | **No. ACAPS has not asked for this.** This is the largest gap. |
| Sustains itself | No owner, no budget for expert incentives, no home for the output. |
| **Proves itself** | **No. The panel has never been run. The baseline is now measured — and it is ACAPS, at 0.2168, not a regression.** |
| Survives scrutiny | Ethics path unbuilt; consent and attribution for named experts unspecified. |

---

## The structural problem, stated plainly

Doorway's missing evidence is a field-wide gap — nobody has shown that warnings work beyond minutes, so Doorway is not behind its competitors. **Benchmark's missing evidence is specific and comparative.** The bar is not "does it work at all," it is **ACAPS' own rating at 0.2168** — and, uncomfortably, a logistic regression on ACAPS' own fields does not clear it either.

So the product has to argue something narrow and testable: *the regression sees four fields of metadata; the panel reads the actual sentence, and the sentence contains information the fields do not.* That is a good argument. It is not a result.

**With unlimited time, this is what closes it:**

| Phase | Duration | What it produces |
|---|---|---|
| Build | 4–6 weeks, 1–2 engineers | Ingest, gate, card, dispatch, dissent, scoring. |
| Backtest | 3 weeks | Run the panel on the 104 already-resolved risks. **This is the fastest possible answer and it should have been the first thing built** — and the baselines it must beat are now measured, not quoted. |
| Pilot | 6 months | Live elicitation on new statements, with a research partner. |
| Publication | 9 months | The first paired comparison of expert panel against a metadata model on humanitarian risk statements. |

**The backtest is the unlock.** 104 resolved risks already have outcomes. If the panel can be recruited to score them retrospectively, the question of whether it beats ACAPS' 0.2168 is answerable in weeks rather than a year — and it is answerable *before* anyone commits to a pilot. A full-fledged product would do this in month one.

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

> **A specified product built on a falsifiable hypothesis, with the backtest designed and not yet run.**

And if a juror asks whether it works, the answer is the one written into the blueprint:

> "We fitted the baseline rather than quoting one. A logistic regression on ACAPS' own structured fields scores 0.2177 out of sample; ACAPS' own analysts score 0.2168 on the same 104 risks. **The model loses.** Neither gap from the base rate is significant at n=104 — ACAPS' judgement is a real signal sitting just under this sample's noise floor. So the bar for any panel is ACAPS, not the regression, and our claim is specific: the model reads the fields, the panel reads the sentence, and the sentence contains what the fields do not. We can test that on 104 resolved risks in weeks, paired, with intervals."

That is a strong answer. It is not the same as a working product, and saying so is cheaper than being caught.
