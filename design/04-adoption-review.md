# Adoption review — ACAPS

**What ACAPS already does better than us, and what we should take.**

Reviewed against the ACAPS methodology library — the *Analysis workflow* poster (v2.0) and the *Cognitive biases* technical brief — plus a fresh pass over the structured-expert-judgement literature to check whether anyone has already beaten the panel design.

**Verdict: five additions, one correction to our own design, and one refusal.** Nothing here replaces Benchmark. Two of the five make it materially better, and one of them is the strongest single idea in either product.

---

## Part 1 · What ACAPS' own methodology tells us

### What the methodology page actually contains

The landing page lists resources rather than describing a method. The substance is in five documents:

| Document | What it is | Relevance to Benchmark |
|---|---|---|
| **Analysis workflow** (poster v2.0) | A five-phase analytic process with six analytic modes and five transversal activities | **High.** Benchmark instruments one specific step: *3.5 Anticipate*. |
| **Cognitive biases** (technical brief, 2016) | A taxonomy of selection, social and process biases with mitigation strategies | **High.** Our interface is largely a bias-mitigation device and should say so. |
| **Scenario-building** | How to construct alternative futures | Medium. Relevant to A1 below. |
| **Data cleaning** · **Secondary Data Review** | Guidance for analysts | Low. Upstream of us. |
| **Power BI / Tableau training guides** | Tooling | Low, but tells you something: **ACAPS' analysts live in Power BI and Tableau.** |

### The one sentence that reframes the pitch

The workflow's analytic modes are: **Explore → Describe → Explain → Interpret → Anticipate → Prescribe.** Anticipate is defined as *"identifying the likelihood of future outcomes and trends at a specific time,"* combining **predictions** (one-off estimates of a specific event) and **forecasts** (sets of possible futures that include probability estimates).

And it specifies exactly three activities:

> **30.** Extend current conditions to forecast future outcomes
> **31.** Examine and develop alternative futures
> **32.** **Identify triggers and track new developments**

Benchmark currently does 30 and ignores 31 and 32. **The response to a card is supposed to be a set of scenarios plus a list of indicators to monitor** — that is what ACAPS' own doctrine says the output of anticipatory analysis is. We produce a number and stop.

---

## Part 2 · Doorway — but first, the correction to our own ACAPS design

Putting this first because it is the most consequential item in this document and it corrects advice I gave you two messages ago.

### The seed-variable question, and why "weight by track record" was too simple

I told you: *self-declared expertise is an onboarding mechanism, not a weighting mechanism; weight by realised track record instead.* That was right in direction and incomplete in method, because there is a validated way to do exactly that and it has a documented failure mode.

**The method that exists** is Cooke's **Classical Model** (Delft, 1991; 45 studies in the TU Delft database; 33 applications 2006–2015). Experts answer **seed questions** — items from their own field with known answers — alongside the target questions. Each expert's weight is derived from two scores:

- **Calibration** — the p-value of the null hypothesis that their probability statements are statistically accurate. High p-value = well calibrated.
- **Information** — Shannon relative information against a background measure. High information = a sharp, not a hedged, distribution.

Weight = calibration p-value × informativeness, with a p-value threshold below which an expert gets zero weight. Then a **performance-weighted linear pool**.

**Why this matters:** the seed variables are *answered before the target is known*, so nobody can game them. It is a real, auditable, mechanical version of "weight by track record" — and it solves the self-declaration trap by data rather than assertion.

**The documented failure mode, which is why this is not a straight adoption.** The out-of-sample evidence is genuinely mixed:

- In-sample, performance weighting beat the equal-weight pool and the best expert in **27 of 45** studies.
- But Clemen's re-analysis found performance weighting beat equal weights in only **9 of 14** studies — not statistically significant.
- Eggstaff et al. (2014, *RESS*) ran cross-validation and found: **"Performance weighting incurs an 'out-of-sample penalty' and its statistical accuracy out-of-sample is lower than that of equal weighting."** Their conclusion: the method *"no longer dominantly outperforms the equal weight linear opinion pool."*
- Clemen's suggested safe threshold: **more than ten seed variables.** Below that, the weights are estimated from too little data to beat a flat average — and performance weighting on thin data is worse than equal weighting, because noisy weights overfit.
- And: equal weights may be preferable **when dependence between experts is high** — which in a small humanitarian expert community, it certainly is.

### THE CORRECTED RULE — replaces §09 of the blueprint

> **Use seed variables to measure. Use them to weight only where there are enough of them.**
>
> - Each expert answers **6–10 seed questions** drawn from *already-resolved* ACAPS risks in their declared domain, at onboarding and refreshed quarterly. Answers are known, so this is immediately scoreable.
> - **Where a domain has ≥ 10 resolved seed items:** performance-weight that expert's estimates in that domain, using calibration × informativeness.
> - **Where a domain has < 10:** **equal weights.** Do not performance-weight on thin data — the literature says it underperforms a flat average out of sample.
> - **Declared expertise remains onboarding only.** The Declaration decides who is *asked*. The seed score decides *whether they are weighted*. Neither is self-assessment.
> - Show every expert their own seed score and calibration curve. That is the retention loop from §09, now with a number attached.

**Cost:** 1.5 days. **What it buys:** the strongest methodological claim available to us — *"we weight experts by demonstrated calibration on questions whose answers they did not know, and we refuse to weight them where we do not have enough of those questions."* That second clause is the part that makes it credible, because it shows we read past the headline result.

**One thing this fixes that the seed mechanism does not:** the loop-closing notification. Cooke's model has no dissent channel and no return path. Keep ours.

---

## Part 3 · Five adoptions for Benchmark

### A1 · Indicators and triggers — the biggest win

**ACAPS does this. We don't.** Workflow activity 32 is *"identify triggers and track new developments,"* and the stated deliverable at the end of the anticipatory phase is **"a list of indicators to monitor whether these alternative futures are unfolding."**

**Adopt:** every card at ingest carries **2–4 observable indicators** with a direction that would move the probability. When an indicator changes, the card re-enters the expert's queue as a *re-estimate* with the change shown, not as a new question.

| | Before | After |
|---|---|---|
| The product | A poll | **A monitoring instrument** |
| Why an expert returns | Because they were notified | Because **the world moved** and they want to say so |
| What the analyst gets | A number | A number, the indicators behind it, and the reasons it changed |

**Why it is additive rather than decorative:** it converts the weakest part of the current design — that a ninety-second estimate is a one-off with no reason to revisit it — into a reason to return. It also makes the estimate defensible after the fact: an analyst can see *why* a number moved.

**Cost:** 3 hours plus a field on the card. **Adopt.**

### A2 · Scenario sets alongside predictions

**ACAPS does this.** Predictions alone is only half of Anticipate; forecasts are *"sets of possible futures."*

**Adopt, optionally per card:** a three-way split — most likely / plausible downside / plausible upside — with probabilities summing to 1. Scored as a separate Brier over the scenario set, not merged into the headline. Only for statements where a binary is a distortion.

**Cost:** 4 hours. **Adopt for a few cards rather than all.** A binary is the right instrument most of the time, and forcing three scenarios onto every statement is exactly the kind of methodological overreach that loses credibility.

### A3 · The key assumptions checklist

**ACAPS does this.** The stated deliverable at the end of *3.2 Describe* is a **"key assumptions checklist to challenge assertions and identify faulty logic, weak evidence or flawed analysis"**, and at *3.4 Interpret* an **"updated key assumption list."**

**Adopt:** three checkboxes on every card — *the window is realistic · the indicator is observable · this is one risk and not two* — which is our existing gate, surfaced to the expert as an ACAPS-shaped artefact rather than hidden in the analyst's queue.

**Why:** it costs nothing, it uses ACAPS' own vocabulary, and it lets the expert catch a bad statement that the mechanical gate passed. The gate is deterministic; a human reading the sentence is not.

**Cost:** 1 hour. **Adopt.**

### A4 · Cognitive-bias mitigation, stated as design rationale

**ACAPS has this as a named technical brief** with a taxonomy: anchoring, availability cascade, confirmation, evidence acceptance, salience; social bias; clustering illusion, framing, hindsight, impact.

Benchmark's interface already mitigates several by accident:

| Bias | Our existing design choice |
|---|---|
| **Anchoring** | No peers' numbers before submission; the model baseline is shown deliberately *as* an anchor we choose rather than one the interface creates |
| **Confirmation / evidence acceptance** | The statement is decontaminated of outcome-leaking language before the expert sees it |
| **Social bias / consensus** | Round two shows the distribution, never who said what |
| **Impact bias** | No visibility of the resulting media coverage or response decision |

**Adopt the framing, not new features:** a short `docs/04-bias-map.md` mapping each of our design choices to a named bias from ACAPS' own brief. It costs an hour and it turns a set of interface decisions into a demonstration that we read the organisation's method.

But adopt ACAPS' *epistemic humility* too, because it is wiser than the usual framing: the brief says **"biases are normal processes designed to make decisions quickly… there is no magical solution to overcome these reflexes."** So the interface should **make the bias visible, not claim to remove it** — which is exactly the right reason to show the base rate and the model baseline: not because it de-biases anyone, but because it makes the anchor explicit and arguable.

**Cost:** 1 hour of writing. **Adopt.**

### A5 · Where the numbers land — Power BI and Tableau

**ACAPS' analysts use these.** They ship training guides for both. That is where the analysis actually lives, and our output currently lands nowhere.

**Adopt:** don't build a competing dashboard for the analyst. Emit a **CSV/JSON feed keyed to the statement ID**, structured for Power BI and Tableau, and let the number appear where the analyst already works. Keep our own desk as the analyst *decision* surface for dissent and gating — that part is genuinely new and has no home in their stack.

**Cost:** 2 hours. **Adopt.** It also removes a whole class of "who maintains the dashboard" questions from the full-fledged-product problem.

---

## Part 4 · What we keep, and the one thing we refuse

### Keep, because ACAPS' own doctrine supports it

| Our choice | ACAPS support |
|---|---|
| **Intervals on every number** | Workflow activity 38: *"communicate uncertainty and document data and methods."* The brief also requires a stated **"limit of knowledge."** Our bootstrap interval is a machine-readable version of exactly that. |
| **The gate before elicitation** | *"Evaluate & validate"* is a transversal activity, not a step. Our gate runs continuously. |
| **The dissent channel** | Nothing in ACAPS' method closes the loop from a dissenting expert back to the statement. **This stays our single most defensible claim.** |
| **No public leaderboard** | Confirms ACAPS' social-bias warning. A leaderboard manufactures the consensus pressure the brief tells analysts to resist. |

### Reject: don't encode the whole workflow

The Analysis workflow is a **human process poster** for analysts, not a software specification. Benchmark is one instrument inside step 3.5. Trying to build steps 1–5 into a product would be a six-month scope error and would produce a tool that does nothing well.

**The correct framing for the pitch:** *"We instrument step 3.5 of your own workflow, and we output the thing that step is supposed to produce — which currently nobody produces."* That is more credible than any claim to improve ACAPS' analysis.

---

## Part 5 · What this changes, in short

| # | Change | Type | Cost | Trajectory |
|---|---|---|---|---|
| 1 | Seed variables; performance weighting only where ≥10 seed items | **Correction to our design** | 1.5 d | ★★★ |
| 2 | Indicator / trigger field with re-estimate prompts | **Adoption from ACAPS** | 3 h | ★★★ |
| 3 | Scenario sets, optional per card | Adoption from ACAPS | 4 h | ★★ |
| 4 | Key assumptions checklist on the card | Adoption from ACAPS | 1 h | ★★ |
| 5 | Bias map document | Adoption, framing | 1 h | ★ |
| 6 | Feed to Power BI / Tableau instead of a rival dashboard | Adoption, distribution | 2 h | ★★ |
| 7 | Do not encode the full workflow | Refusal | 0 | — |

**Two of these (#1 and #2) are worth more than everything else in this document combined.** #1 because it makes our methodological claim real rather than rhetorical. #2 because it gives the product a reason to exist after the first estimate — and it is ACAPS' own stated requirement, not our invention.

---

*Sources: ACAPS Analysis workflow poster v2.0; ACAPS Cognitive biases technical brief (March 2016); ACAPS methodology library index. Cooke (1991); Cooke & Goossens, TU Delft expert judgment database (45 studies); Colson & Cooke (2018) REED; Clemen re-analysis (9/14); Eggstaff, Mazzuchi & Sarkani (2014), Reliability Engineering & System Safety — cross-validation and the out-of-sample penalty; Lin & Huang on seed-variable count.*
