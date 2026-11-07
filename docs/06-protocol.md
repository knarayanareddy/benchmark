# Pre-registration protocol — DRAFT, not yet registered

**Status: draft.** This is the protocol to timestamp (for example on OSF) **before the first card opens**. Nothing below is a result. No panel has run. Items marked **[DECISION]** need a human owner.

## Question

Does a moderated expert panel, answering ACAPS' own dated trigger statements, forecast better than ACAPS' own probability rating on the same items?

## Primary endpoint

Paired Brier difference, **panel minus ACAPS**, over the same resolved statements. Negative favours the panel.

- ACAPS reading: **band midpoints** (0.10 / 0.305 / 0.505 / 0.705 / 0.905). The ordinal reading (rating ÷ 5) is reported as a sensitivity check.
- Panel reading: the pooled Round-2 estimate (`aggregate()`, rules in `docs/02-scoring-rules.md`), released at round close.
- Interval: paired bootstrap, 10,000 resamples, seed 7 (`paired()` in `packages/core/src/scoring.js`). The interval is reported with every estimate. Significance means the interval excludes zero.

## Scope and exclusions

- Unit: dated trigger statements under the **28 Active risks**, about **266 per export cycle**.
- A statement the resolver marks `unobservable` is excluded, never scored as a miss. The count of exclusions is reported.
- A card that is rewritten or split after opening is retired; its estimates stay scored on the parent and the children start clean (rule R5).
- Forecasts are clamped to [0.01, 0.99] at submission.

## Fixed before a card opens (enforced by the service, not by promise)

`createCard()` refuses a card without: a window with real dates, a written objective, a resolution source from {ACLED, IPC, UNHCR, IMF, official decree}, and a named resolver. The objective is bound to the external source **at authoring, never at resolution** (rule R5). Resolution needs an https evidence link and is recorded in the audit log.

## Power, stated honestly

At the paired SD measured on the 104 historical risks (0.1605, `scripts/measure-baseline.mjs`):

| Reading | Paired SD | MDE at n=104 (80% power) | n to detect a 0.02 Brier gain |
|---|---|---|---|
| Band midpoint (headline) | 0.1605 | 0.0441 | **506** |
| Ordinal (sensitivity) | 0.1505 | 0.0413 | 445 |

At about 266 statements per cycle, 506 resolved statements need **two cycles at best**, and fewer statements will resolve than are issued. The historical SD is an estimate from a non-random, hindsight-labelled set, so it is a planning figure, not a guarantee. If the first cycle's SD differs, re-plan before looking at any outcome-linked result.

## Stopping rule **[DECISION]**

Proposed: analyse once, when **506 statements have resolved or two full cycles have closed, whichever is later**. No interim look at outcome-linked scores. Panel statistics already released by the privacy rules do not count as an interim look, because they contain no outcomes. Any change to this rule is dated and appended, not edited.

## Secondary analyses (descriptive, no claim of significance)

Calibration by band; Round 1 versus Round 2 movement; panel versus the logistic baseline (0.2177); contested-card behaviour; completion and dropout by domain.

## Known threats

- **Endogenous labels.** The historical labels were assigned by ACAPS' own analysts after the fact. The prospective design exists to remove this; it only works if objectives are bound to external sources at authoring.
- **Selection of statements.** ACAPS chooses which risks to publish. Results generalise to that set only.
- **Expert dropout.** The literature base rate is about 51%. **[DECISION]** who recruits, who is paid, and what happens to uncovered domains.
- **Anonymous experts are pulled, not pushed**, so they may answer Round 2 less often. Report Round-2 completion by anonymity level.

## Before the first card opens

- [ ] Protocol timestamped publicly.
- [ ] Resolver named per cohort, with a deputy. **[DECISION]**
- [ ] DPIA and data-sharing agreement with ACAPS signed. **[DECISION]**
- [ ] Consent text reviewed by counsel (`packages/service/src/consent.js`).
