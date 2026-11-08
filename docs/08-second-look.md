# The second look: design, and what it can and cannot tell you

**Status: built and checked in a browser against the real service, but not yet used by any expert. The content must be written by ACAPS, and nothing in this repo supplies it.**

## What it is

Round 1 is blind. In Round 2 (a revision round a moderator opens after Round 1 closes) an expert already sees the panel distribution and their own first answer. The **second look** is optional extra background offered only then, so an expert can check their thinking. What each expert is offered is decided by a randomly assigned **arm**, so we can measure what the background does instead of assuming it is neutral.

| Arm | What the expert may open |
|---|---|
| `control` | nothing extra (no button is shown) |
| `balanced` | reasons the event could be **more** likely and reasons it could be **less** likely, in one fixed layout |
| `acaps_view` | ACAPS's own reasoning and sources for the risk |

**No arm ever shows an ACAPS probability.** The text is checked on save and rejected if it contains a percentage or "high probability"-style wording. The arm is never sent to the client; the expert cannot tell which arm they are in, and a control expert cannot tell a missing background from being in the control arm. The Round-2 ACAPS marker is not an arm and is off by default (`BENCHMARK_SHOW_ACAPS_ROUND2=1` turns it on); with it on, every Round-2 expert sees ACAPS's band, which would make these arms uninformative, so it needs a protocol amendment first.

## How it avoids steering

- **Order:** blind first. The first answer is stored and scored before anything is shown, and it is the primary endpoint (`docs/06-protocol.md`). Round 2 is a separate, secondary measurement.
- **Equal buttons:** "Keep my first answer" and "Save my revision" have identical styling and both create a Round-2 row, so keeping is not the same as skipping.
- **Randomised content:** arms are assigned by `HMAC(ballot secret, "arm:v1", card, respondent key)`, so assignment is deterministic, roughly uniform, independent between cards, and needs no stored identity. This works for anonymous experts and for device-held ballots (their respondent key is their token).
- **Viewing is recorded by the server**, when the background is opened, never reported by the browser. An answer row carries `arm` and `sawSecondLook` computed server-side; a client cannot set them.
- **Fixed in advance:** the background for a card can be edited only while Round 1 is open. After Round 1 closes it is locked, and every edit is in the audit log.

## What it measures, and what it cannot

For each arm, the moderators see: the number of paired answers, the mean change from Round 1 to Round 2, the mean change **toward ACAPS's reading**, and how many opened the background. Any arm with fewer than 5 pairs shows no numbers.

It **can** show whether the background moves people, and whether it moves them toward ACAPS more than the other arms do (an anchoring signal). It **cannot** show that the background makes forecasts more accurate: that needs resolved outcomes, which arrive 30 to 90 days after a card closes. The number of resolved statements needed to see a 0.02 gain is not yet set: the earlier figure of about 506 is withdrawn (see `docs/06-protocol.md`; the power analysis is in progress as `docs/14`, not yet written). Pooling across cards treats answers as independent although they are clustered by expert and by risk, so intervals from it would be too narrow; the table is descriptive and carries no confidence interval by design.

## Privacy

- The view log (`answers.second_look`) holds a respondent key and an arm, nothing else. It is erased with the expert's answers (`eraseMe`, a device's own erase) and removed by retention with the estimates it describes.
- `exportMe` removes `arm` and `sawSecondLook`: they are experiment metadata, not something the expert can act on.
- The consent text (version `2026-11-v3`) tells experts that some questions show extra background chosen at random.
- Arm is stored on an anonymous Round-2 row. That is one of three values and cannot identify anyone, but it does add a little information to a row; stated here rather than hidden.

## Known limits of the design

- **A control expert can infer they are in control.** A keyed expert in `control` is never offered the button, so they can tell they were given nothing. The consent text says some questions show background chosen at random, so this is not hidden, but it could change how they answer. Showing everyone a button that leads nowhere would be worse (it misleads), so it is not done. Device-held experts are always offered the button, because the server cannot know their arm until they open it; a control one is then told there is none.
- **The "no probability" guard is a guard, not a proof.** It rejects percentages, decimals ("0.7"), "x in y", spelled-out odds and rating words used as a probability. A determined author can still hide a number in prose ("the reading is just over two thirds"). A moderator must read the text before Round 1 opens; this is a human step.
- **Rotating `BENCHMARK_BALLOT_SECRET` re-randomises every arm.** The arm is an HMAC under that secret, so changing it in the middle of a round would move people between arms and break the comparison. Rotate only between experiments (`docs/07-deploy.md`).
- **`n` counts pairs, not people.** One expert answering two cards that had background counts twice, so the table is descriptive, with no interval.
- **Opening the background after answering Round 2 is refused**, otherwise "opened it" would not mean "saw it before answering".
- **Saved text can be read back** by staff (`GET /api/staff/cards/:id/second-look`), so an edit starts from the current text. It is locked once Round 1 closes.

## Decisions that belong to ACAPS (not code)

1. **Who writes the content?** The analyst who owns the risk writes the reasoning, sources and the two lists, per card, before Round 1 opens. Without content a card has no second look.
2. **Do they accept randomisation?** Some experts get no background at all. ACAPS has asked the project to make judgement calls like this one itself (`docs/11-questions-for-acaps.md`), so this is not a data or sign-off dependency. The control arm stays in the design as built. It is listed in the judgement-call register (`docs/15`, in progress), where ACAPS has a review and veto window. If ACAPS vetoes it, the feature can still run, but then it can show only whether people move, not whether they move *because* of the background.
3. **Are the "higher" and "lower" lists written by someone other than the author of the ACAPS reasoning?** If the same person writes all three, the "balanced" arm is not independent of the `acaps_view` arm.
4. **Is showing ACAPS's reasoning at all appropriate** given that the study compares the panel with ACAPS? The design keeps it after the first answer and out of the primary endpoint, but the question of whether it belongs in the product is ACAPS's.
