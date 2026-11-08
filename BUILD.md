# BUILD.md — start here

**A verified core, a service on Postgres with versioned migrations, staff sign-in, a two-moderator safety override, device-held anonymous ballots, an installable offline-capable React app for experts and staff, and a card-authoring pipeline. Not deployed, and no panel has been run.** What is missing is mostly human decisions: someone with authority has to write the objectives (`npm run worklist`), run the raters (`npm run label`), review the blind-signature code, sign off the DPIA, and run the container files, which have never been executed.

```
$ npm run verify
✓ 1553 unit tests pass
✓ gate audits raw export without fake windows: 0/139 pass raw (no CSV deadline); 49/139 pass all 4 text checks; 3/139 hit structural blockers; 89/139 carry an observable warning (86.2% warn precision on 50 labelled items, 95% interval 69.4–94.5%)
✓ five-state dissent loop, shared loop.js copy, de-identified card ledger, cap-bypass dispatch and anonymous opt-out verified
```

---

## What works right now

| Module | File | State | Proof |
|---|---|---|---|
| **Shared spine** | `packages/shared/` | **Complete** | 18 tests — card, validation, loop, a11y |
| Scoring | `packages/core/src/scoring.js` | **Complete** | Strict `[0, 1]` / `{0, 1, null}` boundary validation, Brier + bootstrap + paired comparison, 14 tests |
| Aggregation | `packages/core/src/aggregate.js` | **Complete** | Pooling + variance-preserving smoothed bootstrap intervals, ≥10-seed Brier skill gate, `releaseAggregate()` (`n ≥ 5`, `<10` order-stat suppression, cohort batching), ACAPS 5×5 bridge, 28 tests |
| The Gate | `packages/core/src/gate.js` | **Complete** | 5 checks (4 structural blockers + `observable` warning calibrated on 50 labelled items), 15 tests |
| Dispatch | `packages/core/src/dispatch.js` | **Complete** | Per-expert weekly cap, string/numeric dissent priority, health, 7 tests |
| Anonymity | `packages/core/src/anonymity.js` | **Complete** | 3 levels, strict allowlist attribution, 9,000-slot / collision-free aliases, order-statistic inversion resistance, HMAC-keyed aliases, persisted alias assignment, ballot tokens, day coarsening, identifying-detail hints, 29 tests |
| Dissent loop | `packages/benchmark/src/dissent.js` | **Complete** | Strict 5-state lifecycle wired to `packages/shared/loop.js`, UUID IDs, contactable-notify guard + addressless day-coarsened `cardLedger()`, versioned transitions, 7 tests + journey script |
| Ingest | `scripts/ingest.py` | **Complete** | 139 blocks / 266 triggers → 104 resolved, matches the benchmark |
| Keyed primitives | `packages/core/src/hmac.js` | **Complete** | Pure-JS HMAC-SHA-256 so aliases and ballot tokens work in a browser and on a server; checked against `node:crypto` and RFC 4231, 3 tests |
| Service | `packages/service/src/service.js` | **Built, runs on memory and Postgres** | Invites, roles, release ledger, ballot tokens, persisted aliases, versioned cards and dissents, audit, erase/export, retention. The same flow suite runs on the in-memory store, in-process Postgres and the real `pg` client over the wire, including concurrent writers. 57 tests. See `docs/05-service-and-privacy.md` |
| Stores | `packages/service/src/store.js`, `pg-store.js` | **Built** | Roster and answers are separate stores. `pg-store.js` is the Postgres adapter (`find` is a jsonb containment query). Exercised by the flow suite above |
| HTTP transport | `packages/service/src/http.js` | **Built** | Body cap, per-write rate limit, security headers and CSP, https enforcement, no cookies, health and readiness probes, static pages, 8 tests |
| Staff sign-in | `packages/service/src/oidc.js` | **Built, tested against a fake provider** | OpenID Connect code flow with PKCE, RS256 ID-token verification, allow-list of staff emails to roles, 6 tests. Not yet run against a real identity provider |
| Expert app | `packages/web/src/expert/` | **Built, clicked through in a browser** | React. The four-step Join wizard (below), inbox, answering, revising, objecting, export and erase, an offline queue that sends when the phone reconnects, the optional second look with equal-weight keep/revise buttons, 35 tests |
| Staff app | `packages/web/src/staff/` | **Built, clicked through in a browser** | Cards, rounds, outcomes with evidence, objections, the safety override (the UI enforces the two-person rule too), invites and re-invites, audit, the second-look background editor (reads back what is saved) and its summary, 26 tests |
| App libraries | `packages/web/src/lib/` | **Built** | The API client, the device key and its recovery code (checksummed, unambiguous), blind-ballot issuance, the offline queue, an IndexedDB store; 10 tests |
| Built apps | `packages/service/test/ui.test.js` | **Built** | The shipped build is served with a strict CSP, no inline code, correct caching, an installable manifest and a worker that never touches the API, 4 tests. Installable on a phone; not yet tried on one |
| Migrations | `packages/service/src/migrate.js` | **Built** | Forward-only, checksummed, one transaction each, advisory lock, adopts a pre-migration database; works over the real `pg` client. 9 tests |
| Safety override | `packages/service/test/breakglass.test.js` | **Built** | A sealed note on each anonymous objection, opened only by two moderators with a written reason inside 24 hours; the sender is told afterwards; the database refuses a self-approved request. Anonymous estimates and device-held keys cannot be opened. 21 tests across three backends |
| Second look | `packages/core/src/secondlook.js` | **Built, checked in a browser** | Optional Round-2 background in three random arms (none / reasons for higher and lower / ACAPS's analysis). Never shows an ACAPS probability (a guard rejects percentages, decimals, odds and rating words); arm is an HMAC of the respondent key, never sent to the client; viewing recorded by the server; locked when Round 1 closes; summary cells under 5 withheld. Pure module: 12 tests. See `docs/08-second-look.md`. **Needs content written by ACAPS** |
| Second look service | `packages/service/test/secondlook.test.js` | **Built** | Service, HTTP and device-held paths on three backends: 51 tests. Two deliberate breaks (the ACAPS number leaked into the content; every answer recorded in one arm) make 7 and 12 fail |
| Blind Round 1 | `packages/service/test/blind-round1.test.js` | **Built** | Rule R9 reversed: no expert-reachable payload (inbox, device key, status, list) carries ACAPS's rating or a pre-filled number, and Round 2 carries none by default (the opt-in switch `BENCHMARK_SHOW_ACAPS_ROUND2=1` needs a protocol amendment), checked on three backends; the page starts empty and Submit stays off until a number is put down; the Round-1 result is ledgered at close and immutable under Round 2. 19 tests (a deliberate leak makes 6 fail) |
| Roundtable rules | `packages/core/src/roundtable.js` | **Built** | Pure post validation: six kinds, 1 to 600 characters, a reply needs a parent, no probability or "my estimate is" figures; 11 tests |
| Roundtable service | `packages/service/test/roundtable.test.js` | **Built, on three backends** | One moderated thread per card between Round 1 and Round 2. Only people who answered Round 1 can read or post (a device-held key proves it with its ballot); every post is read by a moderator first; labels are a name, an alias or `Participant N` per card; no respondent key or expert id in any payload; Round 2 will not open while a post is waiting; `sawThread` is recorded by the server; erase, export and retention cover it. 69 tests. Known gap: the 5-posts cap is check-then-insert, so two simultaneous posts from one person could exceed it |
| Publication credit rules | `packages/core/src/publication.js` | **Built** | The state machine, the author's choice, the three-point safety checklist, the 48-hour wait; 13 tests |
| Publication credit service | `packages/service/test/publication.test.js` | **Built, on three backends** | A contribution is published, and its author named, only with their own yes for that one item: keyed authors only, a different moderator must review (the database refuses reviewer = proposer too), a 48-hour wait, then an explicit publish; withdrawal, decline and rejection erase the text and the name; the public list carries only text, credit line, question, country and day. 80 tests |
| Sensitive countries | `packages/core/src/sensitive.js` | **Built** | A conservative default list that adds an acknowledgement step before someone is named (not a safeguard); `BENCHMARK_SENSITIVE_COUNTRIES` replaces it; 4 tests |
| Roundtable screens | `packages/web/src/expert/roundtable.test.jsx` | **Built, checked in a browser** | The expert's thread (server and device-held), 17 tests |
| Roundtable staff screen | `packages/web/src/staff/roundtable.test.jsx` | **Built, checked in a browser** | Turn a thread on, read and approve or reject waiting posts, 11 tests |
| Credit offer screen | `packages/web/src/expert/credit.test.jsx` | **Built, checked in a browser** | The author's offer: decline, uncredited or credited, with the risk acknowledgement and a two-step withdraw, 14 tests |
| Credit staff screen | `packages/web/src/staff/credit.test.jsx` | **Built, checked in a browser** | What can be offered, the review checklist, publish after the wait, 12 tests |
| Public credits page | `packages/web/src/credits/credits.test.jsx` | **Built, checked in a browser** | `/credits`, no login, read-only, 4 tests |
| Pilot: taxonomy | `packages/core/src/taxonomy.js` | **Built** | Themes, regions, role types, and the country-to-region and text-to-theme mappings. The mappings are heuristics that ACAPS should confirm; 10 tests |
| Pilot: risk radar rules | `packages/core/src/radar.js` | **Built** | Normalises the organisers' export. The neutral view an expert gets is exactly seven fields; the theme is classified from the title only; 17 tests |
| Pilot: Pulse rules | `packages/core/src/pulse.js` | **Built** | Why a card is asked (labels only), thin circles first, then newer cards, up to the person's own weekly cap; 22 tests |
| Pilot: risk radar service | `packages/service/test/radar.test.js` | **Built, on three backends** | An expert's analysis is held back only while a live card (open or closed; a retired card counts as neither) on that risk is put to them (it matches their declared countries, regions and themes, the inbox's `matches` rule) and they have not answered it; a device-held expert is held back by any matching live card; staff always see everything, and an expert never asked a question on a risk sees it in full; `GET /api/cards/:id/release` refuses an expert while Round 1 is open, and later one who has not answered Round 1 on an unresolved card (403); in Round 2 it returns the Round-1 result, never the live Round-2 one; staff always get the full view; the timeline rides only on the full view, never on a neutral view or a list row; a card's risk id must exist in the radar; 75 tests |
| Pilot: profile service | `packages/service/test/profile.test.js` | **Built, on three backends** | An expert's organisation and role type are visible only to them and are never in the audit log or the answers store; saving is all-or-nothing; erase and export cover them; 60 tests |
| Pilot: Pulse service | `packages/service/test/pulse.test.js` | **Built, on three backends** | Pulse never shows a card the inbox would not; the dispatch preview shows labels only (no ids, organisation or role) and reports `answered` only for keyed experts; 51 tests |
| Ported screens: data service | `packages/service/test/port-data.test.js` | **Built, on three backends** | The ACAPS reading appears only on Round 2 (never on a Round-1 payload); the Pulse circle counts the first declared country only, leaves out uninvited people, and shows nothing below five; the expert's own record (answered, revised, objections) is never on a staff route or another expert's view; 30 tests |
| Ported screens: release access | `packages/service/test/release-access.test.js` | **Built, on three backends** | `GET /api/cards/:id/release` refuses an expert while Round 1 is open, and later one who has not answered Round 1 on an unresolved card (403); in Round 2 it returns the Round-1 result, never the live Round-2 one, and a device-held expert until the card resolves; staff always read it; the HTTP route enforces the same rule; 18 tests |
| Pilot: demo mode service | `packages/service/test/demo.test.js` | **Built, on three backends** | Off by default; demo joins are real accounts with the real consent text; seeded cards and the synthetic panel are flagged `demo`; the seed is idempotent; staff credentials are random per boot and printed to the console only; `/api/config` returns exactly four booleans, `{demo, deviceKeys, breakGlass, demoLabels}`, never key material; `DATABASE_URL` is refused unless `BENCHMARK_DEMO_ALLOW_DATABASE=1`; 85 tests. A seed that fails part-way is not resumed |
| Pilot: expert profile screen | `packages/web/src/expert/profile.test.jsx` | **Built, checked in a browser** | The profile form and My profile; 12 tests |
| Pilot: Pulse screen | `packages/web/src/expert/pulse.test.jsx` | **Built, checked in a browser** | Asked of you this week, with the reasons; radar; empty and error states; 31 tests |
| Ported: Round-2 picture | `packages/web/src/expert/picture.test.jsx` | **Built** | The Round-1 and revision bar: every number written out as text, no meaning carried by colour, the revised marker only after a saved revision; no "80% interval" or "performance-weighted" wording; 10 tests. Not checked in a browser |
| Ported: question page | `packages/web/src/expert/questionpage.test.jsx` | **Built** | The question frame: breadcrumb back to Pulse, closing date (no window, no date), answer card in place, Next question; 7 tests. Not checked in a browser |
| Ported: sign-out | `packages/web/src/expert/signout.test.jsx` | **Built** | Signing out empties the offline queue and forgets the privacy label, so the next person on the phone sees nothing of the last; 3 tests |
| Ported: sign-out queue | `packages/web/src/lib/signout.test.js` | **Built** | `clearQueue` forgets every waiting answer, including its context; 1 tests |
| Pilot: risks screen | `packages/web/src/expert/risks.test.jsx` | **Built, checked in a browser** | Search and filters, the list and the detail page; the analysis is shown only once a risk's questions are resolved, and the timeline only on the full view; 37 tests. Not checked in a browser: an expert's view of a resolved risk's timeline |
| Pilot: dispatch lab screen | `packages/web/src/staff/dispatch.test.jsx` | **Built, checked in a browser** | Pick a risk, read its analysis and its timeline, draft a card (handed to Cards), preview who would be asked; 15 tests. The risk detail with a real timeline (Hezbollah/Lebanon) was checked in a browser |
| Situation timelines: rules | `packages/core/src/timeline.js` | **Built** | Pure: the dated trigger history and rationale updates as recorded by ACAPS, with same-day conflicts flagged and no lag or duration computed; 16 tests |
| Panel series: rules | `packages/core/src/series.js` | **Built** | Points for each released round with its interval; a round below the floor of 5 (which a caller cannot lower) is withheld with no number; 12 tests |
| Regional grid: rules | `packages/core/src/grid.js` | **Built** | Radar risks and cards by region and theme, with cells under 10 marked descriptive only; no expert or answer data; 15 tests |
| Analyst links: rules | `packages/core/src/links.js` | **Built** | A link needs a mechanism and a rival explanation (20 to 500 characters each), two different cards, and is never inferred; walks the chain with a depth cap of 3; 19 tests |
| Situation evolution service | `packages/service/src/evolution.js` | **Built, on three backends** | Staff only. The panel series reads closed panel ledger documents only and never writes; the grid; moderator-only analyst links whose audit row holds the link id only. 72 tests. Not done in a browser: creating and removing links, a series for a card with two closed rounds |
| Review hardening service | `packages/service/test/hardening.test.js` | **Built, on three backends** | Preview rows sorted by content; split and rewrite children keep the risk id and demo flag; the typed name is kept for service-held anonymous experts and cleared for device-held ones; a profile save cannot recreate an erased account; demo content cannot be offered for publication; 33 tests |
| Staff Evolution screen | `packages/web/src/staff/evolution.test.jsx` | **Built, checked in a browser** | The panel series over the rounds with intervals and withheld rounds, the regional grid in a sideways-scrolling table, and the links form shown. Checked at 1180px and 390px on the real server; links were not created in the browser; 30 tests |
| Timeline component | `packages/web/src/components/timeline.test.jsx` | **Built, checked in a browser** | The risk's timeline on the full view only; checked on the staff Dispatch risk detail with real data. Not checked in a browser: an expert's view of a resolved risk's timeline; 9 tests |
| Step chart component | `packages/web/src/components/stepchart.test.jsx` | **Built** | An accessible SVG step chart with a title, description and data-table alternative, used inside the timeline (seen in the Dispatch browser check); 11 tests |
| Pilot: demo banner | `packages/web/src/demo.test.jsx` | **Built, checked in a browser** | The demo banner and the demo entry points, including the staff credentials shown in demo mode. The demo join's form moved to the Join wizard; 25 tests. Not checked in a browser: Round 2 flows in demo mode, and a device-held demo join |
| Onboarding rules | `packages/core/src/onboarding.js` | **Built** | The pure rules behind the Join wizard: country names and search, the three visibility cards built from `LEVEL_COPY` (the same source as the consent text), the recommended level with its reason, step validation, invite-link parsing; 34 tests. Advice is labelled as advice; the server still enforces what matters |
| Onboarding pickers | `packages/web/src/components/chips.test.jsx` | **Built, checked in a browser** | `StepPills`, `ChipGroup` (single and multiple choice, a max that disables the rest) and `CountryPicker` (search by name, selected countries first, a count), used by the Join wizard; 20 tests |
| Join wizard | `packages/web/src/expert/join.test.jsx` | **Built, clicked through in a browser in demo mode only** | The four-step "Join the circle" flow that replaces the one-screen consent form: expertise, visibility, rhythm and confirmation, the consent text and the device-held key with its recovery code. Clicked through in headless Chrome in demo mode (expertise, visibility, confirm, join). Not clicked through: the pilot invitation path, the device-held path in a browser, and a phone-width pass beyond screenshots. There is no verification-evidence step. A failed profile save is not shown: the person lands on the profile setup screen. 38 tests |
| Round-1 answer card | `packages/web/src/expert/question.test.jsx` | **Built, checked in headless Chrome at 1180px and 390px on the real server in demo mode** | The Round-1 card (`CardView`): a new expert joined, the resolution details opened, confidence, reason and basis filled, the identifying-detail warning shown. Optional context is sent only when given, and the level is shown, not chosen. Not browser-checked: submitting the answer, the device-held path, the offline queue, and Round 2. 15 tests |
| Answer context service | `packages/service/test/answer-context.test.js` | **Built, on three backends** | Optional confidence, evidence basis, conflict-of-interest box and reason on a first answer, for keyed, device-held and service-held anonymous experts, and over HTTP. Contact details are removed from the reason before storing. The context is absent from the release, the staff card list, the second-look summary, the expert list and the audit log; it is in the expert's export and erased with the account. The inbox gives the resolution (objective, source, resolver) and no ACAPS band or probability. 30 tests |
| Answer context queue | `packages/web/src/lib/context.test.js` | **Built** | The offline queue keeps each answer's context; the server and device-held request bodies carry it only when there is one. 8 tests |
| Device-held ballots | `packages/service/test/device.test.js` | **Built, needs cryptographic review** | Blind RSA signatures: an expert's answers cannot be linked to them by the operator, and one token per card is still enforced. 33 tests across three backends |
| Blind signatures | `packages/core/src/blind.js` | **Built, unaudited** | RSA full-domain-hash blinding in BigInt for browser and server, checked against Node's native RSA, 6 tests. Read the warning at the top of the file before relying on it |
| Postgres schema | `packages/service/db/migrations/` | **Built, verified on a real engine** | Constraints for unique ballots, clamped probabilities, the release floor, an append-only audit log; two least-privilege roles in `roles.sql` that cannot read each other's schema, checked with `SET ROLE`, 10 tests |
| Statistics | `packages/core/src/stats.js` | **Complete** | Wilson intervals and Cohen's kappa against published values, 4 tests |
| CSV | `packages/core/src/csv.js` | **Complete** | RFC 4180 parser and writer; round-trips the real worklist, 6 tests |
| Authoring | `packages/core/src/authoring.js` | **Complete** | Triage of every headline and trigger, one card-validation rule shared with the service, a filled-worklist importer, and a two-rater scorer that refuses disagreeing raters, 9 tests |
| Deployment | `Dockerfile`, `deploy/` | **Not verified: CI job added, not green yet** | Compose file for Postgres + service + Caddy (automatic HTTPS). The `docker` workflow builds the image, runs the migration, starts Postgres and the service (not Caddy), and checks `GET /api/config`; its first run failed at the migration step. Not checked: Caddy and HTTPS, real SSO, backup and restore. The image copies `data/risk-radar.json`; the compose file needs no radar mount. See `docs/07-deploy.md` |

---

## The two findings already in the repo

Both came from running the code, not from reading.

**1. Raw Risk Radar headlines are not forecast-ready cards until gated — and lexical observability belongs as a warning, not a silent blocker.** `risk-radar-export.csv` carries no resolution deadline column on risk rows (`139/139` fail the `window` blocker when audited without synthetic inputs). Across the four prose checks, **3 of 139** headlines hit hard structural blockers (`single` / `no_leak`), **49 of 139** pass all four prose checks cleanly, and **89 of 139** trigger an `observable` authoring warning (`dispatchable: true` once given a window, prompting an analyst-written `objective`). Audited against 50 labelled ACAPS statements (`packages/benchmark/test/fixtures/observable-labelled-50.json`), the lexical `observable` check achieves **86.2%** warn precision (`25/29`) with a **22.2%** false-warn rate (`4/18`, e.g. ACLED-resolvable clashes in `R1067`) — which is why `gate()` surfaces `observable` as `SEVERITY.WARNING` rather than blocking valid conflict cards.

**2. The harness reproduces the benchmark independently.** On the 104 resolved blocks, a constant base-rate predictor scores **0.2425** — exactly the naive floor from the earlier calibration work. That is an independent confirmation that the ingest, the outcome mapping and the Brier implementation are all correct.

---

## Commands

```bash
python3 scripts/ingest.py       # CSV → data/risk-radar.json (uses Python's csv module)
node --test packages/benchmark/test/*.test.js
node scripts/gate-export.mjs    # acceptance test #9
node scripts/journey.mjs        # acceptance test #7
node scripts/backtest.mjs       # the scoring harness
npm run serve                   # the HTTP service; needs BENCHMARK_BALLOT_SECRET and BENCHMARK_ALIAS_SECRET
node packages/service/bin/migrate.mjs --status   # which database migrations are applied
```

**Do not hand-roll a CSV parser.** The export has quoted fields with embedded newlines; a naive line-splitter turned 139 rows into 5,970 and silently misaligned every column. Python's `csv` module is correct and free — use it.

---

## The one thing that is still missing, and it is not code

**The panel has never been run — and the baseline it must beat is ACAPS' own 0.2171, not the regression's 0.2177.** The regression is nominally behind the analysts by 0.0007 and **indistinguishable from them** (paired interval [−0.026, +0.029]); that is measured, in this repo, by `scripts/fit-baseline.mjs`.

`scripts/backtest.mjs` runs synthetic predictors on the 104 resolved blocks to prove the scoring plumbing, and `packages/core/src/aggregate.js` turns panel estimates into an interval-bearing probability. Two methodological constraints govern how the real panel test must run:

1. **Prospective, not retrospective (hindsight contamination).** An earlier draft proposed asking human country specialists to score the 104 already-resolved historical risks retrospectively. That is invalid as an accuracy test: specialists in late 2026 already know whether 2021–2025 crises (Taliban provincial-capital offensives, Sudan, Gaza) materialised. The 104 resolved rows establish the incumbent baselines (`0.2425` / `0.2171` / `0.2177`); the human panel must be evaluated **prospectively** on unresolved statements (the **28 Active risks** and the **76** triggers under them as rolling windows close; the other 190 of the 266 triggers sit under risks whose outcome is already known).
2. **The power basis for the panel comparison is not yet set.** The SD of **0.1605** (`scripts/measure-baseline.mjs`) is the SD of ACAPS minus a constant base-rate forecast on the 104 resolved risks, not of panel minus ACAPS, so the 0.0441 minimum detectable effect and the **n ≈ 506** figure built on it are withdrawn. Only the **28** Active risks carry an ACAPS rating, so a head-to-head against ACAPS is at risk level. The **76** triggers under those risks have no ACAPS probability and are scored against outcomes and a base rate. About **104** statements (28 + 76) are open to prospective scoring today. The power analysis is in progress (`docs/14`, not yet written); [`docs/06-protocol.md`](docs/06-protocol.md) has the current position.
3. **External resolution criteria, not endogenous post-hoc labels.** In `risk-radar-export.csv`, `Materialised` / `Not materialised` is recorded later by ACAPS' own analysts on a selected set of published risks (`61/104 = 58.7%` materialised), measuring analyst self-consistency alongside forecast skill. Prospective trigger evaluation must pre-specify external indicators (ACLED, IPC, UNHCR, IMF) in `objective` before cards open.

---

## Hard rules

- **No leaderboard.** Panel scores public, individual scores private.
- **Tiered small-cell, order-statistic & temporal differencing suppression.** Released analyst and Round-2 views go through `releaseAggregate()` (`MIN_RELEASE_PANEL_SIZE = 5`, matching `anonymity.js`'s `< 5` rule), use variance-preserving smoothed bootstrap intervals (so `[lo, hi]` never collapses onto raw `[min, max]`), suppress `q25`/`q75`/`iqr`/`min`/`max`/`spread` below `n = 10` (so linear quartile systems cannot invert individual answers), and update only at Round-1 close (`on_close`) or in `≥ 3`-respondent cohorts (`batch`). Public outputs enforce `PUBLIC.minCount = 10` (`anonymity.js`), showing cross-country regional/thematic rollups rather than single-country cells.
- **Every score renders with its interval.** There is no code path that returns a naked point estimate.
- **Unobservable ≠ miss.** `scoring.js` excludes `null` outcomes; it never counts them as failures.
- **The Declaration decides who is asked, never how much weight an answer carries.** No released aggregate weights by track record (amended 7 Nov 2026; `docs/02`, R8). The pure core still has an unused `seedWeights()` in `packages/core/src/aggregate.js`, reachable only through an optional `seedHistory` argument that nothing passes.
- **90 seconds is the per-card target budget, not a measured user study.** Onboarding (`E2`) runs once, post-submission context (`E4`) and Round 2 (`E6`) are conditional, and receipts (`E7`) arrive at resolution; timing of the recurring question card (`E3`) requires live usability testing.

---

## What the data turned out to be (added after the first full pass)

Three things were established by writing scripts rather than by reading numbers,
and all three change what the product argues:

**1. 139 is the whole corpus.** The organisers' data README confirms it: 139
risks, 57 countries, 28 active / 61 materialised / 43 not / 7 unrecorded. Our
ingest reproduces every one of those figures. There is no larger dataset to
"resolve" against — the 139 risks carry **266** dated trigger statements, and
the 266 is where the volume is. Only the 76 triggers under the 28 Active risks are open to prospective scoring; the other 190 sit under risks whose outcome is already known.

**2. Risk Level is a pure function of Probability alone — 128 of 128 rows.**
ACAPS publishes a 5×5 in `organiser/acaps/risk-methodology.md` (*Risk =
Probability × Impact*) where Impact moves the level. Applied to the **125** rows
carrying all three fields, it holds on **97** and departs on **28** (22 higher
than the matrix, 6 lower). Across all **19** occupied `(Probability, Impact)`
cells, not one is mixed — every departure is the arithmetic of a lookup table
that maps Probability to Risk Level and ignores Impact (an earlier revision of
this file misread those 28 rows as analyst overrides; the 22 resolved departures
materialise at 0.73 vs 0.68 expected from Probability alone, +4.4 points on
n=22). Impact is collected and discarded, and a model reading Probability *and*
Risk Level is reading one field twice.

**3. The baseline had to be re-measured, and the answer is unflattering.**
naive floor **0.2425** → ACAPS' own rating **0.2171** → logistic regression on
the same fields **0.2177** out of sample. The regression is nominally behind, **indistinguishable at n=104**. In-sample it
scores 0.1965, and that number must never be quoted: its optimism is larger than
the entire effect under test. `npm run ladder` reproduces all of it.

**The rule this produced:** no quantitative claim in this repo may appear without
a script that regenerates it. `scripts/numbers-gate.mjs` fails CI if a retired
figure reappears or if `LADDER` drifts from the fitted artefact. It exists
because a hand-typed 0.2204 was, for three weeks, silently the regression's own
score wearing the analyst's name.
