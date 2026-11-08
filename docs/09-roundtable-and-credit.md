# Roundtable and publication credit: design and contract

**Status: built and tested; never used by a real expert or moderator.** The "Implementation notes" at the end record where the build refined this contract. It adapts two ideas from the "Ground Truth Circle" prototype after the methodology review (`docs/08-second-look.md` covers the other adopted idea). Both are Tier B: valuable only if the pilot works, and both need people (moderators) that the repo cannot supply.

Read `docs/05-service-and-privacy.md` first. Every rule below exists to keep those guarantees intact.

---

## Part A. The roundtable (one thread per card, between Round 1 and Round 2)

### What it is
A short, moderated discussion about one question, open **after** Round 1 has closed and **before** Round 2 opens. Its purpose is the Delphi step: experts can say *why* they disagree before they revise.

### Rules (all enforced by the server)
1. **Opt-in per card.** A moderator or analyst enables a thread on a card (`thread.enabled`). Cards without one behave exactly as today.
2. **Only people who answered Round 1 may read or post.** Keyed experts are checked against their Round-1 row. Device-held experts prove it with their blind-signed ballot, which they can only hold if they asked for one, and the server then checks a Round-1 row exists for that token.
3. **Window.** Posting is open while the card is `closed` in round 1 and the thread is enabled. Reading is open from then on (through Round 2) to the same people. Opening Round 2 is **refused while any post is still waiting for moderation** (so nothing is silently lost).
4. **No numbers.** A post may not state a probability, percentage, odds, or a "my estimate is" figure. The guard is `containsProbabilityFigure()` from `@benchmark/core/secondlook`, plus a pattern for "my/our (answer|estimate|forecast|number) (is|was)". It is a guard, not a proof; moderators read every post.
5. **Every post is read by a moderator before anyone else sees it** (`pending` → `approved` | `rejected` with a reason). Moderators see the text, the kind and the display label, **never** an expert id or respondent key.
6. **Identity per post is never *less* private than the expert's own level, and is forward-only:**
   - `identified` → their name (from the roster, copied into the post at write time);
   - `pseudonymous` → their stable alias for the card's country (`ensureAlias`);
   - `anonymous` (service-held) and device-held → `Participant N`, where N is assigned per card by first post (table `thread_participants`). The same person is the same number throughout one thread and nowhere else.
7. **Kinds:** `claim`, `evidence`, `counter`, `question`, `missing_risk`, and `reply` (a reply has a `parentId` pointing at a top-level post; depth is one).
8. **Limits:** 1..600 characters of text; at most 5 posts and replies per respondent per card.
9. **Re-identification warning at write time:** `identifyingHints(text)` is returned to the author (advice, never a block) and shown to the moderator with the post.
10. **Viewing is recorded by the server** (`thread_views`). Round-2 answers on a card with a thread carry `sawThread` (computed server-side). The roundtable and the second look both influence Round 2, so analysis must stratify on both; the primary endpoint (blind Round 1) is untouched.
11. **Erase / export / retention** cover thread data exactly as they cover estimates.

### Module contract: `packages/service/src/roundtable.js`
`export function createRoundtable(ctx)` returns an object with these methods. `ctx` is built by `service.js` (see "Shared context" below).

| Method | Who | Behaviour |
|---|---|---|
| `setThread(actor, { cardId, enabled })` | staff, permission `roundtable.moderate` | Card must be `round 1` and not yet `round 2`. Stores `thread: { enabled }` on the card via `ctx.updateCard`. Audit `roundtable.enable` / `roundtable.disable`. Returns `{ cardId, enabled }`. |
| `openThread(actor, { cardId })` | keyed expert, `roundtable.read` | Validates window, thread enabled, Round-1 row exists (else `ConflictError('you did not answer round 1')`). Records a `thread_views` row once. Returns `{ cardId, statement, canPost, kinds, posts, mine }` where `posts` = approved posts (oldest first) `{ id, kind, parentId, label, text, day, own }` (`own` true if the respondent wrote it) and `mine` = this respondent's own `pending` / `rejected` posts `{ id, kind, text, status, note }`. No respondent key, no expert id, no counts of other participants. |
| `postToThread(actor, { cardId, kind, text, parentId })` | keyed expert, `roundtable.post` | Window must allow posting. Validates with `validatePost` (core). Assigns the label as in rule 6. Inserts a `pending` post. Returns `{ id, status: 'pending', warnings }` (`warnings` = `identifyingHints`). |
| `openAnonymousThread({ cardId, token, signature })` | device-held, no login | Same as `openThread`, respondent key `bt:${token}`, using `ctx.checkBallot`. |
| `postAnonymous({ cardId, token, signature, kind, text, parentId })` | device-held, no login | Same as `postToThread`. Label is always `Participant N`. |
| `listPending(actor, { cardId } = {})` | staff, `roundtable.moderate` | Pending posts oldest first: `{ id, cardId, statement, kind, parentId, label, text, hints, day }`. **No respondent key, no expert id.** |
| `moderate(actor, postId, { approve, note })` | staff, `roundtable.moderate` | `pending` only. `approve === true` → `approved`; otherwise `rejected` and `note` (1..300 chars) is **required**. Audit `roundtable.approve` / `roundtable.reject` with the post id only. |
| `discussionFor(expert)` | inbox | Cards with `thread.enabled`, status `closed`, round 1. Keyed expert: only those they answered in Round 1 → `ctx.cardView(card, { thread: { available: true } })`. Device-held expert: all such cards with `deviceHeld: true` (the device checks). Never includes post counts. |
| `pendingCount(cardId)` | `openRound2` | Number of `pending` posts for the card. |
| `sawThread(cardId, respondentKey)` | estimate submission | Boolean, from `thread_views`. |
| `eraseKey(cardId, respondentKey)` | erase | Removes that respondent's posts, replies to them are kept, participant row and view row. |
| `eraseCards(cardIds)` | retention | Removes every post, participant and view row for those cards. |
| `exportFor(expert)` | export | The expert's own keyed posts `{ cardId, kind, text, status, day }`. Never labels for anonymous posts. |
| `eraseAnonymous({ cardId, token, signature })` | device-held | Same as `eraseKey` for `bt:${token}` after `checkBallot`. Returns `{ removed }`. |

Post document (in `answers.thread_posts`, key `p_<uuid>`): `{ id, cardId, respondentKey, status, kind, parentId|null, label, text, participant|null, at (day-coarse ms), note|null, version }`.

### HTTP routes (wired in `http.js` already)
```
PUT   /api/staff/cards/:id/thread            { enabled }            -> setThread
GET   /api/staff/thread/pending[?cardId=]                           -> listPending
POST  /api/staff/thread/posts/:id/moderate   { approve, note }      -> moderate
POST  /api/thread                            { cardId }             -> openThread        (Bearer expert)
POST  /api/thread/posts                      { cardId, kind, text, parentId } -> postToThread (Bearer expert)
POST  /api/anon/thread                       { cardId, token, signature }     -> openAnonymousThread (NO login)
POST  /api/anon/thread/posts                 { cardId, token, signature, kind, text, parentId } -> postAnonymous (NO login)
POST  /api/anon/thread/erase                 { cardId, token, signature }     -> eraseAnonymous (NO login)
```
Inbox additions: `discussion: [cardView...]` and, on each `openForRevision` card, `thread: { available: boolean }`.

---

## Part B. Publication credit (per item, outside the circle, after a safety review)

### What it is
A way for ACAPS to publish **one specific contribution** (an actioned objection, or an approved roundtable post), and for its author to choose whether to be **named** on it. It is not a leaderboard and not a profile: there is no "Honour Roll", no tier, no count of contributions, and nothing about an expert that is not attached to a specific item they agreed to.

### Rules
1. **No consent, no publication.** Only contributions whose author can be asked may be offered: a keyed (`identified` or `pseudonymous`) expert. Anonymous and device-held contributions cannot be published; the proposal is refused with a clear message (the author cannot consent, by design).
2. **The author controls the final text.** They may edit it. If they choose **uncredited** publication, the text must contain no identifying hints (`identifyingHints(text)` must be empty): an unnamed note with "I am the WFP country director in Juba" is not anonymous.
3. **Three choices:** `decline`, `uncredited`, `credited` (display name 2..80 chars, optional organisation up to 120).
4. **Sensitive contexts.** If the card's country is on the sensitive list (`@benchmark/core/sensitive`, configurable, default conservative), a `credited` choice also requires `acknowledgedRisk: true`. This is an acknowledgement, not a safeguard.
5. **Safety review by a *different* moderator.** The proposer cannot review (service check **and** a database `CHECK`). The reviewer must tick every item of a checklist (`noThirdParties`, `noLocationDetail`, `riskUnderstood`) to approve; otherwise they reject with a reason.
6. **Cooling-off.** Approval starts a 48-hour wait (`publishAfter`). Nothing is published before it, and a moderator must press publish.
7. **Withdrawal at any time** (author): the item leaves the public list at once and its text and credit are **erased** from the record, leaving only `{ id, status: 'withdrawn', day }`. Copies taken by others cannot be recalled; the consent screen says so.
8. **Erase my data** removes all of the person's publications. **Export** includes them.
9. **What the public sees:** `{ id, text, creditLine | null, cardStatement, country, day }`. Day-coarse. No round, no circle, no count of how many were offered or declined.
10. **Every transition is audited** with the publication id only.

### States
`proposed → consented → approved → published`, with `declined`, `rejected`, `withdrawn` as exits. Compare-and-set on `version` for every transition.

### Module contract: `packages/service/src/publication.js`
`export function createPublication(ctx)` returns:

| Method | Who | Behaviour |
|---|---|---|
| `propose(actor, { sourceKind, sourceId })` | moderator, `publication.propose` | `sourceKind` is `'dissent'` or `'post'`. Dissent must be `actioned`, `notified` or `closed` and have a non-null `expert`. Post must be `approved` and its `respondentKey` must start with `id:`. Resolves the author id; refuses otherwise (rule 1). One publication per source (DB unique). Creates `proposed` with `originalText` and `text` = original. Returns `{ id, status }`. |
| `respond(actor, id, { decision, text, displayName, organisation, acknowledgedRisk })` | the author expert, `publication.respond` | Only from `proposed`, only by the author. Applies rules 2-4. `decline` → `declined` (text and credit erased). Else → `consented` with `credit` = `{ mode, displayName, organisation }` or `{ mode: 'uncredited' }`. |
| `review(actor, id, { approve, note, checked })` | moderator, `publication.review` | Only from `consented`; reviewer ≠ proposer. Approve needs all three `checked` flags true → `approved`, `publishAfter = now + 48h`. Otherwise reject with `note` required → `rejected`. |
| `publish(actor, id)` | moderator, `publication.publish` | Only from `approved` and `now >= publishAfter` → `published`. |
| `withdraw(actor, id)` | the author expert | From `proposed`, `consented`, `approved` or `published` → `withdrawn`, erasing text and credit. |
| `listForStaff(actor)` | moderator, `publication.read` | All publications as `{ id, status, sourceKind, cardId, country, proposer, reviewer, text, creditMode, displayName, publishAfter, version }` (no expert id; the reviewer sees the display name only if the author chose to be credited). |
| `listForExpert(expertId)` | inbox | The expert's own non-terminal items: `{ id, status, cardStatement, originalText, text, credit, sensitive, note, publishAfter }` (statuses `proposed`, `consented`, `approved`, `published`, `rejected`). |
| `listPublic()` | public, no login | Rule 9. |
| `eraseExpert(expertId)` | erase | Deletes all that person's publications. |
| `exportFor(expertId)` | export | Their publications with all fields. |

### HTTP routes (wired in `http.js` already)
```
POST  /api/staff/publications                {sourceKind, sourceId}        -> propose
GET   /api/staff/publications                                              -> listForStaff
POST  /api/staff/publications/:id/review     {approve, note, checked}      -> review
POST  /api/staff/publications/:id/publish                                  -> publish
POST  /api/publications/:id/respond          {decision, text, displayName, organisation, acknowledgedRisk} -> respond (Bearer expert)
POST  /api/publications/:id/withdraw                                       -> withdraw (Bearer expert)
GET   /api/public/credits                                                  -> listPublic (NO login)
```
Inbox addition: `publications: [...]` from `listForExpert`.

---

## Shared context (`ctx`) given to both modules
`{ roster, answers, secrets, t(), need(actor, perm), audit(actor, action, target, reason), expertOf(actor), respondentKey(card, expert), estimateKey(cardId, key, round), getCard(id), updateCard(card, patch), checkBallot(cardId, token, signature), ensureAlias(expert, country), cardView(card, extra), isSensitive(countryCode), newId(prefix) }`. Errors come from `./errors.js` (`ValidationError`, `ForbiddenError`, `ConflictError`, `NotFoundError`, `AuthError`).

## Privacy impact (what this must not weaken)
- The release floor, day-coarse times, sealed note, blind ballots and the numbers gate are untouched.
- `PUBLIC.attributable` stays `false` for **aggregates and everything the system produces on its own**. The only attributable public output is a publication the named person explicitly consented to for that one item, after review, with withdrawal. This is a deliberate, narrow exception and is stated in `docs/05-service-and-privacy.md`.
- A device-held expert can read and post in a thread (as `Participant N`) but cannot be offered credit, by design.

## Decisions that belong to ACAPS (not code)
1. Who moderates, how fast, and what "unsafe" means: a thread blocked on an unread queue blocks Round 2.
2. The sensitive-country list and who maintains it.
3. Whether naming is offered at all for a given programme or country.
4. Who the second reviewer is when ACAPS has one moderator.
5. What is published and where: the `/credits` page is a minimal public list, not a publication channel.

---

## Implementation notes (where the build refined this contract)

- **Replies** may answer an approved top-level post on the same card, or the author's own pending post. A reply to a rejected post, a reply, or another card's post is refused with one message that does not say which.
- **Identified experts with no name** on file get `Participant N`, so a label is never less private than the level.
- **Rejection erases** the author's text and name (as decline and withdrawal do). The author keeps the card statement and the reviewer's note.
- **A declined, rejected or withdrawn contribution cannot be offered again** (one publication per source, enforced by the database). That is deliberate: a "no" is not re-asked.
- **Objection text is copied into the roster store** when a contribution is offered, so the author can read and edit exactly what would be published. The author is already known to ACAPS (keyed levels only), and the copy is erased on decline, rejection, withdrawal and erasure of the account. It does mean the roster store, which otherwise holds no answers, briefly holds a contribution next to a person.
- **Moderators do not type ids**: `GET /api/staff/publications/offerable` lists actioned objections and approved posts whose author can be asked and that were not offered yet. It carries no expert id and no respondent key.
- **The 5-posts-per-card cap is check-then-insert.** Two simultaneous posts from one person could exceed it by one. Not fixed: it needs a transaction the stores do not offer.
- **A person who reaches the cap sees "Posting is closed"**, which is not quite accurate; the server's message is the true one.
- **Posting needs an unmoderated queue to stay short.** Round 2 cannot open while any post is pending, so a slow moderator blocks the card.
