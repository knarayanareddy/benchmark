# ACAPS analysis workflow poster: how the repo maps to it

**Status: a read-only mapping written from the repo as it stands on 7 Nov 2026 (uncommitted working tree). Nothing was run: no tests, no servers, no scripts. Every repo claim below comes from a file that was opened; anything not checked is marked.**

**Source:** ACAPS "Analysis workflow", poster Version 2.0, read from `/Users/brightech/Downloads/acaps_analysis_workflow_poster.pdf` (the text layer was readable, so no page images were rendered). Step numbers (1 to 40) are the poster's own.

---

## Summary in plain language

- The poster describes a 5-part cycle: **Design, Acquire, Analyse (Explore, Describe, Explain, Interpret, Anticipate, Prescribe), Communicate**, with five habits that run through all of it.
- The repo covers a **narrow slice** of this: a forecasting panel for risk statements, plus staff tools to look at a risk's history, the panel over time, and links between questions.
- **Forecasting** fits mainly in the **Anticipate** step. A forecast "card" (question, blind Round 1 estimate, Round 2 revision, resolution) is built. What is **missing** is the step where a resolved card is scored against what happened, and any screen that shows it.
- **Situation evolution** exists as **recorded history**: dated completion and trend lines, dated rationale notes, and per-round panel results. It does not compute change over time, and it cannot show rating history, which ACAPS has said it cannot share.
- **Correlation between questions** is **not built** in the app. The repo has analyst-written links (with a stated mechanism and a rival explanation) and a simulation that estimates how many resolved questions a correlation test would need. Correlation is never inferred automatically, and the repo does not claim causation.
- **Two things need an owner decision** before anyone relies on the docs: Round 2 shows ACAPS's percentage by default in the code, which the scoring rules say it should not (section "Conflicts found"); and the docs say no simulation is in the repo, while `packages/simulate` is present but untracked.

---

## Poster step → what the repo has

Status key: **built** (working and tested in the repo), **partly** (some of the step exists), **planned** (written as a plan only), **missing** (no trace in the repo).

| Poster step | What the poster says | Built in repo (file / section) | Status |
|---|---|---|---|
| 1 Design (1 to 9) | Terms of reference, a methodology, data needs, planned outputs | `docs/02-scoring-rules.md` (rules R1 to R10); `docs/06-protocol.md` (draft pre-registration; primary endpoint still marked `[DECISION]`, lines 18–23 and 64); `docs/03-the-gap-to-real.md`; `BUILD.md` | **partly**: methodology written; protocol not registered; no written terms of reference in the repo |
| 2 Acquire, secondary data (10 to 11) | Review secondary data; find information gaps | `data/risk-radar-export.csv` (139 risks, 266 triggers); `scripts/ingest.py` → `data/risk-radar.json`; `docs/11-questions-for-acaps.md` (the gap list) | **partly**: one export only; ACAPS history and dates are not shared (told to the project, not confirmed in writing) |
| 2 Acquire, primary data (12 to 13) | Collect unbiased data; store it | Answer store and dated estimates: `service.js submitEstimate` (line 403); separate roster and answers stores (`docs/05`, guarantee table) | **built** for the store; **not run** with a real panel (`docs/00`, line 7) |
| 2 "Survey of surveys" | A log of needs assessments | none | **missing** |
| 3.1 Explore (14 to 18) | Check data quality; clean it; keep a change log; list gaps | `scripts/ingest.py` (parses dates and history); authoring gate `core/src/authoring.js validateCardInput` (line 91); `core/src/gate.js gate()` (line 136); audit log `service.js audit` (line 131) | **partly**: no per-field confidence levels on the data; audit log covers staff actions only |
| 3.2 Describe (19 to 21) | Group data; summarise per category; compare | `core/src/grid.js buildGrid` (line 25, counts per region × theme, cells under 10 marked); `core/src/series.js buildSeries` (line 22); `core/src/timeline.js buildTimeline` (line 100); `core/src/aggregate.js releaseAggregate` (line 797) | **built** for counts and per-card panel results; no statistical summary per group |
| 3.3 Explain (22 to 25), links | Look for association; link effects to causes; rival explanations | `core/src/links.js validateLink` (line 19: mechanism and rival both required, 20 to 500 characters); `downstream` (line 81) and `upstream` (line 91); `service/src/evolution.js createLink` (line 69) | **partly**: links built, analyst-written only; correlation statistics not in the app |
| 3.3 Explain (22), correlation | Connect the dots; test association | Simulation only: `packages/simulate/src/crosscorr.js` (`fisherN` line 57, `impliedComparisons` line 87, `simulateCorrPower` line 236) | **planned** in the product; **partly** in the simulation (untracked, see below) |
| 3.4 Interpret (26 to 29) | Rate severity; evaluate evidence strength; draw conclusions; list assumptions | Scoring primitives: `core/src/scoring.js` (`brierItem` line 114, `bootstrapBrier` line 146, `paired` line 171, `calibration` line 226); assumptions register `docs/15-judgement-calls.md` (simulation only) | **partly**: primitives exist but nothing in the service calls them (see Q4, item 1) |
| 3.5 Anticipate, forecast card (30) | Extend current conditions to forecast outcomes | Card creation: `service.js createCard` (line 325; ACAPS band kept for scoring, line 336); card screen `packages/web/src/staff/Cards.jsx` | **built** |
| 3.5 Anticipate, Round 1 estimate (30) | A blind, independent estimate | `service.js submitEstimate` (line 403; round 1 has no check on ACAPS); expert card `packages/web/src/expert/CardView.jsx` (line 101 "Round 1 is blind"; line 206 blind notice); R9 in `docs/02` (lines 47 to 58) | **built**, tested (`packages/service/test/blind-round1.test.js`, 19 tests per `BUILD.md` line 39) |
| 3.5 Anticipate, Round 2 revision (31) | Revise after seeing the distribution | `service.js openRound2` (line 373, only after Round 1 closes); round 2 check in `submitEstimate` (lines 414 to 416); `core/src/aggregate.js deduplicateRounds` (line 267); second look `core/src/secondlook.js` | **built**, with a rule conflict on ACAPS's reading (see Conflicts) |
| 3.5 Anticipate, resolution (32) | Track developments; decide the outcome | `service.js resolveCard` (line 383; needs an https evidence link); staff "Record outcome" in `Cards.jsx` (lines 91 to 104) | **built** (recording only) |
| 3.5 Anticipate, scoring | Forecasts scored against outcomes | Scored only from the export, by scripts: `scripts/backtest.mjs`, `scripts/measure-baseline.mjs`, `npm run ladder`. No service route scores a card. | **missing** in the product |
| 3.5 Anticipate, scenarios (31) | Alternative futures, each with a likelihood | none (one probability per card only) | **missing** |
| 3.5 Anticipate, triggers and indicators (32) | Watch triggers; list indicators to watch | Trigger history (completion and trend) shown in `packages/web/src/components/Timeline.jsx` and `StepChart.jsx`; read-only from the export | **partly**: shows recorded history only; no live tracking or alerts |
| 3.6 Prescribe (33 to 35) | Link problem, strategy and response; weigh options | none | **missing**; outside the benchmark's scope as written (ask the owner before building) |
| 4 Communicate (36 to 40) | Clear products; show uncertainty; document methods; disseminate | Intervals on every panel result (`docs/00`, principle 2); `packages/simulate/out/.../SYNTHETIC-report.md` (labelled "SYNTHETIC"); `docs/` set; public credit flow `core/src/publication.js` | **partly**: intervals and labels done; no staff synthesis of reasons (`docs/05`, line 103) |
| 5 Throughout (transversal) | Audit trail; validate evidence; feedback loops | Audit log `service.js audit` and `answers.audit` (`docs/05`); `npm run verify` (`package.json` line 15); versioned cards (`version` field) | **partly**: audit trail is good; no written feedback loop for analysts |

---

## Question 1: where forecasting fits in the poster's workflow

The poster has **no step for a revision round (Delphi-style)**. It is a forecasting method the repo added. Closest poster slots: Round 1 at 3.5 activity 30, Round 2 at 3.5 activity 31 (the poster's "alternative futures") with 3.3 activity 25 (rival explanations) as a second fit. A forecast card plugs in as follows:

| Forecast card part | Where in the poster | What we built (file, function) | Gap |
|---|---|---|---|
| Question (statement, window, objective, source, resolver) | 1.5 and 1.6 (break the issue down; choose data); 3.1 activity 18 (assertions) | `service.js createCard` (line 325); `core/src/authoring.js validateCardInput` (line 91); `core/src/gate.js gate()` (line 136) | none material |
| Round 1 blind estimate | 3.5 activity 30 | `service.js submitEstimate` (line 403); `packages/web/src/expert/CardView.jsx` | none material; time per answer is measured, not assumed (`docs/06`, line 32) |
| Round 2 revision | 3.5 activity 31 (fit is approximate) | `service.js openRound2` (line 373); `submitEstimate` round-2 branch (lines 414 to 416); `core/src/aggregate.js deduplicateRounds` (line 267); `core/src/secondlook.js` | the ACAPS-reading rule conflict (see below) |
| Resolution (outcome and evidence) | 3.5 activity 32 (track developments) | `service.js resolveCard` (line 383); `packages/web/src/staff/Cards.jsx` (lines 91 to 104) | none material |
| Scoring (Brier, interval, paired comparison) | 3.4 activity 27 (evaluate evidence and plausibility) | `core/src/scoring.js` (primitives, lines 114 to 226); `scripts/backtest.mjs` | **the link is not wired**: no service function joins a card's outcome to its Round 1 ledger snapshot, and no staff screen shows it |
| Panel result and interval | 3.2 activity 20 (summarise); 4 activity 38 (communicate uncertainty) | `service.js cardRelease` (line 438); `core/src/aggregate.js releaseAggregate` (line 797) | none material |

Two honest notes:
- The staff **Cards** screen has a "Panel result" button (`Cards.jsx` lines 93 to 95). It shows the released result. It does **not** show a score.
- The expert screen says "Your first resolved question unlocks your calibration mirror" (`packages/web/src/expert/SideCards.jsx` line 31). **No calibration view exists**: `scoring.js calibration()` is not called from the service or the web apps. Treat that line as a promise the product does not yet keep.

---

## Question 2: can we map how a situation evolved over time?

**What exists today (built and tested).**

| Piece | Where | What it shows | Data it uses |
|---|---|---|---|
| Risk timeline, visual | `packages/web/src/components/Timeline.jsx` (line 15); `StepChart.jsx` (line 18) | A step chart of completion rate per trigger (0 to 100%), trend markers (Deteriorated / Stable / Improved), a list of dated rationale notes, and a table beside each chart | `data/risk-radar.json` via `scripts/ingest.py` (lines 110 and 144): `completionHistory`, `trendHistory`, `rationaleUpdates` |
| Timeline, quantitative | `packages/core/src/timeline.js buildTimeline` (line 100) | Per trigger: the dated points, `span` (first and last date), and `movement` (`up`, `down`, `flat`, `none`) | same fields; `movementOf` (line 75) compares only the first and last distinct dates |
| Timeline, where it appears | Staff: `packages/web/src/staff/Dispatch.jsx` (line 113). Expert: `packages/web/src/expert/Risks.jsx` (line 145), full view only | Staff see it always; an expert sees it only after the risk's questions resolve (`service/src/radar.js`; `docs/05`, guarantee row "timeline") | — |
| Panel over rounds | `packages/web/src/staff/Evolution.jsx` `Panel` (line 56); `service/src/evolution.js cardSeries` (line 29); `core/src/series.js buildSeries` (line 22) | For one card: each closed round with its day, the number of experts, and the estimate with interval. A round under 5 is withheld. | the closed, panel-visible ledger documents (`service.js cardRelease`, line 438) |
| Regional grid | `packages/web/src/staff/Evolution.jsx` `Grid` (line 127); `core/src/grid.js buildGrid` (line 25) | Counts of risks and cards per region × theme; cells under 10 marked "descriptive only". **Not over time.** | risk and card counts only; no expert data |
| Analyst links, chains | `packages/web/src/staff/Evolution.jsx` `Links` (line 181); `core/src/links.js downstream` (line 81), `upstream` (line 91) | Links a moderator wrote, with mechanism and rival, and the chain downstream of a card (depth up to 3) | `answers.card_links` (migration `0008_card_links.sql`) |

**What it can show today.**
- For each risk: the recorded completion-rate line and the recorded trend words, with dates, in file order.
- Same-day conflicts are flagged as "same day, order as recorded" (`timeline.js` line 64; `StepChart.jsx` line 78).
- For a card: its closed panel rounds with intervals (at most two rounds per card).
- A chain of links that a moderator has written, with each link's rival explanation.

**What it cannot show today.**
- Any ACAPS rating, probability or impact **history**. ACAPS has said, informally and not in writing, that it cannot share this (`docs/11`, section 3, lines 52 to 69).
- Creation, publication or resolution dates of a risk (`docs/11`, section 3).
- Durations or lags. This is deliberate: "No durations or lags are computed from them" (`docs/12`, principle 2).
- Who changed a field, or why. There is no author column (`docs/11`, section 2, line 37).
- Change over time across **many** risks or a region. The grid is a snapshot.
- Expert-facing panel series. Staff only (`docs/12`, section 6).
- Whether a completion-rate change means the situation got worse. The completion rate is an analyst reading whose meaning is not standardised (`docs/11`, section 1).

**Planned only** (`docs/12`, section 6, line 39): automatic cascade detection; correlation statistics between questions; expert-facing panel series.

---

## Question 3: correlation and trickle-down (one situation causing another)

**What is built.**
- **Analyst links** (`core/src/links.js`, `service/src/evolution.js createLink` line 69, moderator only per `docs/05`). A link needs a mechanism and a rival explanation, 20 to 500 characters each (`validateLink` line 19). Every link is shown as "Analyst judgement, not a finding" (`Evolution.jsx` line 265). Nothing is inferred from the data or from other links (`docs/05`, guarantee row "Analyst links"; `docs/11`, section "What we are not asking", line 109).
- **Downstream and upstream walks** (`links.js` lines 56 to 94): breadth-first, each card listed once at its shallowest depth, cycles cannot loop, depth capped at 3 by default.
- **Regional grid** (`grid.js`): puts cards in the same region and theme side by side. This is **co-location, not correlation**. It uses no outcomes.

**What is not built in the product.**
- No correlation statistic between cards. No code reads two cards' outcomes together. (Checked: the only reader of `outcome` in `service.js` is `resolveCard`, line 383.)
- No cascade detection. Planned (`docs/12`, section 6).

**What the simulation says (labelled SYNTHETIC; not a result).**
- Location: `packages/simulate/` (`src/crosscorr.js`, `bin/run.mjs` lines 224 to 251, `out/20261107-seed20261107-quick/SYNTHETIC-crosscorr.csv`, and report section 8 at `SYNTHETIC-report.md` lines 240 to 257).
- Pairs needed for 80% power at a true correlation of 0.5, two-sided alpha 0.05:
  - idealised, independent pairs: **29**, power at 29 is 0.82;
  - panel noise, reliability 0.89: **37**; 0.72: **58**; 0.53: **112**.
  - The report gives **50** with a stricter multiple-comparison rule. The code computes this with `fisherN(0.5, 0.05/15, 0.8)` (`run.mjs` line 251). The number **15** is hard-coded there. I did not find its basis in any file I opened.
- A shared narrative error with no real link gives a spurious-correlation rate of **15.6%** at error size 0.4 (`SYNTHETIC-report.md` line 253).
- Note the range: the simulator gives **37 to 112** for noisy panels. `docs/05` line 102 says "about 60 to 105". The figure "36" is not in the output; the closest is 37.

**What a correlation needs, honestly.**
- **Resolved cards in pairs.** About 29 independent pairs for a moderate (0.5) correlation at 80% power, more with a noisy panel and with a stricter rule. The repo has **0** resolved cards today (no panel has run; `docs/00` line 7).
- **Independence.** Cards that share a risk, an expert or a country are clustered. Pooling them makes intervals too narrow (`docs/08`, line 29). A pair test must use one card per cluster, or a method that allows for clustering. The repo does not do this yet.
- **Multiple comparisons.** Each extra pair tested spends alpha. The simulator's own note says n=50 at r=0.5 can afford about 14 comparisons, not 50 (`crosscorr.js` lines 81 to 83). Any real analysis must fix the number of comparisons first.
- **Correlation is not causation.** A correlation between two questions can come from a shared source or a shared narrative error (the 15.6% figure above), not from one causing the other. A link written by a moderator is a hypothesis to test, not evidence.

**What the repo claims and does not claim.** It claims: links are analyst judgement with a rival explanation; grid counts are descriptive; correlation cannot be detected at pilot scale (`docs/05` line 102; `docs/12` line 39). It does **not** claim any cascade has been found, and it does not claim a link is causal.

**Status of the simulation, to check before anyone cites it.** `git status` shows `?? packages/simulate/` (untracked, so not in version control). `packages/simulate/.gitignore` ignores `out/`. `git ls-files packages/simulate` returns nothing. The docs say "No script in this repository computes them, and the simulation is not in this repository" (`docs/05` line 102; `docs/12` line 39). That is out of date for the working tree and wrong for version control. Also `docs/14` (the power analysis that should set the number of pairs) is **not written**: there is no file `docs/14-*` in `docs/`.

---

## Question 4: what is missing versus the poster (ranked)

Size: **small** (days, one screen or one function), **medium** (a few weeks, touches store, service and UI, plus a decision), **large** (a method or product decision first, then build).

| Rank | Missing or partly built | Poster step | Why it matters | Size | What would unblock it |
|---|---|---|---|---|---|
| 1 | **Score resolved cards against outcomes**, and show the result to staff (Brier with interval, Round 1 vs Round 2, calibration by band) | 3.4 #27; 3.5; 4 #38 | This is the loop that makes forecasting worth doing. Today the scoring code exists but no service route uses it, and nothing shows a score. | medium | (a) Owner decides the primary endpoint (`docs/06` `[DECISION]`, line 64). (b) A service function that reads the closed Round 1 ledger and the card's outcome, with the same floors. (c) A staff view with intervals. Real cards take 30 to 90 days to resolve (`docs/08`, line 29). |
| 2 | **Scenarios and indicators** (alternative futures with likelihoods; indicators to watch) | 3.5 #31, #32 | The poster's Anticipate step asks for a set of possible futures, not one number. The repo has one probability per card. | large | ACAPS to define what a scenario set looks like and how it is scored. Then a data model and a staff screen. |
| 3 | **Correlation statistics between cards** | 3.3 #22 | Needed before anyone can say one situation drives another. | medium (after rank 1) | A written power specification (`docs/14`, which does not exist yet); a count of resolved cards per stratum; a multiple-comparison rule; one-card-per-cluster rule. Simulation code is untracked and should be committed or moved before it is cited. |
| 4 | **Prescribe** (advice on response options, sequence of action) | 3.6 #33 to #35 | A large part of the poster. | large, and outside the benchmark as written | Owner decision on whether a forecasting benchmark should advise on response at all. Ask before scoping. Not planned in `docs/`. |
| 5 | **Evidence quality record**: confidence per data field, a change log for cleaning | 3.1 #14, #15; 3.4 #27 | The poster asks for "clean, reviewed databases, including confidence levels". The repo has ingest code and an audit log, not per-field confidence. | medium | ACAPS data dictionary (`organiser/acaps/` is the reference). A decision on what confidence means for an ACAPS field. |
| 6 | **Secondary-data review and a survey of surveys** | 2 #10, #11 | Needed to know what else exists for a risk. | medium | A named source list from ACAPS or analysts. Not a build problem. |
| 7 | **Rival hypotheses and problem-tree view** | 3.3 #24, #25 | Links already store a rival explanation. Nothing shows the tree of causes. | small | A screen over `links.js` output. Data exists. |
| 8 | **Severity ranking and an in-app assumption list** | 3.4 #26, #29 | Prioritising issues and listing assumptions. `docs/15` has an assumption register, but only for the simulation. | small to medium | Decide who owns the list and where it shows. |
| 9 | **Staff synthesis of expert reasons** | 4 #36, #38 | The poster wants reasoning shown. Reasons are stored and never shown to staff (`docs/05` line 103). | medium | A moderated synthesis design (not in the repo). |
| 10 | **Expert calibration view** (the promised "calibration mirror") | 3.4 #27 | Copy promises it (`SideCards.jsx` line 31); R7 says a private record is "planned and not built" (`docs/02`, line 33). | medium (depends on rank 1) | Rank 1 first. Then a per-expert view for that expert only. Remove or change the copy until then. |

Also missing and **not** on the poster's list, but worth knowing: ACAPS rating history, risk creation and resolution dates. ACAPS has said these cannot be shared (`docs/11`, sections 2 and 3). The repo does not assume them.

---

## Conflicts found (for the owner to decide; not fixed here)

1. **Round 2 and ACAPS's reading.** `docs/02-scoring-rules.md` R9 (line 55) says "Round 2 shows an expert the panel distribution and their own first answer, never ACAPS's rating", and `docs/06` (line 28) says the same. But `service/src/service.js` line 82 documents `showAcapsRound2` as **default true**, `acapsRound2` (line 509) returns `{ p: … }` when it is on, and it is attached to Round 2 payloads (lines 522 and 536). `service/bin/serve.mjs` line 116 sets it on unless `BENCHMARK_SHOW_ACAPS_ROUND2=0`. `BUILD.md` line 56 says "The ACAPS reading appears only on Round 2", which matches the code. So the docs and the code disagree on the default. It may be intended, but the docs say it should never happen.
2. **Docs say the simulation is absent.** See the Question 3 note on `packages/simulate/` (untracked, not in version control). `docs/05` line 102 and `docs/12` line 39 say it is not in the repo.
3. **Noisy-panel range.** `docs/05` says "about 60 to 105 pairs"; the simulator gives 37 to 112.
4. **Hard-coded 15 comparisons.** `packages/simulate/bin/run.mjs` line 251 uses `0.05/15`. The basis is not documented in any file I opened.
5. **Calibration copy.** `SideCards.jsx` line 31 promises a feature that does not exist.

---

## What I did not verify

- No tests, servers or scripts were run (per the brief). Claims about test counts come from `BUILD.md` and were not re-run.
- I did not open `data/risk-radar.json` or re-run `scripts/ingest.py`; the field names come from the ingest code (`ingest.py` lines 110 and 144) and `docs/12`.
- I did not read `aggregate.js releaseAggregate` in full (lines 797 to 923), nor `service/src/radar.js` beyond the timeline lines, nor the expert `Pulse.jsx`. Those claims rest on grep hits and the docs.
- I did not open `packages/simulate/src/secondstage.js`, `round2.js` or the simulator's report beyond section 8.
- The simulator figures are SYNTHETIC by their own label. They are not evidence about the real panel.

---

## Where to look (index)

**Poster**
- `/Users/brightech/Downloads/acaps_analysis_workflow_poster.pdf`: the source of every step number.

**Docs**
- `docs/00-overview.md`: what is built and what is not (status line 7).
- `docs/02-scoring-rules.md`: R1 to R10 (R7 line 33, R8 line 41, R9 lines 47 to 58).
- `docs/03-the-gap-to-real.md`: the limits of the evidence.
- `docs/05-service-and-privacy.md`: guarantees by row; "Not built, or not proven" section (lines 81 to 106).
- `docs/06-protocol.md`: primary endpoint (lines 18 to 23), decision (line 64).
- `docs/08-second-look.md`: Round 2 background; resolved outcomes take 30 to 90 days (line 29).
- `docs/10-pilot-experience.md`, `docs/09-roundtable-and-credit.md`: pilot and discussion.
- `docs/11-questions-for-acaps.md`: what ACAPS has and has not shared (sections 1 to 4).
- `docs/12-situation-evolution.md`: the evolution design; section 6 (line 39) lists what is not built.
- `docs/15-judgement-calls.md`: assumption register (simulation).
- `BUILD.md`: module table and status (lines 19 to 56).

**Core (pure logic)**
- `packages/core/src/scoring.js`: `brierItem` (114), `brier` (126), `bootstrapBrier` (146), `paired` (171), `calibration` (226).
- `packages/core/src/aggregate.js`: `BAND_MIDPOINT` (102), `deduplicateRounds` (267), `seedWeights` (366, unused by any route per `docs/02` R8), `releaseAggregate` (797).
- `packages/core/src/timeline.js`: `buildTimeline` (100), `movementOf` (75).
- `packages/core/src/series.js`: `buildSeries` (22).
- `packages/core/src/grid.js`: `buildGrid` (25), `MIN_CELL` (17).
- `packages/core/src/links.js`: `validateLink` (19), `walk` (56), `downstream` (81), `upstream` (91).
- `packages/core/src/secondlook.js`: `validateSecondLook` (91), `summariseArms` (127).
- `packages/core/src/pulse.js`: `rankAsks` (56).
- `packages/core/src/radar.js`: `normaliseRisk` (110), `neutralView` (141).
- `packages/core/src/authoring.js`: `validateCardInput` (91).
- `packages/core/src/gate.js`: `gate` (136).

**Service**
- `packages/service/src/service.js`: `createCard` (325), `closeRound` (358), `openRound2` (373), `resolveCard` (383), `submitEstimate` (403), `cardRelease` (438), `cardReleaseFor` (489), `inbox` (511), `acapsRound2` (509), `audit` (131).
- `packages/service/src/evolution.js`: `cardSeries` (29), `evolutionGrid` (54), `listLinks` (60), `createLink` (69), `removeLink` (92).
- `packages/service/src/radar.js`: `getRisk` (timeline on full view only, lines 105 and 116).
- `packages/service/src/pulse.js`: the expert weekly Pulse.
- `packages/service/bin/serve.mjs`: `showAcapsRound2` default (line 116).
- `packages/service/db/migrations/0008_card_links.sql`: link store.

**Web (staff)**
- `packages/web/src/staff/StaffApp.jsx`: tab list (line 18), including Evolution.
- `packages/web/src/staff/Evolution.jsx`: `Panel` (56), `Grid` (127), `Links` (181), `Evolution` (336).
- `packages/web/src/staff/Cards.jsx`: Open round 2 (90), Resolve (91 to 104), Panel result (93 to 95).
- `packages/web/src/staff/Dispatch.jsx`: Timeline in risk detail (113).

**Web (expert)**
- `packages/web/src/expert/CardView.jsx`: blind Round 1 (101, 206), Round 2 picture (205).
- `packages/web/src/expert/Risks.jsx`: Timeline on full view (145).
- `packages/web/src/expert/SideCards.jsx`: calibration copy (31).

**Shared components**
- `packages/web/src/components/Timeline.jsx` (15), `StepChart.jsx` (18).

**Simulation (untracked)**
- `packages/simulate/src/crosscorr.js`: `fisherN` (57), `impliedComparisons` (87), `simulateCorrPower` (236).
- `packages/simulate/bin/run.mjs`: crosscorr section (224 to 251).
- `packages/simulate/out/20261107-seed20261107-quick/SYNTHETIC-crosscorr.csv` and `SYNTHETIC-report.md` (section 8, lines 240 to 257).
- `packages/simulate/test/crosscorr.test.js`: not run.

**Scripts**
- `scripts/ingest.py` (lines 110 and 144: history and rationale fields).
- `scripts/backtest.mjs`, `scripts/measure-baseline.mjs`, `scripts/fit-baseline.mjs`: scoring on the export only.
