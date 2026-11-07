> **SYNTHETIC: simulation under stated assumptions, not a result**
>
> 22 judgement calls not yet reviewed by ACAPS.

# Judgement calls behind the ACAPS pilot power study

Every number in the power study that we had to choose rather than measure. These are our judgement calls, made because ACAPS cannot share its underlying records and asked us to make them. You may veto any of them. The study says what the pilot design could detect if experts behave in the way described here. It does not show that the panel is accurate.

**How to veto.** Tell the study team the call's id (for example J05), the value you want instead, your name or role, and the date. The change is recorded in assumptions.json with the reviewer, the date and a note. The register and every table are then regenerated from that file, and the entry shows its review state. Nothing changes until it is recorded this way.

**Unreviewed: 22 of 24 judgement calls not yet reviewed by ACAPS.** Reviewed so far: 2 accepted, 0 changed, 0 vetoed.

**How to read the evidence labels.** RAN: measured by running code on the pilot data or in prototype runs. DOC: taken from our own documents. INFERRED: worked out from a measured result. ASSUMED: a judgement with no measurement behind it. CODE: fixed by existing code or the protocol. RAN results come from prototype runs; the full simulator replaces them. A blank value means the simulator works it out, or that ACAPS decides (see the entry).

## J01

**What it is.** How much more the panel could know about each risk than ACAPS's rating already captures. This sets the ceiling for any improvement.

**Options considered.** 0.75 (small ceiling); 1.0 (medium); 1.25 (large); 1.5 (largest).

**Value chosen.**
- Parameter `tau`: 1.25 (allowed: 0.75 to 1.5)

**Why.** Smallest round value at which a 0.05 gain is possible at all. At 1.25 a perfectly informed panel could gain at most 0.054 Brier points over ACAPS. Nobody can measure this before a panel exists.

**Evidence.** ASSUMED. Source: power-spec §A.2 (default tau = 1.25, ASSUMED); ceiling table in §R J01 (RAN, head.mjs). Assumed. The ceiling table is RAN.

**Who may veto.** ACAPS programme

**Review state.** Not yet reviewed by ACAPS (proposed).

**What changes if this is wrong.**
- Setting: tau 0.75 / 1.0 / 1.25 / 1.5, with expert accuracy held fixed. Result: true gain 0.004 / 0.017 / 0.031 / 0.044 Brier points over ACAPS; cards needed about 11,400 / 780 / 270 / 140. This is the largest single swing in the study. (Evidence: RAN; source: power-spec §Analysis 4, S6 (RAN, sens.mjs).)

## J02

**What it is.** How accurate each expert is on a card (their noise). We do not choose this directly. We solve it so that the panel is better than the comparison by a stated amount.

**Options considered.** Fix the expert noise; Fix the improvement and solve for the noise.

**Value chosen.**
- Parameter `sigma`: blank (allowed: 0.05 to 6; blank allowed)
- Parameter `sigmaRef`: 1.53 (allowed: 0.05 to 6)
- Parameter `sigmaRefTrigger`: 2.36 (allowed: 0.05 to 6)

**Why.** Lets the table answer: if the panel really is this much better, can we see it? sigma is null because the simulator solves it for each target gain. sigmaRef (1.53) and sigmaRefTrigger (2.36) are the fixed-accuracy reference settings for the sensitivity sweeps: 1.53 gives a 0.03 gain over ACAPS at 8 responders; 2.36 gives a 0.03 gain over the base rate for trigger cards. The solver bracket 0.05 to 6 is from §B.3.

**Evidence.** RAN. Source: power-spec §B.3 (sigmaRef 1.53 and sigmaRefTrigger 2.36, RAN); §R J02. The choice of method (solve for the noise) is a judgement. The two reference values are measured.

**Who may veto.** Owner

**Review state.** Not yet reviewed by ACAPS (proposed).

**What changes if this is wrong.**
- Setting: A gain of 0.03 over ACAPS. Result: needs a panel whose ranking accuracy (AUC) is about 0.79, against ACAPS's measured 0.703. A reader who thinks this is unrealistic should read the 0.01 and 0.02 rows. (Evidence: RAN; source: power-spec §R J02 and §Analysis 3 population table (RAN).)

## J03

**What it is.** Share of experts who know little or nothing about a card and answer near the average.

**Options considered.** 0%; 20%; 40%.

**Value chosen.**
- Parameter `fracUninformed`: 0 (allowed: 0 to 0.4)

**Why.** The panel is recruited by declared country and theme.

**Evidence.** ASSUMED. Source: power-spec §A.3 (phi default 0, ASSUMED). Assumed.

**Who may veto.** ACAPS programme

**Review state.** Not yet reviewed by ACAPS (proposed).

**What changes if this is wrong.**
- Setting: 20% or 40% uninformed experts. Result: At 20% the true gain drops from 0.031 to 0.020 and the cards needed rise from 268 to 668. At 40% the panel is worse than ACAPS (gain -0.008). (Evidence: RAN; source: power-spec §Analysis 4, S3b (RAN, sens.mjs).)

## J04

**What it is.** How much experts differ in skill (some sharper, some noisier), and how scattered the answers of uninformed experts are.

**Options considered.** Equal skill (0); Moderate spread (0.25); Large spread (0.5).

**Value chosen.**
- Parameter `skillSpread`: 0.25 (allowed: 0 to 0.5)
- Parameter `uninformedSd`: 0.8 (allowed: 0 to 2)

**Why.** Real panels differ; the effect is small.

**Evidence.** ASSUMED. Source: power-spec §A.3 (eta 0.25 and uninformed spread 0.8, ASSUMED). Assumed. The spec gives no range for uninformedSd; 0 to 2 is set wide so that the default is valid. The owner should confirm it.

**Open: owner to choose.** The sources disagree or the owner has been asked to confirm (see the evidence above).

**Who may veto.** Owner

**Review state.** Accepted by project owner on 2026-11-07. Note: Decided: keep the range wide (0 to 2) until the simulation shows whether it matters.

**What changes if this is wrong.**
- Setting: No skill spread / moderate / large spread. Result: Cards needed 254 / 268 / 295. Minor. (Evidence: RAN; source: power-spec §Analysis 4, S3 (RAN, sens.mjs).)

## J05

**What it is.** How much experts share the same mistakes on a card (the same news, the same blind spot). This is the share of each expert's error that all experts on that card have in common.

**Options considered.** 0; 0.2; 0.4; 0.6.

**Value chosen.**
- Parameter `icc`: 0.2 (allowed: 0 to 0.6)

**Why.** Experts read the same sources; averaging cannot remove shared error.

**Evidence.** ASSUMED. Source: power-spec §A.3 (rho_e default 0.2, ASSUMED). Estimable from the pilot's own Round-1 answers without outcomes.

**Who may veto.** ACAPS programme

**Review state.** Not yet reviewed by ACAPS (proposed).

**What changes if this is wrong.**
- Setting: Shared error 0 / 0.2 / 0.4 / 0.6. Result: True gain 0.035 / 0.031 / 0.026 / 0.022 over ACAPS; cards needed 181 / 268 / 403 / 625. (Evidence: RAN; source: power-spec §Analysis 4, S2 (RAN, sens.mjs).)

## J06

**What it is.** Whether experts are over-confident (answers too extreme) or under-confident (answers too close to 50%).

**Options considered.** x0.5 (under-confident); x0.75 (under-confident); x1 (calibrated); x1.5 (over-confident); x2 (over-confident).

**Value chosen.**
- Parameter `omega`: 1 (allowed: 0.5 to 2)

**Why.** A neutral starting point. Averaging calibrated experts already makes the panel slightly under-confident (calibration slope about 1.2, RAN).

**Evidence.** ASSUMED. Source: power-spec §A.3 (omega = 1 calibrated, ASSUMED). Assumed.

**Who may veto.** ACAPS programme

**Review state.** Not yet reviewed by ACAPS (proposed).

**What changes if this is wrong.**
- Setting: x0.5 / x0.75 / x1 / x1.5 / x2. Result: Cards needed 1,656 / 410 / 268 / 281 / 460. Strong under-confidence is costly. (Evidence: RAN; source: power-spec §Analysis 4, S4 (RAN, sens.mjs).)

## J07

**What it is.** A lean shared by the whole panel (too gloomy or too optimistic), and each expert's own persistent lean.

**Options considered.** Panel lean -0.5, 0 or +0.5; Personal lean 0.3 (typical size).

**Value chosen.**
- Parameter `sigmaBias`: 0.3 (allowed: 0 to 0.6)
- Parameter `panelBias`: 0 (allowed: -0.5 to 0.5)

**Why.** No reason to expect a direction; personal lean is a typical-size allowance.

**Evidence.** ASSUMED. Source: power-spec §A.3 (sigma_b 0.3 and panel lean 0, ASSUMED). Assumed.

**Who may veto.** Owner

**Review state.** Not yet reviewed by ACAPS (proposed).

**What changes if this is wrong.**
- Setting: Panel lean +0.5 or -0.5. Result: Panel lean +0.5: gain 0.013, cards needed 2,135; -0.5: cards needed 293 (against 268 at 0). A shared optimistic lean is costly. (Evidence: RAN; source: power-spec §Analysis 4, S4b (RAN, sens.mjs).)

## J08

**What it is.** How many invited experts answer a card, and how many answers a card needs before it counts. The dropout value is the share who do not answer (0.51 means 51% do not).

**Options considered.** Response 49%; Response 17%; Invite 15; Invite 50; Minimum 5 answers; Minimum 3 answers.

**Value chosen.**
- Parameter `K`: 15 (allowed: 8 to 60)
- Parameter `dropout`: 0.51 (allowed: 0.3 to 0.83)
- Parameter `dropoutKappa`: 10 (allowed: 5 to 10000)
- Parameter `floor`: 5 (allowed: one of 3, 5)
- Parameter `kFixed`: blank (allowed: 3 to 15; blank allowed)
- Parameter `rosterSize`: 40 (allowed: 20 to 100)

**Why.** Minimum 5 is the privacy rule in the code. 49% and 17% are the two figures in our own documents, and we cannot tell which fits ACAPS's experts. dropoutKappa sets how much response varies between cards; 10000 stands in for no variation (the infinite case).

**Evidence.** DOC. Source: docs/06 (protocol: 51% drop out); docs/00 (about 17% response); power-spec §0 F9. 49%: protocol, source not in repo. 17%: docs/00. The binomial arithmetic is RAN. kFixed null means the dropout model is used; the floor 5 is the code's MIN_RELEASE_PANEL_SIZE.

**Who may veto.** ACAPS programme (they know their experts)

**Review state.** Not yet reviewed by ACAPS (proposed).

**What changes if this is wrong.**
- Setting: Response 49%, invite 15 (stored setting: response varies between experts). Result: About 82% of cards reach 5 answers when experts differ in how likely they are to respond (the stored setting); 93% if every expert were equally likely to respond. At 17% response only 9.6% do, and about 50 invited experts per card are needed to reach 94%. (Evidence: RAN; source: power-spec §0 F9 (binomial arithmetic, RAN).)
- Setting: Answers needed per card 3 / 5 / 8 / 15. Result: Cards needed (80% chance) 528 / 361 / 268 / 219. The true gain also changes with the answer count (see the S1 sweep). (Evidence: RAN; source: power-spec §Analysis 4, S1 (RAN, sens.mjs).)

## J09

**What it is.** The share of cards that can actually be scored. A card needs a rating (for risks), a public source we can bind before the card opens, and an outcome in time.

**Options considered.** Risk cards 40% to 90%; Trigger cards 30% to 80%.

**Value chosen.**
- Parameter `yieldRisk`: 0.6 (allowed: 0.4 to 0.9)
- Parameter `yieldTrigger`: 0.5 (allowed: 0.3 to 0.8)

**Why.** 89 of 139 risk headlines trip our 'observable' warning; only 44 of 266 triggers have a filled objective, and most of those are not numbers.

**Evidence.** ASSUMED. Source: power-spec §2 (observable warning count: BUILD.md, DOC; trigger objectives count: RAN). Assumed. The counts are DOC and RAN.

**Who may veto.** Owner (it depends on the project's authoring effort)

**Review state.** Not yet reviewed by ACAPS (proposed).

**What changes if this is wrong.**
- Setting: Risk-card yield 0.6 or 0.9. Result: Directly proportional: halving it doubles the waiting time. At 4.1 new risks a month, 100 comparable risk cards take about 34 months at 60% and about 21 months at 90%. (Evidence: INFERRED; source: power-spec §2 table (INFERRED from RAN arrivals).)

## J10

**What it is.** In Round 2, how far experts move toward the panel's average after seeing it. The spread between experts (0.1) and random noise in Round 2 answers (0.1) are typical-size allowances.

**Options considered.** 0 (no movement); 0.3 (modest revision); 0.6 (strong revision).

**Value chosen.**
- Parameter `herd`: 0.3 (allowed: 0 to 1)
- Parameter `herdSd`: 0.1 (allowed: 0 to 0.6)
- Parameter `r2Noise`: 0.1 (allowed: 0 to 0.6)

**Why.** Typical size of a modest revision; no data.

**Evidence.** ASSUMED. Source: power-spec §A.5 (herding ~ N(0.3, 0.1^2) and noise ~ N(0, 0.1^2), ASSUMED). Assumed; no data. The range 0 to 0.6 is the row range in §A.8 and is applied to all three keys.

**Who may veto.** ACAPS programme

**Review state.** Not yet reviewed by ACAPS (proposed).

**What changes if this is wrong.**
- Setting: Herding 0 / 0.3 / 0.6, with 40 risk cards (pull 0.3). Result: Chance of detecting the second-look pull: 98% / 73% / 39%. (Evidence: RAN; source: power-spec §Analysis 5 (RAN, r2.mjs and r2b.mjs).)
- Setting: Herding 0 / 0.3 / 0.6, with 100 risk cards (pull 0.15). Result: Chance of detecting the second-look pull: 98% / 68% / 26%. (Evidence: RAN; source: power-spec §Analysis 5 (RAN, r2.mjs and r2b.mjs).)

## J11

**What it is.** How strongly ACAPS's own reasoning pulls experts toward ACAPS's rating in Round 2, for those who open it. The pull for the balanced view is set to zero.

**Options considered.** 0.1 of the gap; 0.2 of the gap; 0.3 of the gap; 0.5 of the gap.

**Value chosen.**
- Parameter `lambdaAcaps`: 0.3 (allowed: 0.1 to 0.5)
- Parameter `lambdaBalanced`: 0 (allowed: 0 to 0.2)

**Why.** A visible but not dominant effect, so the design is tested against something it could plausibly see.

**Evidence.** ASSUMED. Source: power-spec §A.5 (lambda_acaps_view 0.3, lambda_balanced 0, ASSUMED). Assumed.

**Who may veto.** ACAPS programme

**Review state.** Not yet reviewed by ACAPS (proposed).

**What changes if this is wrong.**
- Setting: Pull 0.15 / 0.3 / 0.5 of the gap. Result: Risk cards needed for an 80% chance: about 140 / 40 / 28. (Evidence: INFERRED; source: power-spec §Analysis 5 (INFERRED from RAN r2.mjs).)

## J12

**What it is.** In Round 2: how often experts keep their first answer, how often they open the background, and how often they answer Round 2 at all. Also whether they read the discussion thread.

**Options considered.** Keep 10% to 60%; Open 30% to 100%; Answer 40% to 100%; Thread reading off.

**Value chosen.**
- Parameter `pKeep`: 0.3 (allowed: 0 to 1)
- Parameter `qOpen`: 0.6 (allowed: 0.3 to 1)
- Parameter `c2`: 0.7 (allowed: 0.4 to 1)
- Parameter `sawThreadShare`: 0 (allowed: 0 to 0.5)
- Parameter `threadHerd`: 0.15 (allowed: 0 to 0.5)

**Why.** Plausible values; none measured.

**Evidence.** ASSUMED. Source: power-spec §A.5 (p_keep 0.3, q_open 0.6, c2 0.7, ASSUMED); §A.8 (thread 0, 0.15). Assumed; none measured.

**Who may veto.** ACAPS programme

**Review state.** Not yet reviewed by ACAPS (proposed).

**What changes if this is wrong.**
- Setting: Pull 0.3 with 40 cards. Result: Keeping answers at 10% or 60% gives 82% or 49% detection; opening the background at 30% or 100% gives 35% or 97%; answering only 40% gives 46%. (Evidence: RAN; source: power-spec §Analysis 5 (RAN, r2b.mjs).)

## J13

**What it is.** How much trigger cards under the same risk move together, because they describe the same situation, so their answers and outcomes are alike. This reduces the number of truly independent cards. One dial sets it from 0 (independent) to 1 (near-duplicates).

**Options considered.** 0 (independent); 0.5 (moderately alike); 0.7 (planning case); 0.9 (near-duplicates).

**Value chosen.**
- Parameter `coupling`: 0.7 (allowed: 0 to 1)
- Parameter `copyShare`: 0 (allowed: 0 to 1)
- Parameter `sharedErrRisk`: 0.3 (allowed: 0 to 1)

**Why.** Triggers under one risk describe the same situation by construction. How alike their outcomes are is unknown, and ACAPS's trigger records would measure it but are not available.

**Evidence.** ASSUMED. Source: power-spec §A.6 (coupling mapping; realised correlation from RAN trig-run4.mjs); §A.8. Dial 0 / 0.5 / 0.7 / 0.9 gives a correlation of the score differences within a risk of 0 / 0.11 / 0.27 / 0.51 (RAN). CONFLICT, unresolved: §A.6 maps coupling 0.7 to copyShare 0.7, sharedErrRisk 0.7 and rhoLatent 0.63, but §A.8 lists 0 and 0.3 for copyShare and sharedErrRisk. The owner must choose one reading.

**Open: owner to choose.** The sources disagree or the owner has been asked to confirm (see the evidence above).

**Who may veto.** ACAPS programme

**Review state.** Accepted by project owner on 2026-11-07. Note: Decided: run both 0.3 and 0.7 for how alike trigger cards from one risk are, using the coupling-to-parameters map in the spec, and report them side by side. The stored copyShare and sharedErrRisk are not used for these runs.

**What changes if this is wrong.**
- Setting: Dial 0.7 (planning case) and 0.9. Result: At dial 0.7, 149 trigger cards behave like about 62 independent ones, and the chance of noticing a 0.03 gain falls from 84% to 44%; at 0.9 it falls to 38%. (Evidence: RAN; source: power-spec §Analysis 1, nested table (RAN, trig-pow.mjs).)
- Setting: Dial 0 / 0.7 / 0.9. Result: Raw cards needed for an 80% chance of a 0.03 gain: about 135 / 310 / 330. (Evidence: INFERRED; source: power-spec §Analysis 1 (INFERRED from RAN, interpolated).)

## J14

**What it is.** What the panel's accuracy is compared with when we ask: is it better than simply guessing the average?

**Options considered.** (a) the average outcome of the same cards; (b) always 50%; (c) the historical rate 58.65%; (d) the repo's regression on ACAPS fields.

**Value chosen.**
- Parameter `benchmark`: `in_sample_base_rate` (allowed: one of `in_sample_base_rate`, `fixed_0.5`, `fixed_historical`)

**Why.** It is the hardest simple benchmark, needs no history or ACAPS fields, exists for every card type, and is already the 'naive floor' in our own results. Option (d) needs ACAPS's rating fields and exists only for risk cards.

**Evidence.** DOC. Source: repo definition (LADDER: naive floor 0.2425, regression 0.2177); power-spec §Analysis 1. The repo definitions are DOC. The arithmetic in the effect row is INFERRED.

**Who may veto.** ACAPS programme and owner

**Review state.** Not yet reviewed by ACAPS (proposed).

**What changes if this is wrong.**
- Setting: (b) always 50%, or (c) the historical rate. Result: Using (b) flatters the panel by 0.010 Brier points when the true rate is 40%; (c) by 0.035 at 40% and 0.011 at 69%. A choice like (c) can make a poor panel look good. Never used for the headline. (Evidence: INFERRED; source: power-spec §Analysis 1 (INFERRED arithmetic).)

## J15

**What it is.** How often a trigger statement turns out true (its base rate), and how widely trigger forecasts spread around it. The spread of 1.47 is the same as the spread of the risk-level forecasts.

**Options considered.** 20%; 40%; 70%.

**Value chosen.**
- Parameter `triggerBase`: 0.4 (allowed: 0.2 to 0.7)
- Parameter `triggerSpread`: 1.47 (allowed: 1 to 2)

**Why.** Trigger statements are narrower than risks and are asked over 30 to 90 days; a guess.

**Evidence.** ASSUMED. Source: power-spec §A.6 (triggerBase 0.4 ASSUMED; triggerSpread 1.47 = risk-level spread, ASSUMED). Assumed.

**Who may veto.** ACAPS programme

**Review state.** Not yet reviewed by ACAPS (proposed).

**What changes if this is wrong.**
- Setting: Base rate 0.3 / 0.45 / 0.7 at risk level. Result: Cards needed change to 79 / 169 / 199. (Evidence: RAN; source: power-spec §Analysis 4, S5 (RAN, sens.mjs).)
- Setting: Trigger base rate changed. Result: Changes both the room for improvement and how well ACAPS's fixed midpoints fit the outcomes. The trigger-level effect is to be measured by sweep S5. (Evidence: INFERRED; source: power-spec §Analysis 4, S5 caveat (INFERRED).)

## J16

**What it is.** How fast new risks arrive on the Risk Radar (per month), and how fast new triggers arrive (per month).

**Options considered.** 2.8 risks a month; 4.1 risks a month; 4.8 risks a month.

**Value chosen.**
- Parameter `arrivalRisksPerMonth`: 4.1 (allowed: 2.8 to 4.8)
- Parameter `arrivalTriggersPerMonth`: 10.75 (allowed: 8 to 13)

**Why.** Counted from the dates triggers were entered: 3.27 risks a month over 33 months, 4.08 over the last 12. Triggers: 10.75 a month over the last 12. Months are very uneven (June 2026: 15 risks; six months with none).

**Evidence.** RAN. Source: power-spec §2 (RAN, rate.mjs and rate2.mjs, from data/risk-radar.json; creation-order proxy: rank correlation 0.95 with entry date). The dates are trigger entry dates, not publication dates. Risks have no creation date, so id order is used as a proxy. Data files: data/risk-radar.json.

**Who may veto.** ACAPS programme

**Review state.** Not yet reviewed by ACAPS (proposed).

**What changes if this is wrong.**
- Setting: 4.1 risks a month. Result: Comparable risk cards after 12 months at 60%: about 34 (95% range from month-to-month variation: 25 to 47). (Evidence: INFERRED; source: power-spec §2 table (INFERRED from RAN arrivals).)
- Setting: 2.8 / 4.1 / 4.8 risks a month. Result: Months to reach 100 comparable risk cards: 50 / 34 / 29. (Evidence: INFERRED; source: power-spec §2 (INFERRED from RAN arrivals).)

## J17

**What it is.** How long a question stays open before it can be scored. A card published in the last 3 months of a window cannot be scored yet.

**Options considered.** 1 month; 3 months; 6 months.

**Value chosen.**
- Parameter `resolutionLagMonths`: 3 (allowed: 1 to 6)

**Why.** Our own rule: windows of 30 to 90 days (docs/03).

**Evidence.** ASSUMED. Source: docs/03 (30 to 90 days, DOC); power-spec §2 (3 months, ASSUMED). Weak proxy: of risks first entered in early 2026, resolved ones were last updated 0 to 4 months later.

**Who may veto.** ACAPS programme

**Review state.** Not yet reviewed by ACAPS (proposed).

**What changes if this is wrong.**
- Setting: Each extra month of delay. Result: Removes about 4 new risks a month from a window, which is about 2.5 comparable cards at 60%. (Evidence: INFERRED; source: power-spec §2 and §R J17 (INFERRED).)

## J18

**What it is.** The smallest improvement over ACAPS that would matter to ACAPS programme work. We do not choose it: ACAPS decides. Leave it empty until they do.

**Options considered.** 0.02 Brier points; 0.03 Brier points; 0.05 Brier points.

**Value chosen.**
- Parameter `minEffect`: blank (allowed: 0.02 to 0.05; blank allowed)

**Why.** It is a value judgement, not a statistical fact.

**Evidence.** ASSUMED. Source: power-spec §R J18 (value judgement; not chosen). No evidence: a value judgement left to ACAPS.

**Who may veto.** ACAPS programme

**Review state.** Not yet reviewed by ACAPS (proposed).

**What changes if this is wrong.**
- Setting: 0.02 / 0.03 / 0.05 Brier points over ACAPS. Result: Cards needed to notice it: 640 / 285 / 100. (Evidence: INFERRED; source: power-spec §Analysis 2 (INFERRED, spread 0.18).)
- Setting: 0.02 / 0.03 / 0.05 Brier points over the base rate. Result: Cards needed: 176 / 111 / about 75 (8 responders per card). (Evidence: RAN; source: power-spec §Analysis 1, independent cards (RAN; 0.05 interpolated).)

## J19

**What it is.** How ACAPS's five words (Very Low to Very High) are turned into numbers for the comparison.

**Options considered.** Middle of each published band (10%, 30.5%, 50.5%, 70.5%, 90.5%); Rating divided by 5.

**Value chosen.**
- Parameter `comparator`: `midpoint` (allowed: one of `midpoint`, `ordinal`)

**Why.** It is the protocol's headline; ACAPS publishes the bands.

**Evidence.** DOC. Source: docs/06 (protocol headline); power-spec §R J19. The two readings are checked against the real data (RAN).

**Who may veto.** ACAPS programme

**Review state.** Not yet reviewed by ACAPS (proposed).

**What changes if this is wrong.**
- Setting: Rating divided by 5 instead of band midpoints. Result: Negligible historically: the two readings differ by 0.0003 Brier points on the 104 resolved risks. (Evidence: RAN; source: power-spec §R J19 (RAN).)

## J20

**What it is.** Treating ACAPS's historical hit rate for each band as the truth for ACAPS in the study. The options are to use the measured rates, to blend them with the overall rate, or to draw them with their uncertainty.

**Options considered.** Use the measured rates; Blend with the overall rate; Draw the rates with their uncertainty.

**Value chosen.**
- Parameter `shrinkM`: 0 (allowed: 0 to 5)
- Parameter `bandRateUncertainty`: false (allowed: one of false, true)

**Why.** Reproduces ACAPS's measured Brier score exactly (0.2124 on the 99 rated risks). Bands hold only 3, 14, 44, 30 and 8 risks, so the extremes are noisy.

**Evidence.** RAN. Source: power-spec §R J20 and §F7 (RAN). shrinkM 0 means no blending; bandRateUncertainty false means the measured rates are used as they are.

**Who may veto.** Owner

**Review state.** Not yet reviewed by ACAPS (proposed).

**What changes if this is wrong.**
- Setting: A copy of ACAPS recalibrated to the measured rates. Result: Gains 0.009 Brier points, so improvements up to about 0.01 could be recalibration alone. Very Low (3 cards) and Very High (8 cards) are the least reliable. (Evidence: RAN; source: power-spec §F7 (RAN).)

## J21

**What it is.** How the experts' answers on one card are combined into the panel's answer.

**Options considered.** Middle value (median); Average; Average of log-odds; Down-weighting outliers.

**Value chosen.**
- Parameter `poolMethod`: `median` (allowed: one of `median`, `mean`, `log_odds`, `outlier_weighted`)
- Parameter `extremiseD`: 1 (allowed: 1 to 2.5)

**Why.** The repo's default.

**Evidence.** DOC. Source: repo default for aggregate() (code default, DOC); power-spec §A.8. extremiseD 1 means no sharpening. Section A does not define extremiseD; WP2 must define it before the key is used.

**Who may veto.** Owner

**Review state.** Not yet reviewed by ACAPS (proposed).

**What changes if this is wrong.**
- Setting: Average instead of median. Result: Cards needed 241 instead of 268. Other rules are still to be run. (Evidence: RAN; source: power-spec §Analysis 4, S8 (RAN, sens.mjs).)

## J22

**What it is.** How a risk forecast could be built from the panel's trigger forecasts. All three rules are reported; this one is the default.

**Options considered.** Highest trigger probability (max); 'At least one fires' (noisy-OR); Plain average (mean).

**Value chosen.**
- Parameter `rule`: `mean` (allowed: one of `max`, `noisy_or`, `mean`)

**Why.** They are the simplest rules that need no ACAPS formula (ACAPS says none exists).

**Evidence.** ASSUMED. Source: power-spec §Analysis 3 (RAN population table, second.mjs). Assumed. The rule results are RAN.

**Who may veto.** ACAPS programme

**Review state.** Not yet reviewed by ACAPS (proposed).

**What changes if this is wrong.**
- Setting: Link strength 0.1 / 0.3 / 0.5 / 0.8. Result: Ranking accuracy (AUC): ACAPS 0.70; average 0.63 / 0.71 / 0.75 / 0.79; highest 0.61 / 0.68 / 0.73 / 0.78; 'at least one' 0.60 / 0.67 / 0.71 / 0.75. At weak links no rule beats ACAPS's rating. (Evidence: RAN; source: power-spec §Analysis 3 (RAN, second.mjs).)

## J23

**What it is.** How strongly a risk's trigger events track whether the risk itself happens (0.3 on our scale). Also the real band counts and hit rates of the 99 rated, resolved risks, and the real counts of active risks and triggers (28 risks, 76 triggers).

**Options considered.** 0.1; 0.3; 0.5; 0.8.

**Value chosen.**
- Parameter `rhoLatent`: 0.3 (allowed: 0 to 0.9)
- Parameter `bandCounts`: [3, 14, 44, 30, 8] (allowed: one of [3, 14, 44, 30, 8])
- Parameter `bandHits`: [1, 6, 21, 25, 7] (allowed: one of [1, 6, 21, 25, 7])
- Parameter `activeMix`: [0, 3, 8, 15, 2] (allowed: one of [0, 3, 8, 15, 2])
- Parameter `statementsPerRisk`: activeRisks 28, activeTriggers 76 (allowed: one of activeRisks 28, activeTriggers 76)
- Parameter `bandMix`: `resolved` (allowed: one of `resolved`, `active`)

**Why.** Unknown without ACAPS's trigger records; the pilot can estimate it from its own resolved risks. The band counts, hit rates and active counts are measured from the public export, so their ranges are fixed by it.

**Evidence.** ASSUMED. Source: power-spec §A.6 (rhoLatent 0.3, ASSUMED); data/risk-radar.json for the measured counts (RAN). Assumed. Real data as used: the band mix and hit rates of 99 rated resolved risks (RAN). Data files: data/risk-radar.json.

**Who may veto.** ACAPS programme

**Review state.** Not yet reviewed by ACAPS (proposed).

**What changes if this is wrong.**
- Setting: Link 0.8 against 0.1 to 0.3. Result: Decides whether the trigger-to-risk analysis is worth running at all. At 0.8 and 200 risks the chance of noticing a true ranking gain of 0.09 is 71%; at 28 risks, 14%. (Evidence: RAN; source: power-spec §Analysis 3 power table (RAN, second.mjs).)

## J24

**What it is.** Fixed by the existing rules, not judgement calls: answers are whole percents from 1 to 99; the error rate is 5% two-sided; intervals come from 10,000 resamples with seed 7; the release floor is 5 answers. The master seed fixes every random draw of the simulator.

**Options considered.** No alternatives: fixed by existing rules.

**Value chosen.**
- Parameter `clamp`: [0.01, 0.99] (allowed: one of [0.01, 0.99])
- Parameter `alpha`: 0.05 (allowed: one of 0.05)
- Parameter `analysisReps`: 10000 (allowed: one of 10000)
- Parameter `analysisSeed`: 7 (allowed: one of 7)
- Parameter `releaseFloor`: 5 (allowed: one of 5)
- Parameter `masterSeed`: 20261107 (allowed: 0 to 4294967295)

**Why.** Existing protocol and code.

**Evidence.** CODE. Source: docs/02 and docs/06; repo code (clampForecast, paired(), MIN_RELEASE_PANEL_SIZE); power-spec §B.4 for masterSeed. masterSeed is not in the table in §A.8; it comes from §B.4. It is a run seed: changing it changes the draws, not the design.

**Who may veto.** Owner

**Review state.** Not yet reviewed by ACAPS (proposed).

**What changes if this is wrong.**
- Setting: A change to the protocol. Result: None, unless the protocol changes. (Evidence: CODE; source: docs/02 and docs/06 (protocol).)

## What this register is not

This register is not a result. It says what the pilot design could detect if experts behave the way described here, under these calls. It never says that the panel is accurate, that it will beat ACAPS, or that a gain is likely. Change a call and the conclusions move with it.

> **SYNTHETIC: simulation under stated assumptions, not a result**
