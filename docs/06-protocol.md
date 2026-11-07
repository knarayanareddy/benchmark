# Pre-registration protocol — DRAFT, not yet registered

**Status: draft.** This is the protocol to timestamp (for example on OSF) **before the first card opens**. Nothing below is a result. No panel has run. Items marked **[DECISION]** need a human owner.

**Amendment log** (the draft is not yet registered; once it is, changes are dated and appended here, never edited in place).
- *7 Nov 2026, draft (sixth entry).* Correction and a change of data basis. (1) The 104 open statements are the 28 Active risks and the 76 triggers under them. Only the 28 risks carry an ACAPS probability, so the head-to-head sample is the risk-level cards, not 104. Triggers have no ACAPS probability of their own. (2) The paired SD of 0.1605 was measured on ACAPS minus a constant base-rate forecast, not on panel minus ACAPS. The power figures that depended on it are withdrawn, the Power section is rewritten, and the primary endpoint is a [DECISION]. (3) ACAPS has told the project, informally and not in writing, that it cannot share trigger-level data: its records are in Airtable and that data is not shared. It has asked us to create synthetic datasets and make the judgement calls ourselves. So the protocol does not depend on ACAPS-held data. It is registered on the Risk Radar export we hold (`data/risk-radar-export.csv`), plus our own cards. Each card is resolved by a public source and a named resolver fixed at authoring. ACAPS trigger statuses, rating history and resolution dates are not assumed. Told to the project, not yet confirmed in writing by ACAPS: a risk's probability is a human judgement, and the weighting of triggers is not linear (no formula). The draft is not yet registered, so this entry records the correction and the body is edited in place.
- *7 Nov 2026, draft (fifth entry).* Added situation timelines, panel series, a regional grid and analyst links (`docs/12-situation-evolution.md`). They are descriptive staff tools. A timeline shows ACAPS's own recorded history and reaches an expert only on a risk's full view, after its questions are resolved. Panel series are read-only and use closed panel rounds only, under the same floor of 5. Analyst links are judgements a moderator writes with a mechanism and a rival explanation; they are never inferred. None of this touches the primary endpoint, which is still the blind Round-1 estimate, and scoring is unchanged. The regional grid and the links are not used in any estimate.
- *7 Nov 2026, draft (fourth entry).* Added the pilot experience (`docs/10-pilot-experience.md`): an expert profile, a weekly Pulse that decides which open questions are pushed to whom, a read-only risk browser that hides a risk's analysis while a question on it is live, a staff dispatch preview, and a demo mode that is off by default. It changes nothing about the primary endpoint: the blind Round-1 estimate is still the only input, and scoring is unchanged. The weekly cap and the thin-circle-first rule change how many people are asked each card, not who may answer it; the default cap is for ACAPS to decide. Who may answer what is unchanged: the strict match on declared countries, themes and regions. Demo cards and the synthetic panel are flagged and excluded from the second-look summary, but they are **not yet** excluded from every analysis, so no analysis may run on a database that holds demo data.
- *7 Nov 2026, draft (third entry).* Added an optional moderated discussion between Round 1 and Round 2 (`docs/09-roundtable-and-credit.md`). It never touches the primary endpoint, which is the blind Round-1 estimate. It does influence Round 2, so every Round-2 analysis is stratified on whether the expert opened the thread (`sawThread`, recorded by the server) as well as on the second-look arm.
- *7 Nov 2026, draft (second entry).* Added the randomised second look as a secondary measurement in Round 2 only. It never touches the primary endpoint, never shows an ACAPS probability, and its content is locked when Round 1 closes.
- *7 Nov 2026, draft.* Primary endpoint changed from the pooled **Round-2** estimate to the pooled blind **Round-1** estimate, and rule R9 changed so no expert sees ACAPS's rating or a pre-filled number in Round 1. Reason: under the old design every expert started from ACAPS's own number, so the panel-versus-ACAPS comparison measured anchoring, not forecasting.

## Question

Does a moderated expert panel, answering dated trigger statements from the Risk Radar export and our own resolvable cards, forecast better than ACAPS' own probability rating on the same risks? Trigger statements have no ACAPS probability of their own, so ACAPS' rating is compared only at risk level.

## Primary endpoint

Paired Brier difference, **panel minus ACAPS**, over the same resolved risks, the only items ACAPS rated (see the [DECISION] under Power). Negative favours the panel.

- ACAPS reading: **band midpoints** (0.10 / 0.305 / 0.505 / 0.705 / 0.905), from the risk's probability field in the export we hold. The ordinal reading (rating ÷ 5) is reported as a sensitivity check.
- Panel reading: the pooled **blind Round-1** estimate (`aggregate()` over Round-1 answers only, rules in `docs/02-scoring-rules.md`, R9). It is ledgered when Round 1 closes and cannot change afterwards. Nobody has seen ACAPS's rating, the panel result, or a pre-filled number when they give it.
- Interval: paired bootstrap, 10,000 resamples, seed 7 (`paired()` in `packages/core/src/scoring.js`). The interval is reported with every estimate. Significance means the interval excludes zero.

## Secondary endpoints

- **Round-2 pooled estimate versus ACAPS** (same paired method). Round 2 shows each expert the panel distribution and their own first answer, so it measures what social information does, not independent forecasting.
- **Revision effect:** Round-2 minus Round-1 Brier, and the direction of each revision relative to ACAPS's reading (toward or away).
- **Second-look arms** (`docs/08-second-look.md`): per arm, mean Round-2 minus Round-1 change and the change toward ACAPS's reading, among those who opened the background and among all. Descriptive; a cell with fewer than 5 pairs is not reported. Arms are assigned at random per expert per card and the background text is fixed before Round 1 opens.
- **Discussion exposure (cards with a thread):** Round-2 change split by `sawThread`, crossed with the second-look arm. Descriptive; a cell with fewer than 5 pairs is not reported. Posts are free text and are never scored.
- **Time per answer and completion in Round 1**, because blind answers are slower than adjusting a number. This is a cost of R9 and is measured, not assumed.

## Scope and exclusions

- Unit: the **28 Active risks** and the **76 dated triggers under them**: **104 statements** open today. Only the 28 risks carry an ACAPS rating; the 76 triggers have none of their own. The other 190 of the 266 triggers sit under risks whose outcome is already known, so scoring them would be hindsight.
- Trigger cards are resolved by a public source named at authoring (ACLED, IPC, UNHCR, IMF or an official decree) and a named resolver. They are never resolved by an ACAPS trigger status, because the export holds none.
- A statement the resolver marks `unobservable` is excluded, never scored as a miss. The count of exclusions is reported.
- A card that is rewritten or split after opening is retired; its estimates stay scored on the parent and the children start clean (rule R5).
- Forecasts are clamped to [0.01, 0.99] at submission.
- A risk ACAPS never rated has no ACAPS reading and cannot enter the paired comparison; it can still be asked and scored on its own.

## Fixed before a card opens (enforced by the service, not by promise)

`createCard()` refuses a card without: a window with real dates, a written objective, a resolution source from {ACLED, IPC, UNHCR, IMF, official decree}, and a named resolver. The objective is bound to the external source **at authoring, never at resolution** (rule R5). Resolution needs an https evidence link and is recorded in the audit log.

## Power, stated honestly

The paired SD used in earlier drafts (0.1605) is **not** the SD of panel minus ACAPS. Measured read-only on 7 Nov 2026 from `data/risk-radar.json`: on the 104 resolved risks, with ACAPS band midpoints (the 5 unrated risks at the base rate of 0.5865), the SD of (ACAPS minus a constant base-rate Brier) is 0.1605, with mean −0.0255. The ordinal reading gives 0.1505. The endpoint's SD, (panel minus ACAPS), cannot be measured until a panel has answered.

| Figure | Source | Value |
|---|---|---|
| SD of ACAPS minus base rate, midpoint reading | measured now, 104 resolved risks | 0.1605 |
| MDE at n = 104, 80% power, on that SD | measured SD, z = 2.80 | 0.0441 |
| Cards for a 0.02 gain, on that SD | measured SD | 506 |
| SD of panel minus ACAPS, per card | planner's prototype, not measured (no panel has run) | 0.155 to 0.19 |
| MDE at 28 risk cards, 80% power | my arithmetic: 2.80 × SD ÷ √28, same SD range | 0.082 to 0.101 |
| Cards for a 0.02 gain on the endpoint SD | planner's prototype figures (442 at SD 0.15, 686 at SD 0.187) | about 440 to 690 |

The planner's own figures do not match each other: an SD range of 0.155 to 0.19 gives about 470 to 710 cards by my arithmetic. The planner's full power specification is in progress as `docs/14` and is not yet written. The prototype figures are estimates, not measurements.

Plainly: **the panel-beats-ACAPS comparison is not detectable with about 28 risk-level cards.** With the planner's prototype SD, a true gain of 0.05 has a power of about 0.3 to 0.4 at 28 cards (my normal approximation). The 104 open statements are 28 risks and 76 triggers, and the head-to-head can only use the 28 risks. If the first cycle's real SD differs from the prototype, re-plan before looking at any outcome-linked result.

**[DECISION] Which endpoint is primary.** The head-to-head on 28 risk cards cannot detect a plausible gain (above). ACAPS has also told the project, not yet confirmed in writing by ACAPS, that a risk's probability is a human judgement and that trigger weighting is not linear. So ACAPS's rating cannot be rebuilt from its triggers, and there is no trigger-level ACAPS comparator. Options:

- **(A)** Keep the head-to-head (panel minus ACAPS, risk-level cards) as a **descriptive** comparison, reported with its wide interval and with no claim of significance.
- **(B)** Make the **primary endpoint** the panel's absolute accuracy against outcomes across all resolvable cards, including trigger cards: Brier skill against the base rate (a constant forecast), and calibration. The ACAPS comparison becomes secondary.
- **(C)** Both, pre-registered: (B) as primary, (A) as descriptive.

**Recommendation: (C).** (A) alone cannot answer the question the protocol asks at 28 cards, so it must be reported as descriptive. (B) alone drops the ACAPS comparison altogether. (C) keeps the comparison and labels it honestly, and makes the primary claim one the data can support. Caveats for (B): the base rate of prospective cards is unknown (the planner expects about 0.69 from the Active band mix, against 0.587 historically; this is the planner's inference, not a measurement); each trigger card needs a resolution source and date, which the authoring gate already requires; and the endpoint and its base rate must be fixed before any card opens. The owner decides. This is not a choice the drafter makes.

## Stopping rule **[DECISION]**

The 506 figure above was computed from the ACAPS-minus-base-rate SD. It is not a valid target for the panel comparison, so it is withdrawn until the endpoint is chosen in the [DECISION] above.

Proposed: analyse once, when the statement count fixed under the endpoint decision has **resolved, or five full cycles have closed, whichever is later**. No interim look at outcome-linked scores. Panel statistics already released by the privacy rules do not count as an interim look, because they contain no outcomes. Any change to this rule is dated and appended, not edited.

## Secondary analyses (descriptive, no claim of significance)

Calibration by band; Round 1 versus Round 2 movement; panel versus the logistic baseline (0.2177); contested-card behaviour; completion and dropout by domain.

## Known threats

- **Endogenous labels.** The historical labels were assigned by ACAPS' own analysts after the fact. ACAPS holds the trigger records and cannot share them (told to the project, not yet confirmed in writing by ACAPS), so the labels cannot be audited from our side. The prospective design exists to remove this; it only works if objectives are bound to external sources at authoring.
- **Selection of statements.** ACAPS chooses which risks to publish. Results generalise to that set only.
- **Expert dropout.** The literature base rate is about 51%. **[DECISION]** who recruits, who is paid, and what happens to uncovered domains.
- **The discussion contaminates Round 2.** Experts who read it may move toward the loudest argument. That is the point of the Delphi step, and it is why it is secondary and stratified. A thread also lets typing style identify people in a small circle; moderators read every post and numbers are refused, which reduces this and does not remove it.
- **Anonymous experts are pulled, not pushed**, so they may answer Round 2 less often. Report Round-2 completion by anonymity level.

## Before the first card opens

- [ ] Protocol timestamped publicly.
- [ ] Protocol registered on the Risk Radar export we hold, with the export file's hash recorded.
- [ ] Judgement-call register (`docs/15`, in progress) published, with ACAPS's review and veto window stated.
- [ ] Resolver named per cohort, with a deputy. **[DECISION]**
- [ ] DPIA and data-sharing agreement with ACAPS signed. **[DECISION]**
- [ ] Consent text reviewed by counsel (`packages/service/src/consent.js`).
