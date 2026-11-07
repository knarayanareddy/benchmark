# The service layer and its privacy guarantees

`packages/service/` wraps the pure core so each guarantee has **one choke point**. This page says what is built, what each guarantee actually rests on, and what is not built. It is written to be checked against `packages/service/test/flow.test.js`.

## Guarantees and where they live

| Guarantee | Choke point | What it rests on |
|---|---|---|
| Panel statistics leave only through one door | `cardRelease()` | Round state comes from the store, never the caller. A release ledger remembers each published snapshot, so asking again returns the same one. Closing a round releases it. |
| No ballot stuffing | `submitEstimate()` | Unique `(card, respondent, round)` in the store; unkeyed estimates are rejected by default (`requireBallotKey`). Round 2 needs a Round-1 answer. |
| Pseudonyms cannot be recomputed from public constants | `ensureAlias()` | HMAC-SHA-256 keyed by `alias` secret; aliases are **stored** per expert x country, so a secret rotation never renames anyone. |
| Anonymous answers are not stored with an identity | `submitEstimate()` | The row holds an HMAC ballot token and no expert id; the time is coarsened to the day. |
| Roster and answers cannot be joined by a reader of one | two stores | `roster` and `answers` are separate stores: separate schemas and roles in Postgres (`db/migrations/`, `db/roles.sql`; `bm_answers` cannot read the roster and `bm_roster` cannot read the answers, checked with `SET ROLE`). |
| One person, one invite, no password | `createInvite()` / `redeemInvite()` | 256-bit token, stored only as a hash, single use (compare-and-set), expiring, bound to a Declaration, level and consent chosen explicitly. |
| Roles are split | `auth.js` | Analyst handles cards and dissent. Only a moderator invites, closes rounds, resolves, reads the audit log and runs retention. |
| Concurrent edits cannot both win | `routeDissent()` etc. | Every transition is a compare-and-set on `version`; the caller must pass the version it saw. |
| An objection cannot silently rewrite a question | `actDissent()` | Rewrite and split create new card versions and retire the parent; the parent keeps its estimates; children are validated by the gate before anything is written. |
| Every staff action is attributable | `answers.audit` | Append-only: the store exposes no update or delete, and Postgres refuses them in a trigger. Expert answers are deliberately **not** logged. |
| Erase and export | `eraseMe()` / `exportMe()` | Anonymous estimates are found by recomputing the ballot token, which needs the secret. Device-held answers can only be found with the device's key, so the device erases them. |
| A returning expert gets back in | `createReinvite()` | A moderator issues a fresh single-use link for an existing account. Level, consent and key mode do not change. Expert sessions last 30 days, staff sessions 12 hours. |
| A safety concern can be acted on, by two people, and the sender is told | `requestBreakGlass()` / `decideBreakGlass()` / `collectBreakGlass()` | Each anonymous objection carries its sender's id sealed (RSA-OAEP) to a **public** key at write time. Opening needs a written reason, a *different* moderator's approval, the private key, and happens within 24 hours, once. The identity is returned to the requester and stored nowhere; the expert gets a notice in their inbox; the audit log records that it happened, not whom. The database also refuses a self-approved request. |
| An anonymous expert's answers cannot be linked to them even by the operator | `issueBlindToken()` / `submitAnonymousEstimate()` | **Device-held key.** The expert's phone keeps a secret and has the service sign a *blinded* token, once per card. The answer is later submitted with that token and **no login**. The service can check the signature is its own and the token is fresh, but cannot connect it to the signing request. Not even break-glass can open it. See the warning on `packages/core/src/blind.js`. |
| Extra background in Round 2 is assigned at random, measured, and cannot be gamed from the client | `openSecondLook()` / `secondLookSummary()` | The arm is `HMAC(ballot secret, card, respondent key)`, never stored with an identity and never sent to the client. Whether an expert opened the background is recorded by the server when it is served; a client cannot set it. The background is locked when Round 1 closes. Summary cells under 5 pairs are withheld. See `docs/08-second-look.md`. |
| A discussion between rounds cannot leak a number, a name or an unread post | `roundtable.js` | One thread per card, opt-in, open only to people who answered Round 1 (a device-held key proves it with its ballot). Every post is read by a moderator before anyone else sees it; moderators and other experts see a label (name, alias, or `Participant N` per card) and never a respondent key or expert id. Posts that state a probability are refused (a guard, not a proof). Round 2 cannot open while a post is waiting. Whether an expert opened the thread is recorded by the server, so Round 2 can be stratified on it. See `docs/09-roundtable-and-credit.md`. |
| A contribution is published, and a person named, only with their own yes for that one item | `publication.js` | Only a keyed author (identified or pseudonymous) can be asked; anonymous and device-held authors cannot, by design. The author controls the final text and chooses decline / uncredited / credited. A **different** moderator must pass a three-point safety check (the database also refuses reviewer = proposer), then a 48-hour cooling-off wait, then an explicit publish. Withdrawal erases the text and the name from the record. The public list carries only the text, the credit line, the question, the country and the day. |
| The schema changes without losing or silently diverging | `migrate.js` | Forward-only, checksummed, one transaction each, under an advisory lock. Editing an applied migration is refused; a failed one rolls back completely. |
| Retention | `applyRetention()` | Raw per-expert rows go N months after a card resolves; released aggregates stay. |

The HTTP layer (`http.js`) adds body-size caps, a token-bucket rate limit on every write, security headers including HSTS, no cookies, and refuses non-https requests behind a proxy. It holds no domain rules.

## The one narrow exception to "nothing attributable is ever public"

`PUBLIC.attributable` stays `false` for every aggregate and for everything the system produces on its own: panel results, ledgers, counts. The single exception is a **publication credit**: a person's name next to one specific contribution they agreed to have published, after a second moderator's safety check and a cooling-off wait, with withdrawal at any time. It is not a leaderboard, a profile or a count, and the public list does not say how many items were offered or declined. Two limits remain true and are stated to the person who is asked: a copy someone already took cannot be recalled, and a named contribution is a risk in a sensitive context (`BENCHMARK_SENSITIVE_COUNTRIES`, a conservative default list that adds a confirmation step and is not a safeguard).

## Residual risk, in plain words

There are three ways to be anonymous, and each one's limits are different. The consent screen shows the expert exactly one of these, rendered from `consent.js` and from what this deployment can really do, and stores a hash of the text shown.

**Anonymous, key held by the service (the default).**

> ACAPS cannot see who you are in normal use. Anyone with server access **and** the deployment secrets could in principle re-link your estimates to you. Safety override: if an anonymous objection you send raises a serious safety or legal concern, two ACAPS moderators together can open the sealed note saying who sent it. You would be told afterwards. Anonymous estimates (the numbers) are never opened this way. Anonymous comments cannot be erased on request.

- The ballot token is `HMAC(secret, card, expert)`. The secret is in neither store, so a database reader alone cannot re-link answers (tested). A person holding the **secret and the roster** can.
- The override needs the break-glass private key, which the running service need not hold. If no public key is configured there is no override, and the consent text says "No safety override is configured".
- The override covers **objections**, not estimates: a safety concern shows up in words, not in a number.

**Anonymous, key held on the device.**

> Nobody at ACAPS or running the service can tell which answers are yours, and nothing can be opened for a safety concern. The network can still show that your device contacted the service around the time an answer arrived, and if you lose your recovery code you cannot revise or erase those answers.

- The service learns **that** an expert took part in a card (it signed a blinded token for them), never which answers are theirs. That participation record sits in the roster, not with answers.
- **Network metadata is a real limit.** An answer arrives from the same phone and network shortly after the signing request. Someone watching the network, or reading server access logs, could correlate them. The service keeps no such logs, but the network between you and it does. Using a different network for the answer, or answering some time after the token was issued, helps; it does not remove the risk.
- A lost recovery code means those answers can no longer be revised or erased. This is the price of nobody else being able to.
- A device-held expert's objections are **not** sealed, so nothing can be opened for them. That is the promise.
- The blind-signature code is textbook RSA-FDH blinding written for this repository and **has not been reviewed by a cryptographer**. Treat the guarantee as unproven until it has been. RFC 9474 is the standard to move to.

**Pseudonymous and known** are as described in `LEVEL_COPY`.

Everywhere:

- Aliases and ballot tokens use **different secrets** and the service refuses to start if they are equal or missing.
- Anonymous dissents carry no key, so they are unlinkable to a person except through the sealed note, and cannot be exported or erased.
- Day-coarse times and a floor of 5 (10 public) reduce what a small panel reveals. They do not make a panel of 5 safe against someone who knows the five people. `leaksBy()` and `identifyingHints()` warn about organisations, job titles, first-person identifiers and uniqueness claims. They are advice, not proof.

## Staff sign-in

Staff arrive through any OpenID Connect provider (`src/oidc.js`): code flow with PKCE, RS256 ID-token verification (signature, issuer, audience, expiry, nonce), single-use state. A valid sign-in is **not** enough: the email must be on the `STAFF_ROLES` allow-list as analyst or moderator, so a new employee at the identity provider gets no access. The session token is handed to the page in the URL fragment, so it never reaches a server log or a Referer header. This is tested against a fake provider (forged signatures, `alg: none`, wrong audience, expired, replayed, unlisted email). It has not been run against a real provider.

## Not built, or not proven

- **Moderators.** The roundtable and the publication check both need people to staff them. The code enforces who must read what; it cannot supply the people, and a thread nobody moderates blocks Round 2 on that card.
- **A contribution sits next to a person while it is offered.** When a moderator offers an objection or post for credit, its text is copied into the roster store so the author can read and edit exactly what would be published. The author is already known to ACAPS (only identified and pseudonymous experts can be offered), and the copy is erased on decline, rejection, withdrawal and account erasure, but the roster store otherwise holds no answers.
- **Writing style.** A moderator reads each post, but typing habits can still point to a person in a small circle. `identifyingHints` warns about named details; it does not remove style.
- **Cryptographic review** of the blind signatures. Until then the device-held key is the weakest-reviewed part of the system.
- **Push tokens** for anonymous Round-2 nudges, and **time-to-submit instrumentation**.
- **Break-glass for anonymous estimates** (by design: not offered) and **for device-held experts** (by design: impossible).
- **Multi-statement transactions.** Each statement is atomic; erase and retention are ordered and idempotent so a retry finishes the job, but they are not one transaction.
- **Rollback migrations.** Migrations are forward-only; a destructive change ships as expand, then contract.
- **A DPIA and a data-sharing agreement.** Calendar-time work, not code. See `docs/06-protocol.md`.
- **A real deployment.** `Dockerfile` and `deploy/` are written but have never been built or run (see `docs/07-deploy.md`). The app has not been installed on a real phone.
