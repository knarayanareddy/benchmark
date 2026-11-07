# Pre-registration protocol — DRAFT, not yet registered

**Status: draft.** This is the protocol to timestamp (for example on OSF) **before the first card opens**. Nothing below is a result. No panel has run. Items marked **[DECISION]** need a human owner.

**Amendment log** (the draft is not yet registered; once it is, changes are dated and appended here, never edited in place).
- *7 Nov 2026, draft (fifth entry).* Added situation timelines, panel series, a regional grid and analyst links (`docs/12-situation-evolution.md`). They are descriptive staff tools. A timeline shows ACAPS's own recorded history and reaches an expert only on a risk's full view, after its questions are resolved. Panel series are read-only and use closed panel rounds only, under the same floor of 5. Analyst links are judgements a moderator writes with a mechanism and a rival explanation; they are never inferred. None of this touches the primary endpoint, which is still the blind Round-1 estimate, and scoring is unchanged. The regional grid and the links are not used in any estimate.
- *7 Nov 2026, draft (fourth entry).* Added the pilot experience (`docs/10-pilot-experience.md`): an expert profile, a weekly Pulse that decides which open questions are pushed to whom, a read-only risk browser that hides a risk's analysis while a question on it is live, a staff dispatch preview, and a demo mode that is off by default. It changes nothing about the primary endpoint: the blind Round-1 estimate is still the only input, and scoring is unchanged. The weekly cap and the thin-circle-first rule change how many people are asked each card, not who may answer it; the default cap is for ACAPS to decide. Who may answer what is unchanged: the strict match on declared countries, themes and regions. Demo cards and the synthetic panel are flagged and excluded from the second-look summary, but they are **not yet** excluded from every analysis, so no analysis may run on a database that holds demo data.
- *7 Nov 2026, draft (third entry).* Added an optional moderated discussion between Round 1 and Round 2 (`docs/09-roundtable-and-credit.md`). It never touches the primary endpoint, which is the blind Round-1 estimate. It does influence Round 2, so every Round-2 analysis is stratified on whether the expert opened the thread (`sawThread`, recorded by the server) as well as on the second-look arm.
- *7 Nov 2026, draft (second entry).* Added the randomised second look as a secondary measurement in Round 2 only. It never touches the primary endpoint, never shows an ACAPS probability, and its content is locked when Round 1 closes.
- *7 Nov 2026, draft.* Primary endpoint changed from the pooled **Round-2** estimate to the pooled blind **Round-1** estimate, and rule R9 changed so no expert sees ACAPS's rating or a pre-filled number in Round 1. Reason: under the old design every expert started from ACAPS's own number, so the panel-versus-ACAPS comparison measured anchoring, not forecasting.

## Question

Does a moderated expert panel, answering ACAPS' own dated trigger statements, forecast better than ACAPS' own probability rating on the same items?

## Primary endpoint

Paired Brier difference, **panel minus ACAPS**, over the same resolved statements. Negative favours the panel.

- ACAPS reading: **band midpoints** (0.10 / 0.305 / 0.505 / 0.705 / 0.905). The ordinal reading (rating ÷ 5) is reported as a sensitivity check.
- Panel reading: the pooled **blind Round-1** estimate (`aggregate()` over Round-1 answers only, rules in `docs/02-scoring-rules.md`, R9). It is ledgered when Round 1 closes and cannot change afterwards. Nobody has seen ACAPS's rating, the panel result, or a pre-filled number when they give it.
- Interval: paired bootstrap, 10,000 resamples, seed 7 (`paired()` in `packages/core/src/scoring.js`). The interval is reported with every estimate. Significance means the interval excludes zero.

## Secondary endpoints

- **Round-2 pooled estimate versus ACAPS** (same paired method). Round 2 shows each expert the panel distribution and their own first answer, so it measures what social information does, not independent forecasting.
- **Revision effect:** Round-2 minus Round-1 Brier, and the direction of each revision relative to ACAPS's reading (toward or away).
- **Second-look arms** (`docs/08-second-look.md`): per arm, mean Round-2 minus Round-1 change and the change toward ACAPS's reading, among those who opened the background and among all. Descriptive; a cell with fewer than 5 pairs is not reported. Arms are assigned at random per expert per card and the background text is fixed before Round 1 opens.
- **Discussion exposure (cards with a thread):** Round-2 change split by `sawThread`, crossed with the second-look arm. Descriptive; a cell with fewer than 5 pairs is not reported. Posts are free text and are never scored.
- **Time per answer and completion in Round 1**, because blind answers are slower than adjusting a number. This is a cost of R9 and is measured, not assumed.

## Scope and exclusions

- Unit: the **28 Active risks** and the **76 dated triggers under them**: **104 statements** open today. The other 190 of the 266 triggers sit under risks whose outcome is already known, so scoring them would be hindsight.
- A statement the resolver marks `unobservable` is excluded, never scored as a miss. The count of exclusions is reported.
- A card that is rewritten or split after opening is retired; its estimates stay scored on the parent and the children start clean (rule R5).
- Forecasts are clamped to [0.01, 0.99] at submission.
- A risk ACAPS never rated has no ACAPS reading and cannot enter the paired comparison; it can still be asked and scored on its own.

## Fixed before a card opens (enforced by the service, not by promise)

`createCard()` refuses a card without: a window with real dates, a written objective, a resolution source from {ACLED, IPC, UNHCR, IMF, official decree}, and a named resolver. The objective is bound to the external source **at authoring, never at resolution** (rule R5). Resolution needs an https evidence link and is recorded in the audit log.

## Power, stated honestly

At the paired SD measured on the 104 historical risks (0.1605, `scripts/measure-baseline.mjs`):

| Reading | Paired SD | MDE at n=104 (80% power) | n to detect a 0.02 Brier gain |
|---|---|---|---|
| Band midpoint (headline) | 0.1605 | 0.0441 | **506** |
| Ordinal (sensitivity) | 0.1505 | 0.0413 | 445 |

At 104 open statements, 506 resolved statements need **about five cycles at best** unless ACAPS adds triggers to Active risks, and fewer statements will resolve than are issued. The historical SD is an estimate from a non-random, hindsight-labelled set, so it is a planning figure, not a guarantee. If the first cycle's SD differs, re-plan before looking at any outcome-linked result.

## Stopping rule **[DECISION]**

Proposed: analyse once, when **506 statements have resolved or five full cycles have closed, whichever is later**. No interim look at outcome-linked scores. Panel statistics already released by the privacy rules do not count as an interim look, because they contain no outcomes. Any change to this rule is dated and appended, not edited.

## Secondary analyses (descriptive, no claim of significance)

Calibration by band; Round 1 versus Round 2 movement; panel versus the logistic baseline (0.2177); contested-card behaviour; completion and dropout by domain.

## Known threats

- **Endogenous labels.** The historical labels were assigned by ACAPS' own analysts after the fact. The prospective design exists to remove this; it only works if objectives are bound to external sources at authoring.
- **Selection of statements.** ACAPS chooses which risks to publish. Results generalise to that set only.
- **Expert dropout.** The literature base rate is about 51%. **[DECISION]** who recruits, who is paid, and what happens to uncovered domains.
- **The discussion contaminates Round 2.** Experts who read it may move toward the loudest argument. That is the point of the Delphi step, and it is why it is secondary and stratified. A thread also lets typing style identify people in a small circle; moderators read every post and numbers are refused, which reduces this and does not remove it.
- **Anonymous experts are pulled, not pushed**, so they may answer Round 2 less often. Report Round-2 completion by anonymity level.

## Before the first card opens

- [ ] Protocol timestamped publicly.
- [ ] Resolver named per cohort, with a deputy. **[DECISION]**
- [ ] DPIA and data-sharing agreement with ACAPS signed. **[DECISION]**
- [ ] Consent text reviewed by counsel (`packages/service/src/consent.js`).
