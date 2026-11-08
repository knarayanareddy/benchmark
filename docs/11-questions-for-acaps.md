# Questions for ACAPS before we build situation timelines

**Why this page exists.** A panel expert asked whether we can map how a situation has evolved over time. The Risk Radar export we were given (`data/risk-radar-export.csv`, 139 risks, 266 triggers) holds some dated history and not other kinds. The questions below are the ones we asked, with the evidence behind them, the answer we were given, and what we do now. Counts were measured from the file on 7 Nov 2026 with read-only scripts that are not saved in this repository.

**Status of the answers.** On 7 Nov 2026 ACAPS answered the questions on triggers, ratings and history (blocks 2 to 4 below). The answers reached the owner informally. They are labelled **told to the project, not yet confirmed in writing by ACAPS**. In short, told to the project: ACAPS cannot share this data, because its records are in Airtable and that data is not shared. ACAPS asked us to create synthetic datasets and make the judgement calls ourselves. The project is designed as if this data never arrives. Nothing in the protocol waits on ACAPS.

---

## 1. What does "completion rate" mean?

**What the file shows**
- 139 of 266 triggers carry a completion rate; 127 carry none. Values are only 10%, 20%, …, 100%.
- 140 triggers carry a dated history of it. In 139 of 139 comparable cases the current value equals the last history entry.
- **It is not a one-way progress meter.** Across consecutive history entries it rises 50 times, falls 9 times and stays flat once. Example: R0976 / T0400 reads 50% → 40% (6 Jan 2025), 30% (3 Mar 2025), 40% (24 Jul 2025). R1043 / T0619 reads 20% → 10% on the same day.
- **There is no stated denominator for most of them.** Of the 139 triggers with a completion rate, 101 have an empty "Quantitative objective to meet 100%". Where the objective is filled it is often a yes/no plus a description, for example "YES. the number of renewed attacks or attempts." or "yes. number of attacks related to cross border conflict.", not a number or a threshold.

**Questions** (original text, not yet answered in writing)
1. Is completion rate (a) the share of a trigger's described conditions that have been observed, (b) an analyst's judgement of how close the situation is to the trigger being fully met, (c) the share of a quantitative target reached, or (d) something else? Is the answer the same for every trigger?
2. Does 100% mean the trigger has **fired** and the risk's escalation scenario is under way, or only that the indicator has been fully observed? Is a decrease an expected event (the situation eased) or a correction of an earlier entry?
3. When the objective field says "YES", does that mean "this trigger is quantified", and if so where is the quantity?
4. Why are 127 triggers blank: not assessed yet, not applicable, or not recorded?

**Where this stands.** Told to the project, not yet confirmed in writing by ACAPS: the completion rate is an analyst's judgement, option (b). We treat it that way until ACAPS confirms it in writing.

**What we do now**
- Completion rate is shown as "analyst-recorded, meaning not standardised". It is never a probability, never an input to scoring, and never a resolution criterion.
- No trigger probability is derived from completion rate, or from the parent risk's band.

## 2. When an analyst updates a trigger or a risk, is history appended or overwritten?

**What the file shows**
- It looks appended: trigger histories are dated lines in non-decreasing order, and the current value always equals the last line. Risk-level rationale updates are headed `UPDATE dd/mm/yyyy`, and 63 risks have at least one (175 entries from 30 Jan 2025 to 7 Oct 2026).
- But it is not a complete audit trail:
  - **Same-day entries conflict** on 12 triggers for completion rate and 2 for trend (for example 40% then 60% on the same date), so the order within a day is only the order in the file.
  - **"Last update" often disagrees with the history.** On 55 of the 140 triggers with a history the last history date differs from the "Last update" field. So "Last update" records some other kind of edit (text? sources?) that leaves no history line.
  - **Only some fields have history.** Probability, impact, risk level, risk trend and status are single current values with no history. Rationale has updates; the risk-level fields do not.
  - No column says **who** changed anything.
- Only 29 triggers (of 266) have entries on two or more distinct dates in completion rate, and 18 in trend.

**Questions** (original text, not yet answered in writing)
1. Is the history field an append-only log written by the Risk Radar tool, or hand-typed by analysts? Can an old line be edited or deleted?
2. What does "Last update" track: any edit to the trigger, or only the completion-rate and trend fields? Can you tell us which edits do **not** create a history line?
3. Does the tool keep an internal revision log (who, when, which field) that is not in this export? If so, could we receive it for the 28 active risks?
4. Is the dd-mm-yyyy in history lines the date the situation changed or the date the analyst typed it in?

**ANSWERED: cannot be shared** (told to the project, not confirmed in writing by ACAPS). ACAPS's records are in Airtable, and that data is not shared.

**What we do now**
- Timelines show only what the export holds: the dated trigger histories and rationale updates, as recorded. No durations or lags are computed from them.
- We freeze ACAPS's reading on each risk when the protocol is registered, from the export file we hold. A later re-rating cannot change the comparison.

## 3. Is there a fuller export, with probability, impact and level history, and resolution dates?

**What the file shows**
- The organisers' challenge brief says the export contains "dated histories of probability, impact, risk level, trend and rationale" and a materialisation date. **The file we hold has none of those except rationale updates and the two trigger histories.** Probability (128 of 139 filled), impact (129), risk level (128), risk trend (77), status (132) and "What materialised?" (56) are each a single current value.
- There is no risk-creation date and no date on which a risk materialised or lapsed. The only dates are on triggers (entered 5 Feb 2024 to 5 Oct 2026; last update 9 Jul 2024 to 2 Nov 2026) and in rationale update headings.
- Our copy of the CSV is byte-identical to the organisers' copy, and the XLSX headers match.

**Questions** (original text, not yet answered in writing)
1. Does ACAPS hold, for each risk, a dated history of probability, impact and risk level (the "probability moved from Medium to High on 12 March" kind), and could we receive it? Ideally with the same ids (R0990…).
2. For each risk: the date it was first published on the Radar, the date it was assessed as materialised or not, and the date it left the Radar.
3. Whether "Materialised / Not materialised / Active" is decided by a stated rule and by whom, and what the evidence date is. (This also matters for scoring: those labels were assigned by ACAPS analysts after the fact.)
4. Whether any cascade or "related risk" links are recorded in the tool (for example, one risk listed as a driver of another). We currently have none and will not infer them automatically.

**ANSWERED: cannot be shared** (told to the project, not confirmed in writing by ACAPS). ACAPS's records are in Airtable, and that data is not shared. This covers rating history and resolution dates.

**What we do now**
- No ACAPS rating history and no resolution dates are assumed. Our own cards carry their own window and resolution date, fixed at authoring.
- The timeline is limited to the trigger histories and dated analyst narrative in the export. 57 risks have dated entries on two or more distinct dates in any field (19 of the 28 active ones); counting only the dated analyst narrative it is 47 risks (15 of the 28 active). Most risks have no history, and we say so on screen.

## 4. Questions about triggers and ratings

These three questions came out of the trigger work. ACAPS's answers are below each question.

**Q1. When an analyst sets a risk's probability, do they record which triggers had fired, and when?**
**ANSWERED: cannot be shared** (told to the project, not confirmed in writing by ACAPS). The records are in Airtable and are not shared.

**Q2. Can ACAPS provide a dated yes/no fired status for each trigger?**
**ANSWERED: cannot be shared** (told to the project, not confirmed in writing by ACAPS).
What the file shows: no field on any of the 266 triggers holds a fired or yes/no value. The trigger fields are: title, description, sources, completion rate and its history, objective, trend and its history, date entered and last update. A trigger has no status of its own in the export; the only outcome label is the parent risk's Status.

**Q3. Can the 44 filled "quantitative objectives" serve as resolution criteria?**
**ANSWERED: not as resolution criteria.** ACAPS cannot share the trigger records, so we cannot verify them from its side. We do not use them as resolution criteria.
What the file shows: 44 of 266 triggers have an objective filled. 31 of the 44 begin with yes or no. All 18 under Active risks begin with yes or no, and none of those 18 contains a deadline year.

**What we do now**
- **Trigger cards are resolved by a public external source, not by ACAPS trigger status.** Each card names its source (ACLED, IPC, UNHCR, IMF or an official decree), its window, its objective and a named resolver. All of these are fixed at authoring, never at resolution (rule R5). The card gate already requires them. The demo cards in the code resolve against ACLED, UNHCR and IPC; they are demo data only.
- The 44 filled objectives may inspire cards. They are not resolution criteria.
- Nothing uses ACAPS's trigger status, because the export does not contain one.

**Told to the project, not yet confirmed in writing by ACAPS, to be confirmed:**
- (a) A risk's probability is a human judgement.
- (b) The weighting of triggers is not linear. Analysts judge the risk's probability from which triggers have fired, with no formula.

Consequence: no formula links the triggers to ACAPS's rating, so a trigger card has no ACAPS comparator. We will ask ACAPS to confirm (a) and (b) in writing. The protocol does not depend on the answer.

---

## Judgement calls we make on ACAPS's behalf

ACAPS cannot share its trigger-level data and has asked us to build synthetic datasets and make the judgement calls ourselves. So every assumption in the simulations and in the synthetic world is a judgement call of ours.

- Each one is listed in a register (`docs/15`, in progress) with its value, its reason and how much it matters. ACAPS can review and veto any entry.
- Synthetic results are **not evidence about the real panel**. They show what would follow if the assumptions held. They cannot show how good a real panel is.

---

## What we are not asking, and what we will not do
- We will not infer causal links between risks from text. A link between two questions is created only by a moderator, with a stated mechanism and a rival explanation, and is shown as an analyst's judgement, not a finding.
- We will not treat completion rate as a probability.
- We will not derive a trigger probability from the parent risk's band or from a completion rate.
- We will not use the 44 quantitative objectives as resolution criteria.
- We will not wait for ACAPS data before registering the protocol.
- We will not show experts ACAPS's analysis, or this timeline, for a risk until every question on it has resolved (blind Round 1).
