# Questions for ACAPS before we build situation timelines

**Why this page exists.** A panel expert asked whether we can map how a situation has evolved over time. The Risk Radar export we were given (`data/risk-radar-export.csv`, 139 risks, 266 triggers) holds some dated history and not other kinds. Three things we cannot settle by reading the file are written here as concrete questions, each with the evidence behind it, what we will do under each possible answer, and what we are assuming until you answer. Counts were measured from the file on 7 Nov 2026; the scripts are in the repository history of this page.

Nothing below has been confirmed by ACAPS. Where we assume, we say so.

---

## 1. What does "completion rate" mean?

**What the file shows**
- 139 of 266 triggers carry a completion rate; 127 carry none. Values are only 10%, 20%, …, 100%.
- 140 triggers carry a dated history of it. In 139 of 139 comparable cases the current value equals the last history entry.
- **It is not a one-way progress meter.** Across consecutive history entries it rises 50 times, falls 9 times and stays flat once. Example: R0976 / T0400 reads 50% → 40% (6 Jan 2025), 30% (3 Mar 2025), 40% (24 Jul 2025). R1043 / T0619 reads 20% → 10% on the same day.
- **There is no stated denominator for most of them.** Of the 139 triggers with a completion rate, 101 have an empty "Quantitative objective to meet 100%". Where the objective is filled it is often a yes/no plus a description, for example "YES. the number of renewed attacks or attempts." or "yes. number of attacks related to cross border conflict.", not a number or a threshold.

**What we need from you** (please answer each)
1. Is completion rate (a) the share of a trigger's described conditions that have been observed, (b) an analyst's judgement of how close the situation is to the trigger being fully met, (c) the share of a quantitative target reached, or (d) something else? Is the answer the same for every trigger?
2. Does 100% mean the trigger has **fired** and the risk's escalation scenario is under way, or only that the indicator has been fully observed? Is a decrease an expected event (the situation eased) or a correction of an earlier entry?
3. When the objective field says "YES", does that mean "this trigger is quantified", and if so where is the quantity?
4. Why are 127 triggers blank: not assessed yet, not applicable, or not recorded?

**What we do under each answer**
- If it is a *judgement of closeness (b)*: we show it as an analyst's reading over time, never as a probability, and we do not feed it into scoring.
- If it is the *share of a quantitative target (c)*: we can turn those triggers into forecastable statements ("the indicator will exceed X by date"), which is the best kind of card, and we show the series as a measured quantity.
- If *100% means fired*: a trigger reaching 100% becomes a natural resolution event for cards about that risk's escalation, and the series becomes a leading indicator we can check panel forecasts against.
- If it is *unclear or inconsistent between analysts*: the timeline shows it labelled "analyst-recorded, meaning not standardised", and it is excluded from any quantitative analysis.

**Assumed until you answer:** (b), a judgement. We do not treat it as a probability or a measurement.

## 2. When an analyst updates a trigger or a risk, is history appended or overwritten?

**What the file shows**
- It looks appended: trigger histories are dated lines in non-decreasing order, and the current value always equals the last line. Risk-level rationale updates are headed `UPDATE dd/mm/yyyy`, and 63 risks have at least one (175 entries from 30 Jan 2025 to 7 Oct 2026).
- But it is not a complete audit trail:
  - **Same-day entries conflict** on 12 triggers for completion rate and 2 for trend (for example 40% then 60% on the same date), so the order within a day is only the order in the file.
  - **"Last update" often disagrees with the history.** On 55 of the 140 triggers with a history the last history date differs from the "Last update" field. So "Last update" records some other kind of edit (text? sources?) that leaves no history line.
  - **Only some fields have history.** Probability, impact, risk level, risk trend and status are single current values with no history. Rationale has updates; the risk-level fields do not.
  - No column says **who** changed anything.
- Only 29 triggers (of 266) have entries on two or more distinct dates in completion rate, and 18 in trend.

**What we need from you**
1. Is the history field an append-only log written by the Risk Radar tool, or hand-typed by analysts? Can an old line be edited or deleted?
2. What does "Last update" track: any edit to the trigger, or only the completion-rate and trend fields? Can you tell us which edits do **not** create a history line?
3. Does the tool keep an internal revision log (who, when, which field) that is not in this export? If so, could we receive it for the 28 active risks?
4. Is the dd-mm-yyyy in history lines the date the situation changed or the date the analyst typed it in?

**What we do under each answer**
- If it is an *append-only tool log*: we treat the timeline as a faithful record of what ACAPS knew and when, and we say so on screen.
- If it is *hand-typed and editable*: we show dates as "as recorded" and never compute durations or lags from them (a lag between two such dates measures analyst workflow, not the situation).
- Either way: we freeze ACAPS's reading on each card **at the moment the card is created**, so a later re-rating cannot silently change the comparison with the panel.

**Assumed until you answer:** append-style but incomplete, dates are "as recorded", no lag statistics.

## 3. Is there a fuller export, with probability, impact and level history, and resolution dates?

**What the file shows**
- The organisers' challenge brief says the export contains "dated histories of probability, impact, risk level, trend and rationale" and a materialisation date. **The file we hold has none of those except rationale updates and the two trigger histories.** Probability (128 of 139 filled), impact (129), risk level (128), risk trend (77), status (132) and "What materialised?" (56) are each a single current value.
- There is no risk-creation date and no date on which a risk materialised or lapsed. The only dates are on triggers (entered 5 Feb 2024 to 5 Oct 2026; last update 9 Jul 2024 to 2 Nov 2026) and in rationale update headings.
- Our copy of the CSV is byte-identical to the organisers' copy, and the XLSX headers match.

**What we need from you**
1. Does ACAPS hold, for each risk, a dated history of probability, impact and risk level (the "probability moved from Medium to High on 12 March" kind), and could we receive it? Ideally with the same ids (R0990…).
2. For each risk: the date it was first published on the Radar, the date it was assessed as materialised or not, and the date it left the Radar.
3. Whether "Materialised / Not materialised / Active" is decided by a stated rule and by whom, and what the evidence date is. (This also matters for scoring: those labels were assigned by ACAPS analysts after the fact.)
4. Whether any cascade or "related risk" links are recorded in the tool (for example, one risk listed as a driver of another). We currently have none and will not infer them automatically.

**What we do under each answer**
- If *rating history exists*: we can draw a per-risk timeline of ACAPS's own rating changes next to the panel's estimates, which answers the expert's request properly.
- If *resolution dates exist*: we can score forecasts against the real date things happened, not only the outcome, and show lead times.
- If *neither exists*: the timeline is limited to trigger histories and dated analyst narrative: 57 risks have dated entries on two or more distinct dates in any field (19 of the 28 active ones); counting only the dated analyst narrative it is 47 risks (15 of the 28 active). We say plainly that most risks have no history.

**Assumed until you answer:** only what is in the file.

---

## What we are not asking, and what we will not do
- We will not infer causal links between risks from text. A link between two questions is created only by a moderator, with a stated mechanism and a rival explanation, and is shown as an analyst's judgement, not a finding.
- We will not treat completion rate as a probability.
- We will not show experts ACAPS's analysis, or this timeline, for a risk until every question on it has resolved (blind Round 1).
