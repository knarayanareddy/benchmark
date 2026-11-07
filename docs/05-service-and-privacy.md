# The service layer and its privacy guarantees

`packages/service/` wraps the pure core so each guarantee has **one choke point**. This page says what is built, what each guarantee actually rests on, and what is not built. It is written to be checked against `packages/service/test/flow.test.js`.

## Guarantees and where they live

| Guarantee | Choke point | What it rests on |
|---|---|---|
| Panel statistics leave only through one door | `cardRelease()` | Round state comes from the store, never the caller. A release ledger remembers each published snapshot, so asking again returns the same one. Closing a round releases it. |
| No ballot stuffing | `submitEstimate()` | Unique `(card, respondent, round)` in the store; unkeyed estimates are rejected by default (`requireBallotKey`). Round 2 needs a Round-1 answer. |
| Pseudonyms cannot be recomputed from public constants | `ensureAlias()` | HMAC-SHA-256 keyed by `alias` secret; aliases are **stored** per expert x country, so a secret rotation never renames anyone. |
| Anonymous answers are not stored with an identity | `submitEstimate()` | The row holds an HMAC ballot token and no expert id; the time is coarsened to the day. |
| Roster and answers cannot be joined by a reader of one | two stores | `roster` and `answers` are separate stores: separate schemas and roles in Postgres (`db/schema.sql`, `db/roles.sql`; `bm_answers` cannot read the roster and `bm_roster` cannot read the answers, checked with `SET ROLE`). |
| One person, one invite, no password | `createInvite()` / `redeemInvite()` | 256-bit token, stored only as a hash, single use (compare-and-set), expiring, bound to a Declaration, level and consent chosen explicitly. |
| Roles are split | `auth.js` | Analyst handles cards and dissent. Only a moderator invites, closes rounds, resolves, reads the audit log and runs retention. |
| Concurrent edits cannot both win | `routeDissent()` etc. | Every transition is a compare-and-set on `version`; the caller must pass the version it saw. |
| An objection cannot silently rewrite a question | `actDissent()` | Rewrite and split create new card versions and retire the parent; the parent keeps its estimates; children are validated by the gate before anything is written. |
| Every staff action is attributable | `answers.audit` | Append-only: the store exposes no update or delete, and Postgres refuses them in a trigger. Expert answers are deliberately **not** logged. |
| Erase and export | `eraseMe()` / `exportMe()` | Anonymous estimates are found by recomputing the ballot token, which needs the secret. |
| Retention | `applyRetention()` | Raw per-expert rows go N months after a card resolves; released aggregates stay. |

The HTTP layer (`http.js`) adds body-size caps, a token-bucket rate limit on every write, security headers including HSTS, no cookies, and refuses non-https requests behind a proxy. It holds no domain rules.

## Residual risk, in plain words

This is what the choice screen shows an anonymous expert (`consent.js`), and it is the honest limit of the design:

> ACAPS cannot see who you are in normal use. Anyone with server access **and** the deployment secrets could in principle re-link your estimates to you. Anonymous comments cannot be linked back to you, so they cannot be erased on request.

Concretely:

- The ballot token is `HMAC(secret, card, expert)`. The secret is never stored in either store, so a database reader alone cannot re-link answers (tested). A person holding the **secret and the roster** can. A client-held ballot secret would remove even that; it is not built.
- Aliases and ballot tokens use **different secrets** and the service refuses to start if they are equal or missing.
- Anonymous dissents carry no key, so they are unlinkable by design, which is also why they cannot be exported or erased.
- Day-coarse times and a floor of 5 (10 public) reduce what a small panel reveals. They do not make a panel of 5 safe against someone who knows the five people. `leaksBy()` and `identifyingHints()` warn about organisations, job titles, first-person identifiers and uniqueness claims. They are advice, not proof.

## Staff sign-in

Staff arrive through any OpenID Connect provider (`src/oidc.js`): code flow with PKCE, RS256 ID-token verification (signature, issuer, audience, expiry, nonce), single-use state. A valid sign-in is **not** enough: the email must be on the `STAFF_ROLES` allow-list as analyst or moderator, so a new employee at the identity provider gets no access. The session token is handed to the page in the URL fragment, so it never reaches a server log or a Referer header. This is tested against a fake provider (forged signatures, `alg: none`, wrong audience, expired, replayed, unlisted email). It has not been run against a real provider.

## Not built

- **Break-glass** for safety concerns on anonymous records (two-person approval, written reason), **client-held ballot secrets**, **push tokens** for anonymous Round-2 nudges, **time-to-submit instrumentation**.
- **A React app.** The pages are plain HTML and JS served by the service; they work, and were clicked through in a browser, but there is no offline PWA behaviour.
- **Versioned database migrations.** `bin/migrate.mjs` creates the schema if it is absent. A later schema change needs a real migration step.
- **Multi-statement transactions.** Each statement is atomic; erase and retention are ordered and idempotent so a retry finishes the job, but they are not one transaction.
- **A DPIA and a data-sharing agreement.** Calendar-time work, not code. See `docs/06-protocol.md`.
- **A real deployment.** `Dockerfile` and `deploy/` are written but have never been built or run (see `docs/07-deploy.md`).
