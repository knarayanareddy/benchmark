# Benchmark — staff review (gstack `/review` · `/cso` · `/qa`)

**Target** `298db1b` on `arena/1fc69471-benchmark` · Node 22.22.3 · Python 3.11.2
**Method** Every file in `packages/` and `scripts/` read line by line; `npm run verify` run on the working tree **and** on a fresh `git clone`; `ingest.py` and `ladder` re-run and diffed; then ~70 adversarial probes executed against every exported function. **[run]** = reproduced by executing code. **[read]** = proven by inspection only. Numbers below are outputs, not recollections.

---

## Verdict

The analytic core is the best-disciplined part of this repo and better than most: 2,080 lines of dependency-free pure logic, 101 deterministic tests, a byte-reproducible ingest, a fitted-and-gated baseline ladder, and documentation that argues against its own product.

**But the repo has a hole in the middle, and it is the hole the challenge is graded on.** There is no interface, no store, no auth, no delivery path, and no resolution workflow — so the three Must Haves (easy to use / expert-controlled anonymity / public anonymity) are, today, a pure-function library plus a static HTML file that cannot even be opened as a file because it imports ES modules over `file://`.

**Do not demo this to ACAPS until S1, S2, S3, C1, C3 and B6 are fixed (≈ half a day).** Each of those is a *fail-open privacy or correctness path* that a good juror will find in ninety seconds — and every one of them currently has a passing test or a passing gate sitting on top of it. That combination ("green CI over a fail-open path") is the single most dangerous pattern in the repo, and it recurs in six different files.

### Scorecard

| Area | State | Evidence |
|---|---|---|
| Pure domain logic (scoring, pooling, dedup) | **Strong** | exact definitions, bounded, property-swept, intervals mandatory |
| Dissent state machine | **Good** | strict transitions, UUIDs, cap bypass — two silent-loss holes (C6, C7) |
| Identity / anonymity | **Fail-open in 4 places** | S1, S2, S3, S4 |
| Evaluation integrity (R2/R5) | **Spec contradicts code** | C1, C2, R1, R2 |
| Reproducibility gates | **Strong concept, partial coverage** | R3, G1–G3 |
| Product surface | **Absent** | B1–B5, plus B6 (a promise nothing keeps) |
| CI | **Green, honest, ~14 s** | but never runs the documented command (G4) |
| Docs | **Best-in-class honesty, drifting numbers** | R2, R4, R5 |

### Findings index

| ID | Sev | Area | Finding |
|---|---|---|---|
| B1 | **P0** | Surface | No interface, and the one demo asset cannot be opened |
| B2 | **P0** | Architecture | No persistence: snapshots, ballots, dissent, ledger have no home |
| B3 | **P0** | Architecture | No identity/auth boundary — anonymity trusts its caller |
| B4 | **P1** | Architecture | No delivery transport, and `perWeek` has no definition of a week |
| B5 | **P1** | Architecture | No prospective resolution workflow (R4/R5 unimplementable) |
| B6 | **P0** | Ethics | Copy promises a "sealed record" that does not exist |
| S1 | **P0** | Privacy | `attribute()` copies a generic `id` into ANONYMOUS payloads |
| S2 | **P0** | Privacy | A missing anonymity level fails **open** to pseudonymous |
| S3 | **P0** | Privacy | Pseudonymous alias silently falls back to the public dev salt |
| S4 | P1 | Privacy | `leaksBy()` — "the failure mode nobody tests" — is wired to nothing |
| S5 | P2 | Privacy | Pseudonymous contributions keep a second-precision timestamp |
| S6 | P2 | Privacy | Object-as-map hazards: `__proto__` id → `by: {}` |
| S7 | P2 | Privacy | `publicable()` publishes un-countable and `NaN` cells |
| C1 | **P0** | Correctness | Gate accepts past, zero-length and unbounded resolution windows |
| C2 | P1 | Correctness | R5's "caught by the gate" is not enforced at dispatch |
| C3 | P1 | Correctness | `suppress()` publishes cells with a missing count |
| C4 | P1 | Correctness | `releaseAggregate()` throws on shrinkage; carries a foreign snapshot |
| C5 | P1 | Correctness | `dispatch()` counts deferrals against the weekly cap |
| C6 | P1 | Correctness | A declined dissent leaves no trace on the card |
| C7 | P1 | Correctness | Identified dissent with a missing expert is silently uncontactable |
| C8 | P2 | Correctness | `paired()` silently drops unmatched ids (n shrinks, no warning) |
| C9 | P2 | Correctness | Invalid bootstrap options → `NaN` bounds that serialise as `null` |
| C10 | P2 | Correctness | `acapsRiskLevel()` never checks `lo ≤ hi` |
| C11 | P2 | Correctness | A round-2-only submission is accepted (R6) |
| C12 | P2 | Correctness | Card renders `undefined`; `close()` is not idempotent |
| C13 | P3 | Correctness | `health()` reports rate 2; `rate()` reports −0.2 |
| C14 | P3 | Correctness | `strict(schema, null)` throws TypeError |
| C15 | P3 | Correctness | Zero-width intervals at n≤3 are returned as if informative |
| R1 | P1 | Integrity | R2 pre-registers 10,000 resamples; the release path uses 2,000, unrecorded |
| R2 | P1 | Integrity | "SE ≈ 0.04–0.05 at n=104" is wrong by 2–5× and it is load-bearing |
| R3 | P1 | Integrity | The numbers gate does not gate ~8 published figures |
| R4 | P2 | Integrity | `17%` / `51%` are unverified empirical claims under a rule forbidding them |
| R5 | P3 | Docs | Doc drift no gate can see |
| R6 | P2 | Integrity | LOO-CV leaks the held-out row through global imputation means |
| G1 | P2 | Gates | `check-spine` treats a new shared file as benign — verified |
| G2 | P2 | Gates | `gate-privacy` misses `node:https`, `globalThis.fetch` — verified |
| G3 | P2 | Gates | `numbers-gate`'s excusal regex is file-scoped — verified |
| G4 | P2 | Gates | `gate-anonymity`'s "is it wired?" is a substring grep |
| G5 | P3 | CI | CI never runs `npm run verify`; no `permissions:`; tags not SHAs |
| G6 | P3 | Packaging | No workspace; `packages/benchmark` has no `package.json` |
| D1 | P2 | Data | Two byte-identical 1.5 MB exports; only one is read |
| D2 | P3 | Data | A silently truncated `triggers` blob is committed and unused |
| D3 | P3 | Data | The band boundary at p = 0.2 is an untested convention |

---

## A · Ship blockers

### B1 — There is no interface, and the one demo asset cannot be opened
**Where** `BUILD.md:26`; `mockups/benchmark-expert-flow.html:317-318`; `package.json` (no `serve` script).

**What** `BUILD.md` lists Interface as *Not written*. The only rendered artifact imports live modules:
```js
import { LEVELS, LEVEL_COPY, DEFAULT_LEVEL } from '../packages/core/src/anonymity.js';
import { releaseAggregate } from '../packages/core/src/aggregate.js';
```
Opened from disk (`file://`), a browser blocks both imports as cross-origin. The file degrades to its `<noscript>` copy, so **the anonymity panel the jury is meant to touch is not the module** — it is static text. There is no `npm run serve`, no `docs/index.html`, and no line in `README.md` telling a reader to start a server. `grep -rn "createServer\|http.server"` over the repo returns nothing. [run]

**Why it matters** Deliverable #1 is a working demo. Today the demo requires the reader to guess a document root and invent a server, and the repo's preview environment (bind `0.0.0.0`, accept the proxied Host) has the same requirement.

**Fix** 20 lines, zero dependencies:
```js
// scripts/serve.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
                '.json':'application/json', '.css':'text/css', '.svg':'image/svg+xml' };
http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = path.resolve(ROOT, url === '/' ? 'mockups/benchmark-expert-flow.html' : '.' + url);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found'); return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(4173, '0.0.0.0', () => console.log('http://localhost:4173'));
```
```json
"scripts": { "serve": "node scripts/serve.mjs" }
```
Add to `npm run verify` a 10-line smoke test that `GET /` is 200 + `text/html` and `GET /packages/core/src/anonymity.js` is `text/javascript`; put `npm run serve` in the README's first screen. The `startsWith(ROOT + sep)` check blocks traversal.

### B2 — No persistence layer, so nothing in the system can actually run
**Where** all of `packages/`; `BUILD.md:20-31`.

**What** Every module is pure or in-memory. There is no card store, ballot store, dissent store, snapshot store, ledger store, or audit log. Three consequences that are not obvious from "UI not written":
- `releaseAggregate({ previousSnapshot })` — the sequential-differencing guard — has **no producer**. No code in the repo ever constructs a snapshot to pass it.
- The five-state dissent machine has no home: `_next` must be persisted by a caller that does not exist, so `notify()`'s guard can be bypassed by any caller that keeps only the last state.
- `dispatch(candidates, cap, history)` needs `history`, which nothing records. C5 proves what happens when a plausible history is supplied.

**Fix** One module, one interface, storage-agnostic:
```js
// packages/benchmark/src/store.js
//   submitCard(card) -> cardId
//   recordBallot({ cardId, round, expertId, p, level, at }) -> ballot
//   listBallots(cardId) / snapshotFor(cardId, round) / saveSnapshot(cardId, round, snap)
//   saveDissent(d) / loadDissent(id) / appendLedger(entry) / appendAudit(event)
// Backing: node:sqlite (Node 22) in prod; a Map in tests. Never a bare JSON file in prod.
```
Bind snapshots to `cardId` (see C4) and make every write return the persisted row, so a caller cannot act on an object the store did not accept.

### B3 — No identity or auth boundary: anonymity is only as good as its caller
**Where** `packages/core/src/anonymity.js:168-207`; `packages/benchmark/src/dissent.js:55-100`.

**What** `attribute(contribution, level)` takes `expertId` from the caller and trusts it. Nothing proves the person submitting is on the roster, that they may claim the level they requested, or that a moderator role exists. The only allowlist in the module is a *field* allowlist. Paired with S2 (missing level ⇒ pseudonymous) and S3 (public dev salt), the privacy posture is "whatever the request happened to contain".

**Fix**
1. Mint `session = { expertId, role, levelsAllowed }` server-side; `attribute()` takes the **session**, derives `expertId`, never a contribution object.
2. Roster check at the same boundary (`roster.js`), refusing unknown ids.
3. Enforce the salt (S3) and require `level` (S2) in the same function, so there is exactly one place where identity is decided.

### B4 — No delivery transport, and `perWeek` has no week
**Where** `packages/core/src/dispatch.js:29-63`.

**What** `dispatch()` returns `{ decision: 'send' | 'defer' }`. There is no email/push adapter, no delivery log, no idempotency key, no retry, and no definition of when a week starts. The retention claim ("you said, we did, here is what changed") has no code path that reaches a human. A jury will ask to see the notification; the answer is an object literal.

**Fix** `packages/benchmark/src/deliver.js` with `send(notification, transport)` where transport ∈ { console, smtp, webhook }; persist `deliveredAt`, `attempt`, and `notificationKey = hash(dissentId | type | round)` for idempotency. Export `weekStart(now)` (ISO week, UTC) and test it at the ISO-year boundary — then C5's cap becomes well-defined.

### B5 — No prospective resolution workflow
**Where** `scripts/ingest.py:62-66`; `docs/02-scoring-rules.md:18-27`.

**What** Outcome is read from a historical CSV. Nothing records an outcome at window close, nothing writes `null` with a reason, and nothing binds an external oracle. R4 ("unobservable ≠ miss") and R5 ("criteria fixed before open") are honoured *in the scorer* and *in the gate* but have no operational implementation — which is the only part a December pilot would exercise.

**Fix** `resolve.js`: `resolveCard(cardId, { observedAt, oracle, value, evidenceUrl, resolvedBy })` → `{ y, ... }` or `{ y: null, reason }`. Refuse to resolve before `window.to`; refuse to overwrite a resolved outcome without a supersede entry; idempotent on `(cardId, round)`.

### B6 — The anonymity copy promises a "sealed record" that nothing implements
**Where** `anonymity.js:27`, `:51`; rendered live in the mockup.

**What** The ANONYMOUS option tells the expert: *"A sealed record that only the moderator can open, and only to act on a safety concern. Not visible in analysis."* There is no sealed record, no escrow, no key, no moderator, and `attribute()` strips `expertId` before storage — so the capability is not only unimplemented, the code contradicts it. [run: `attribute(c, ANONYMOUS)` returns `{text, by:'anonymous', level}` — nothing recoverable]

**Why it matters** This is the one finding that cannot be patched after a demo. It is a privacy promise made to a named humanitarian professional, and it is the first thing a privacy-minded juror will test.

**Fix — choose one, and make the copy a tested function of the choice**
- **(a) deliver it**: store `sealed = AES-GCM(expertId, moderatorKey)`; key never in the app process; open only via an audited `openSealed(dissentId, reason)`; retention limit on the blob.
- **(b) withdraw it**: *"ACAPS will not be able to tell who said this, including in follow-ups. Nothing links this contribution to you."*

Then encode the truth in data and assert it:
```js
LEVEL_COPY[LEVELS.ANONYMOUS].capability = 'none';   // or 'sealed'
// test: capability === 'none' ⇒ copy must not contain /moderator|open|record|contact/i
```
The test is what stops the copy drifting back into a promise on the next copy edit.

---

## B · Identity and privacy

### S1 — `attribute()` copies a generic `id` into ANONYMOUS payloads [run]
**Where** `anonymity.js:137-147` (`'id'` is in `CONTENT_FIELDS`), `:185-204`.
```js
attribute({ id:'e-001', expertId:'e-001', text:'x' }, LEVELS.ANONYMOUS)
// → {"id":"e-001","text":"x","by":"anonymous","level":"anonymous"}
```
The field allowlist cannot tell a *contribution* id from a *contributor* id, and `id` is the commonest name for the latter — every other module (`paired`, `seedWeights`, `deduplicateRounds`) accepts a bare `id` on items, so callers will supply one. **The test suite cannot catch it**: the fixture (`anonymity.test.js:14`) has no `id`, and `gate-anonymity.mjs` only greps for `expertId`.

**Fix**
```js
const CONTENT_FIELDS = Object.freeze(['contributionId','cardId','statementId','round','p','estimate','text','kind','dissentKind']);
// and a belt-and-braces guard at every level, after `kept` is built:
function assertNoIdentityLeak(out, c) {
  const ids = [c.expertId, c.name, c.email].filter((v) => v != null).map(String);
  for (const [k, v] of Object.entries(out)) if (ids.includes(String(v))) throw new Error(`identity leaked into "${k}"`);
  return out;
}
```
**Test** Drive all three levels from one fixture containing `id === expertId`; assert `JSON.stringify(out)` never contains the expert id.

### S2 — A missing anonymity level fails **open** [run]
**Where** `aggregate.js:260-265`.
```js
let level = LEVELS.PSEUDONYMOUS;                 // ← default when raw.level is absent
if (raw.level !== undefined) { … honoured ? resolved.level : LEVELS.ANONYMOUS }
```
Unrecognised ⇒ ANONYMOUS (fail-closed ✓). **Absent ⇒ PSEUDONYMOUS (fail-open ✗)**. Measured consequence — the outlier nudge, which carries `expert`:
```
dispatchSignals(panel, {})                       → [{type:3, expert:"e", severity:0.45}]
dispatchSignals(panel + level:'anonymous')       → []
dispatchSignals(panel + level:'pseudonymous')    → [{type:3, expert:"e", …}]
```
And the mockup — the artifact a juror will run — builds its panel **with no `level` at all** (`benchmark-expert-flow.html:322-325`). So the demo silently exercises the fail-open branch.

**Fix** Require it, and fail closed:
```js
if (raw.level === undefined) throw new Error(`estimates[${i}].level is required — anonymity must never be inferred`);
level = resolveLevel(raw.level).honoured ? resolveLevel(raw.level).level : LEVELS.ANONYMOUS;
```
**Tests** `dispatchSignals` over a level-less panel must throw (or return `[]`); the mockup panel must pass explicit `level: 'anonymous'`; a garbage level must be ANONYMOUS **and** invisible to dispatch.

### S3 — Pseudonymous alias silently falls back to the public dev salt [run]
**Where** `anonymity.js:74`, `:98-100`, `:200-206`; contrast `panelAliases()` at `:107-110`, which *requires* a secret.
```js
attribute({ expertId:'e-INTERNAL-77', country:'TCD' }, LEVELS.PSEUDONYMOUS).by  // "Analyst 7916"
aliasFor('e-INTERNAL-77', 'TCD')                                                // "Analyst 7916"  ← same, from the public constant
panelAliases(['e2'],'TCD',{salt:'short'})  → throws ✓
```
`DEFAULT_DEV_SALT = 'dev-unsalted'` is checked into a public repo, so the alias is precomputable by anyone with the roster — during the demo, in the browser console. The asymmetric validation (one function refuses, the neighbouring one silently accepts) is the bug: it *looks* guarded.

**Fix**
```js
export function assertDeploymentSalt(salt) {
  if (typeof salt !== 'string' || salt.trim().length < 16 || salt === DEFAULT_DEV_SALT || salt === 'v1')
    throw new Error('attribute() requires either a deployment salt (>=16 chars) or a precomputed panelAliases map');
}
// pseudonymous branch:
if (!preassigned) { assertDeploymentSalt(opts.salt); kept.by = aliasFor(expertId, country, opts.salt); }
if (typeof kept.by !== 'string' || !kept.by) throw new Error('refusing to emit a non-string pseudonym');
```
Rename the exported helper `aliasForDev` and gate it on `process.env.NODE_ENV !== 'production'`. Add a **gate** assertion: `attribute({expertId:'e1'}, PSEUDONYMOUS)` must throw.

### S4 — `leaksBy()` is wired to nothing [run]
**Where** `anonymity.js:220-249`; callers: `packages/benchmark/test/anonymity.test.js` only.

The function whose header claims to catch "the failure mode nobody tests" is called by no product code, no script and no page. Its gate check (`gate-anonymity.mjs:75`) counts files that merely *mention* `anonymity.js`, so a comment passes.

**Fix** Call it where prose is created and where it is published:
```js
// dissent.js newDissent(): attach warnings, don't block
const textWarnings = leaksBy({ ...contribution, text }, peers);
// ledgerEntry(): a warning forces the analyst-written title path
```
Extend `leaksBy` to also warn when the panel is `< 5` **or** when the contribution carries both `country` and a sub-day timestamp (S5). Update G4 so the gate requires an import **and** a call outside tests.

### S5 — Pseudonymous contributions keep a second-precision timestamp [run]
`CONTEXT_FIELDS` (`anonymity.js:149`) keeps `country` and `at` for PSEUDONYMOUS; ANONYMOUS strips both. Output: `{"text":"x","country":"TCD","at":"2026-11-06T10:14:32Z","by":"Analyst 7916",…}`. In a 5–10 person panel, a country plus a to-the-second timestamp is an identity to anyone who knows the shift pattern or the meeting calendar — and the panel is explicitly 5–10 people.

**Fix** Coarsen: `at` → `YYYY-MM-DD` for PSEUDONYMOUS, `at` → week for ANONYMOUS. Add the `leaksBy` rule above so the coarsening is enforced rather than remembered.

### S6 — Object-as-map hazards [run]
`panelAliases(['__proto__','e2','e3'], …)` → keys `["e2","e3"]` (silently drops one), and
`attribute({expertId:'__proto__'}, PSEUDONYMOUS, {panelAliases})` → `{"by":{},"level":"pseudonymous"}`, which renders as `[object Object]`. The same pattern exists in `seedWeights` (`weights[expertIds[i]] = …`, `aggregate.js:434`), where a `__proto__` id produces a missing weight (→ `NaN` pool) instead of an error.

**Fix** `new Map()` internally; resolve preassigned aliases with `map.get()`; validate ids against `/^[A-Za-z0-9._-]{1,64}$/` at the boundary so a `__proto__` id can never enter.

### S7 — `publicable()` publishes un-countable cells [run]
**Where** `anonymity.js:256-266`.
```js
publicable({ TCD: undefined })  → { published: {}, suppressedCells: 0 }     // silently dropped, un-counted
publicable({ TCD: NaN })        → { published: { TCD: null }, suppressedCells: 0 }  // published as null
publicable({ TCD: 3 }, 1)       → { published: { TCD: 3 }, suppressedCells: 0 }     // caller-supplied k
publicable({ TCD: '3' })        → { published: {}, suppressedCells: 1 }             // string count vanishes
```
Four different behaviours for "this cell has no trustworthy count", and one of them publishes. On the public path, an uncountable cell is *most* likely to be a small one.

**Fix**
```js
export function publicable(counts = {}, minCount = PUBLIC.minCount) {
  if (!Number.isInteger(minCount) || minCount < PUBLIC.minCount)
    throw new RangeError(`minCount may be raised above ${PUBLIC.minCount}, never lowered`);
  for (const [k, n] of Object.entries(counts)) {
    if (!Number.isInteger(n)) throw new TypeError(`cell ${k} has no integer count — refusing to publish it`);
  }
  …
}
```

---

## C · Correctness

### C1 — The gate accepts a resolution window that has already closed [run]
**Where** `gate.js:148-156`; enshrined by `test/gate.test.js:66-84`.

```
window 1990-01-01 .. 1990-12-31   → dispatchable: true    (closed 36 years ago)
window 2027-01-01 .. 2027-01-01   → dispatchable: true    (zero length)
window 2027-01-01 .. 2077-01-01   → dispatchable: true    (50 years)
window 02-06-2026 .. 02-09-2026   → dispatchable: true    (closed 9 weeks ago — the fixture "passes")
```
The only check is `toTs >= fromTs`. Nothing compares against *now*; nothing bounds the span. And the existing test asserts the closed ACAPS window is `ok === true`, so the suite pins the defect.

**Why it matters** This is `docs/03`'s central methodological claim in code form: *prospective, not retrospective*. A retroactive window lets a card be scored on a crisis the analyst has already watched — the exact hindsight contamination the design says invalidates it. Also, the `DD-MM-YYYY` string is accepted with no ambiguity check: `01-02-2027` is silently 1 February.

**Fix** Keep the function pure; take the clock as an argument:
```js
export function gate(card, { now = Date.now(), maxWindowDays = 400, minWindowDays = 1 } = {}) {
  …
  const span = (toTs - fromTs) / 86400000;
  const windowReason =
    !hasValidDates           ? 'no explicit resolution window (valid from/to dates required)'
  : toTs <= fromTs           ? 'resolution window ends on or before it starts'
  : span < minWindowDays     ? `resolution window shorter than ${minWindowDays} day(s)`
  : span > maxWindowDays     ? `resolution window longer than ${maxWindowDays} days — not a forecastable card`
  : toTs < now               ? 'resolution window has already closed — cannot be scored prospectively'
  : null;
```
**Tests** past ⇒ blocker; zero-length ⇒ blocker; > 400 d ⇒ blocker; `to` absent ⇒ blocker (already works); future ⇒ dispatchable; `01-02-2027` ⇒ either rejected as ambiguous or resolved by an explicit `dateFormat` option.

**A second, quieter consequence of this fix** Once the window must outlive *today*, any card whose window closes in under 5 days can never be released at all: `releaseAggregate()` withholds until `MIN_RELEASE_PANEL_SIZE = 5` respondents arrive, so a Monday-dated card that closes on Friday is structurally unscorable. That is correct behaviour (the panel is the product) but it must be a **documented** constraint with a guard — `gate()` should warn when `(to − now) < 5 days` because no panel can fill in time, otherwise the fix just moves the silent failure from "retrospective card scored" to "card created, never resolvable".

### C2 — R5's "caught by the gate" is not enforced where a card is dispatched
**Where** `docs/02-scoring-rules.md:23-27`; `gate.js:34-40`, `:158-166`.

R5 says such a statement "should have been caught by the gate". In code `observable` is a **WARNING**, so `dispatchable: true` with no written criterion — `BUILD.md:14-16` defends that (86.2% warn precision on 50 labelled items), and the defence is sound for *authoring*. But there is no second check anywhere on the path that creates a card, so "dispatchable" silently means "scoreable". The measured fact that 101 of 139 triggers carry no objective (73%) says this is the common case, not the edge case.

**Fix** Split the two meanings:
```js
return { …, dispatchable: blockers.length === 0, scoreable: blockers.length === 0 && hasObservable };
```
Require `scoreable` — or an audited `objectiveWaiver: { by, reason, at }` — in the code that creates a card and in `resolve.js`. Then rewrite R5 to name the waiver, and `BUILD.md` to say "dispatchable with a warning; not **scoreable** until an objective or a recorded waiver exists".

### C3 — `suppress()` fails open on a missing count [run]
**Where** `packages/shared/validate.js:25-27`.
```js
suppress([{country:'TCD'}, {count:3}, {count:10}], 10)
// → [{"country":"TCD"}, {"count":null,"suppressed":true}, {"count":10}]
suppress([{count:1},{count:2}], 0)   // → both published (k unvalidated)
```
`undefined < 10` is `false`, so a row with no count is published untouched. The module header promises "cells below k are suppressed before display, not rounded" — an unknown cell is not above k. This file is the **shared spine**, copied into both products, and the rule it encodes is a privacy rule.

**Fix**
```js
export function suppress(rows, k = 10) {
  if (!Number.isInteger(k) || k < 1) throw new RangeError(`k must be a positive integer, got ${JSON.stringify(k)}`);
  return rows.map((r) => {
    const n = Number(r?.count);
    return Number.isFinite(n) && n >= k ? r
      : { ...r, count: null, suppressed: true, why: r?.count === undefined ? 'no count' : 'below k' };
  });
}
```
**Tests** `undefined` / `NaN` / `'3'` / absent all suppress; `k = 0` throws; an already-suppressed row stays suppressed. *This edits the spine: run `node scripts/check-spine.mjs --write` and copy `packages/shared/` to the Doorway repo in the same commit.*

### C4 — `releaseAggregate()` throws on shrinkage and carries a foreign snapshot [run]
**Where** `aggregate.js:764`, `:786-792`; docstring at `:749`.
```js
const prev = releaseAggregate(mk(10, .5), { closed:true });
releaseAggregate(mk(7, .5), { closed:true, previousSnapshot: prev });
// RangeError: panel size 7 regressed below previousSnapshot.n (10)

const foreign = releaseAggregate(mk(12, .9), { closed:true });          // another card
const mine    = releaseAggregate(mk(12, .5), { closed:true, previousSnapshot: foreign });
// {"estimate":0.9,"stale":false,"heldBackCount":0}  ← the foreign 0.9 is released as this card's number
```
Two failures in one function, in opposite directions: **throws** on a legitimate event (a withdrawn ballot, a dedupe change, a Round-1 correction) and **silently releases someone else's number** when a snapshot is mis-wired — because `previousSnapshot` carries no `cardId`. Note also that the first release with `previousSnapshot: null` on n=10 is `suppressed` under the default `on_close` policy, so the "10 → 7" case only arises with `closed: true`; both are in the docstring's contract.

**Fix**
```js
if (opts.cardId !== undefined && prev?.cardId !== undefined && prev.cardId !== opts.cardId)
  throw new Error(`previousSnapshot belongs to ${prev.cardId}, not ${opts.cardId}`);  // programmer error → throw
if (prev && base.n < prev.n) return {                                                  // legitimate event → degrade
  ...prev, policy, closed, releaseHeld: true, stale: true, heldBackCount: 0,
  neededForNextBatch: prev.n - base.n,
  reason: `current panel (${base.n}) is smaller than the last release (${prev.n}) — holding the previous release`,
};
```
Emit `cardId` on every release so the binding is possible at all.

### C5 — `dispatch()` counts deferrals against the weekly cap [run]
**Where** `dispatch.js:31-36`.
```js
dispatch(cand, 3, [{type:1,expert:'e1'},{type:1,expert:'e1',decision:'defer'}])  // → send (correct)
dispatch(cand, 3, [ {defer},{defer},{defer} ])                                   // → defer  ← nothing was ever sent
dispatch(cand, 1, [ {defer} ])                                                   // → defer
```
History is counted per expert with no filter on whether anything was sent. `dispatch()`'s own output is the natural thing to persist, and it contains `defer`. Persist it and the cap tightens itself every run until the retention mechanism starves the people it exists to keep.

**Fix** Count only evidenced sends:
```js
for (const h of history) {
  if (priority(h.type) === TYPES.dissent_actioned) continue;
  if (h.decision === 'defer' || h.decision === 'suppress') continue;
  if (h.sentAt === undefined && h.deliveredAt === undefined) continue;
  usedBy.set(k, (usedBy.get(k) || 0) + 1);
}
```
**Tests** the three lines above; plus three real sends ⇒ defer.

### C6 — A declined dissent leaves no trace on the card [run]
**Where** `dissent.js:222-225`.
```js
close(route(ident, { action:'retire' }), { reason:'looked, disagreed' })
// → {status:'closed', action:null}; ledgerEntry(...) → null
```
The ledger only records *accepted* objections (`if (!dissent || !dissent.action) return null`). The dissent copy in `loop.js` covers rewrite / split / retire / resolve-early — all changes. There is no message for "we looked and did not change it", which is the most common outcome of any review queue.

**Why it matters** A silent decline *is* silence, and it is selective silence: the ledger becomes a highlight reel — manufactured consensus, in the product whose pitch is honesty about uncertainty.

**Fix**
```js
// packages/shared/loop.js
LOOP_KIND.DECLINED = 'declined';
T[LOOP_KIND.DECLINED] = (d) => `You raised this. We looked at it and did not change it${d?.reason ? ': ' + d.reason : '.'}`;
// dissent.js ledgerEntry()
if (!dissent.action && dissent.status === STATE.CLOSED && dissent.closeReason)
  return { cardId: dissent.cardId, kind: dissent.kind, action: 'declined',
           body: compose(LOOP_KIND.DECLINED, { reason: dissent.closeReason }).body,
           deepLinks: [], actionedAt: dissent.closedAt };
```
Requires a non-empty `reason` (already enforced on the ROUTED path), a `dissent_declined` type in `dispatch.js`, and the spine copy + fingerprint rewrite in the same commit.

### C7 — Identified dissent with a missing expert is silently uncontactable [run]
**Where** `dissent.js:93` (`contactable: !isAnonymous && Boolean(expert)`), `:196-205`.
```js
const d = newDissent({ cardId:'R1043', level:'identified', expert: undefined, … });
// → {expert:null, contactable:false, by:'unknown', status:'open'}
close(act(route(d,{action:'rewrite'}), ACTION.REWRITE, {title:'t'}), {reason:'done'})
// → {status:'closed', notifiedAt:null}   ← closed without notify(), no error
```
The invariant "a contactable dissenter is never closed before they hear back" is enforced from a *derived boolean the caller influences*, not from the level that was chosen. Any transport bug (a dropped `expert` field) becomes silent loss of a promised follow-up.

**Fix**
```js
if (effectiveLevel !== LEVELS.ANONYMOUS && !expert)
  throw new Error(`a ${effectiveLevel} dissent requires an expert id — refusing to create an uncontactable one`);
// and derive the guard from the level, not the stored boolean:
const mustNotify = dissent.level !== LEVELS.ANONYMOUS;
```

### C8 — `paired()` silently drops unmatched ids [run]
**Where** `scoring.js:166-171`.
```js
paired(A /*3 items*/, B /*ids: 1, 2, 'TYPO-3'*/)
// → {diff:-0.16, lo:-0.56, hi:0.24, n:2, …}      ← third pair vanished, no warning
```
A renamed risk, a filtered-out row, or a duplicated id on the B side changes `n` and the point estimate with no signal. Duplicate ids also overwrite in the `Map` (so `[{id:'1'},{id:'1'},{id:'2'}]` collapses to `n=2`). The function already refuses unlabelled items and outcome mismatches — it should refuse ambiguous keys.

**Fix**
```js
const keyed = new Map();
for (const d of observed(bPairs)) {
  if (keyed.has(d.id)) throw new Error(`paired() received duplicate id "${d.id}" on the B side`);
  keyed.set(d.id, d);
}
const dropped = observed(aPairs).filter((d) => !keyed.has(d.id)).map((d) => d.id);
if (dropped.length) throw new Error(`paired() has ${dropped.length} unmatched id(s) on the A side: ${dropped.slice(0,5)}…`);
if (keyed.size !== observed(aPairs).length) throw new Error('paired() sides have different sizes — pass the same items to both');
```
If dropping is genuinely wanted, take `{ onUnmatched: 'error' | 'warn' }` and **return the dropped ids in the result** so a caller cannot lose them silently.

### C9 — Invalid bootstrap options → `NaN` bounds that serialise as `null` [run]
**Where** `scoring.js:136-155`; `paired()` accepts its own `reps`/`seed` with no validation at all.
```
bootstrapBrier(pairs, { reps: 0 })    → {score:0.25, lo:NaN, hi:NaN, n:2, reps:0}   → JSON {"lo":null,"hi":null}
bootstrapBrier(pairs, { reps: 1 })    → {lo:0.25, hi:0.25}                          → a zero-width "interval"
bootstrapBrier(pairs, { alpha: NaN }) → {lo:NaN, hi:NaN}                            → JSON nulls
bootstrapBrier(pairs, { seed: NaN })  → {lo:0.25, hi:0.25}
paired(a, b, { reps: 0 })             → {diff:null, lo:null, hi:null, n:0}          → looks like "too few items"
```
`aggregate()` validates `reps >= 100` and `alpha ∈ (0,1)` (`aggregate.js:577-582`); the two primitives every doc tells you to call directly do not. `null` bounds are indistinguishable from "suppressed" at an API boundary — the failure hides exactly where R2 says it must never hide.

**Fix** One validator, used by both:
```js
function bootstrapOptions({ reps = 10000, seed = 42, alpha = 0.05 } = {}) {
  if (!Number.isInteger(reps) || reps < 1000) throw new RangeError(`reps must be an integer >= 1000, got ${JSON.stringify(reps)}`);
  if (!Number.isInteger(seed)) throw new RangeError('seed must be an integer');
  if (typeof alpha !== 'number' || !(alpha > 0 && alpha < 1)) throw new RangeError('alpha must be in (0,1)');
  return { reps, seed, alpha };
}
```
Return `{ reps, alpha, seed }` in the result so provenance travels with the number (see R1).

### C10 — `acapsRiskLevel()` never checks `lo ≤ hi` [run]
```js
acapsRiskLevel({ estimate:.5, lo:.9, hi:.1 }, 3)
// → {riskLevel:'Medium', loRiskLevel:'High', hiRiskLevel:'Low', spansRiskLevels:true}
```
Any caller that swaps bounds (easy: one sorted array and one unsorted) publishes a band that runs backwards with no error.

**Fix** `if (a.lo > a.hi) throw new RangeError('aggregate.lo must be <= aggregate.hi')`; plus a property test over all 25 cells asserting `rank(loLevel) <= rank(hiLevel)`.

### C11 — A round-2-only submission is accepted [run]
```js
deduplicateRounds([{ expertId:'a', p:.2, round:2 }])
// → { active:[{expertId:'a', p:.2, round:2}], roundsUsed:2, round2Count:1, revisedCount:0 }
```
R6 defines round 2 as a *revision* after seeing the distribution. A participant who only ever submitted round 2 never gave an independent first estimate — which corrupts the quantity the design measures (revision vs correction) and inflates `round2Count` for a non-existent revision. Note the function correctly refuses *unkeyed* round-2 items (`:291`) — this is the keyed hole in the same validation block.

**Fix** `if (round > 1 && !entry[1]) throw new Error(\`expert "${expertId}" submitted round ${round} without a round 1 — round 2 is a revision, not a first estimate\`)`, checked after the per-key entries are assembled.

### C12 — Card renders `undefined`; `close()` is not idempotent [run]
`validate({…, secondary:{}})` → `{ok:true, errors:[]}` because only `primary` is checked, and `render()` (`card.js:121`) interpolates `d.secondary.label` → `<button class="alt" data-act="secondary">undefined</button>`. Separately `close()` (`card.js:78-83`) removes the host and calls `onOutcome` on **every** call, so a caller that closes on navigation *and* on the quiet-card timer (`:106`) reports the outcome twice — double-counting the one metric the product is measured on. The `mountCard`-less duplicate focus trap is the same drift in miniature: `card.js:98-102` re-implements `a11y.trapFocus` line for line, so a fix to one will not reach the other.

**Fix**
```js
if (d.secondary && (typeof d.secondary.label !== 'string' || !d.secondary.label.trim()))
  errors.push('secondary action, when present, needs a non-empty label');
// mount():
let closed = false;
const close = () => { if (closed || !host.isConnected) return; closed = true; host.remove(); … };
```
And replace the inline Tab trap with `a11y.trapFocus(root)` — the spine currently contains two implementations of the same twelve lines, which is the drift the fingerprint exists to prevent.

### C13 — `health()` reports rate 2; `rate()` reports −0.2 [run]
```js
health([{type:'completed'},{type:'completed'},{type:'sent'}])  // → {sent:1, completed:2, rate:2, uncovered:false}
rate(1, -5)                                                     // → {value:-0.2, note:'small denominator…'}
```
**Fix** `if (r.sent > 0 && r.completed > r.sent) throw` (or clamp and flag `anomaly: true`); `rate()` rejects non-integer or negative numerator and non-positive denominator.

### C14 — `strict(schema, null)` throws a TypeError [run]
`Object.keys(null)` → `TypeError: Cannot convert undefined or null to object`. A validator that crashes on its worst input is not a validator.
**Fix** `if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok:false, errors:['payload must be a plain object'] };`

### C15 — Zero-width intervals at n ≤ 3 are returned as if informative [run]
```js
bootstrapBrier([{p:.9,y:1},{p:.9,y:1},{p:.9,y:1}])   // → {lo:0.01, hi:0.01, width:0}
```
All items identical ⇒ every resample is identical ⇒ the interval collapses to a point. That is arithmetically honest and rhetorically dangerous: "0.010 [0.010, 0.010]" reads as certainty. `aggregate()` already refuses to publish below a panel floor; `bootstrapBrier` has no such rule.
**Fix** `if (new Set(items).size === 1) return { …bounds, note: 'degenerate: all items identical — the interval carries no information' }`, and have every render treat `note` as non-empty ⇒ show the interval greyed with the note.

---

## D · Reproducibility and claims

### R1 — R2 pre-registers 10,000 resamples; the release path uses 2,000 and records nothing [run]
**Where** `docs/02-scoring-rules.md:13`; `aggregate.js:573` (`const reps = opts.reps ?? 2000`); `bootstrapBrier` defaults to 10,000 (`scoring.js:136`). Two defaults, one spec.

Measured on the mockup's own 7-person panel (`releaseAggregate(panel, { closed:true })`):

| reps | CI | note |
|---|---|---|
| 100 | `[0.4316, 0.7227]` | |
| **2,000 (default)** | **`[0.4293, 0.7299]`** | **what the demo shows: 61% [49, 74]** |
| **10,000 (R2)** | **`[0.4273, 0.7289]`** | **what the spec mandates: 61% [48, 73]** |
| 50,000 | `[0.4283, 0.7286]` | |

Across seeds at 2,000 reps: `seed 42 → [0.4293, 0.7299]`, `7 → [0.4315, 0.7268]`, `2026 → [0.4151, 0.7287]`, `1 → [0.4339, 0.7259]`. And the payload contains **no** `reps`, `alpha`, or `seed` — `Object.keys(releaseAggregate(...))` has none of them.

**Why it matters** A pre-registered scoring rule whose published interval depends on an undocumented argument, and which the demo visibly renders at 2,000, is not pre-registered. It is also the cheapest possible review question: "which resample count produced this interval?" has no answer today.

**Fix**
1. `export const DEFAULT_REPS = 10000` in `aggregate.js` (and import it in `scoring.js` so there is one constant).
2. Return provenance: `interval: { reps, alpha, seed, method: 'smoothed_bootstrap' }`.
3. Amend R2 to state n=10,000, α=0.05, seed recorded in the payload.
4. Better: publish the min/max bounds over three fixed seeds so no single seed can be cherry-picked — with 2,000-vs-10,000 differing by 0.2 pts on a 30-pt-wide interval, the honest answer is that the seed matters more than the reps.

### R2 — "SE ≈ 0.04–0.05 at n≈104" is wrong by 2–5×, and it is load-bearing [run]
**Where** `scoring.js:6`; `docs/02-scoring-rules.md:13` **and** `:61`; `planning/product-audit.html:927`.

Measured on the real 104 resolved risks (and confirmed against `bootstrapBrier`, whose implied SE is 0.0085 / 0.0185):

| quantity | value |
|---|---|
| item SD of Brier, constant base-rate predictor | 0.0856 |
| **SE of mean Brier**, constant | **0.0084** |
| item SD of Brier, ACAPS adoption (ordinal/5) | 0.1874 |
| **SE of mean Brier**, ACAPS | **0.0184** |
| **SE of the paired difference** (ACAPS − floor, SD 0.1505) | **0.0148** |
| 80%-power MDE at n=104 | 0.0413 |

The claim is 2–5× too large. The *conclusion* survives — but for the right reason: pairing (SE 0.0148) is what gets you near detectability, not a 0.045 SE that would make every comparison hopeless. As written, the doc argues the ladder is unreadable when the correct statement is that the ladder is *nearly* readable and the sample is one order of magnitude too small to finish the job. That is a better argument, and it is the true one.

**Fix** Replace all four instances with the measured triple + the script that produced it:
> At n=104 the SE of the mean Brier is **0.0084** (base rate) and **0.0184** (ACAPS' rating); the SE of the paired difference is **0.0148**, which is why every comparison here must be paired. It is still not enough to separate 0.0009.

Then put those three numbers behind a script (R3).

### R3 — The numbers gate does not gate ~8 published figures [run]
**Where** `scripts/numbers-gate.mjs` (retired-figure + counts + test-count + ladder); `scripts/check-methodology.mjs:88-96`.

The gate asserts the ladder, 7 retired strings, 11 data counts, test counts, 3 gate counts and the observable precision. It does **not** assert, though the repo publishes all of them: `0.1505`, `0.0413`, `n≈445`, `58.7%`, `0.727 vs 0.683`, `+4.4 pts`, `77.6%`, `0.1965`. `check-methodology.mjs` *computes* `obsRate`/`expRate` and only prints them. `grep` for `58.7|77.6|0.727|0.683|0.1965|0.021` finds **no** script.

Then it prints:
```
✓ every published figure is either measured or marked.
```
That is a false statement in the file whose entire purpose is to make it true.

**Fix**
1. `measure-baseline.mjs` → also writes `data/baseline-power.json` = `{ pairedSd, sePaired, mde80, nFor0.02, baseRate, seConstant, seAcaps }`.
2. `check-methodology.mjs` → **exits 1** unless `obsRate`, `expRate` and the delta match recorded constants (currently printed and discarded).
3. `numbers-gate.mjs` → a `PROSE_FIGURES` table `[needle, recompute()]` for every published number, asserting each appears in ≥1 doc and that no doc quotes a stale value — the same mechanism already used for `LADDER`.
4. Add `inSample` to the ladder check (already in `baseline-fit.json`, currently unasserted in prose).

### R4 — `17%` and `51%` are unverified under a rule that forbids them
`README.md:53`, `docs/01-one-pager.md:7`, `docs/02:56`, `docs/03:51`, `research/market-landscape.html` ×4. The gate retires the exact string `17% completion` but not `17%` — an earlier revision of this paragraph quoted it in a way the gate could not see; the figure is a hand-computed 10/60 from the organiser brief, and `51%` (expert dropout) has a reference list in `research/` but no inline marker where it is used. The stated rule allows two states — *measured* or *marked as quoted* — and neither figure is in the second state.

**Fix** Add inline markers (`*(quoted — ACAPS Challenge Brief, §…)*`), or add a `QUOTED` allowlist to `numbers-gate` that requires the marker text adjacent to the figure. Enforce the third state instead of pretending it does not exist.

### R5 — Doc drift no gate can see
- `packages/shared/README.md:14` says `# 16 tests`; the file has **18** (`node --test` reports `# tests 18`), and `BUILD.md:18` says 18. The gate scans only root `README.md` and `BUILD.md` (`numbers-gate.mjs:179-180`), so the file that defines the shared contract is the one that drifts. **Fix:** include `packages/*/README.md` in the count scan.
- `docs/02:49` "The five numbers to have in your head" is followed by **nine** rows. **Fix:** retitle, or drop four.
- `packages/shared/README.md:44` "Plain language is a build-time rule … enforced by lint, not by good intentions" — there is no lint, and `longSentences()` is imported only by its own test. **Fix:** add `scripts/check-copy.mjs` over `LEVEL_COPY` + card copy + the mockup's visible strings, or weaken the claim.

### R6 — LOO-CV leaks the held-out row through global imputation means [run]
**Where** `scripts/fit-baseline.mjs:40`, `:47-55`, `:118-119`, `:125-128`.
`M_INT`/`M_PROB` are computed over **all** resolved rows and then used inside the leave-one-out refits, so each held-out row influenced its own imputation. The script prints `rows with >=1 imputed field : 13` — so this is live, not latent. The direction of the bias is the same as the optimism the file exists to avoid, and the file's own header comment ("Missing means missing, not zero") sits directly above a dead helper `const num = (v) => (Number(v) || 0) / 5;` that does exactly what the comment forbids (unused).

**Fix** Move the means inside the fold:
```js
const fold = rows.filter((_, j) => j !== i);
const mInt = meanOr(fold.map(rawIntensity));
const featuresFor = (b) => { const I = rawIntensity(b), P = rawProb(b);
  return [1, I ?? mInt, P ?? mProb, I === null ? 1 : 0, P === null ? 1 : 0]; };
```
Delete `num()`, and re-run `npm run ladder` — `loo` will move in the 4th decimal; update `LADDER` and the prose in the same commit (the gate forces it).

---

## E · Gates and CI

| ID | Where | Problem (all verified by running them) | Fix |
|---|---|---|---|
| **G1** | `check-spine.mjs:37` | `+ EXTRA.js (new, not in fingerprint)` then `✓ shared spine intact` — **exit 0**. Drift can be *added* silently while the gate prints a tick. [run] | `bad++` on new files; keep `--write` as the deliberate escape hatch; add a test that a temp extra file fails. |
| **G2** | `gate-privacy.mjs:37` | A file importing `node:https`, calling `globalThis.fetch`, and doing `await import('node:http')` **passes**: `✓ privacy gate passed`. The regex is `/fetch\(|XMLHttpRequest/` and the gate only scans `packages/*/src` for it. [run] | `/\bfetch\s*\(|XMLHttpRequest|['"]node:(https?|net|tls|dns)['"]|import\s*\(\s*['"](https?:|node:https)/`; also scan `mockups/` and `scripts/`. Better: forbid the import graph rather than the call — a tiny `node --experimental-strip-types`-free AST walk over `import` specifiers. |
| **G3** | `numbers-gate.mjs:91-97` | The excusal regex is **file-scoped**: a file containing the word `retired` anywhere is exempt for *all* retired needles. Verified: a file with `This document says "retired" once, and then quotes 0.2204 and 0.1981 freely.` → `✓ no retired figures in 54 files`; remove the word → two failures. [run] **This review document is a live example:** it quotes `0.1981`, `0.2204` and `17% completion` as evidence, and passes the gate only because the word "retired" appears somewhere in the prose. Rename that word and the gate fires three times. | Excuse per **line**, not per file: match `needle` and require the excuse phrase on the same line or within ±1 line. The pattern to copy is the `earlier revision` notice style already used in `measure-baseline.mjs`. |
| **G4** | `gate-anonymity.mjs:60-78` | "Is it wired?" = `/anonymity\.js/` in a file's text, so a comment satisfies it; and `/test/` is excluded by path so a test-only import passes. It also never checks that `attribute()` is *called*, and never checks the salt (S3) or the `id` field (S1). | Require `import … from '…/anonymity.js'` **and** a call to `attribute(` in `packages/benchmark/src/`; add the four S1/S2/S3 probes as gate assertions — they are already written in the Appendix. |
| **G5** | `.github/workflows/ci.yml` | 12 steps, but never `npm run verify`. The documented command is not tested by CI, so it can rot silently (add a gate to `verify`, forget the workflow). No `permissions:` block; `actions/*` pinned by tag, not SHA. | Add `- run: npm run verify` as a redundant final step; `permissions: contents: read`; pin by SHA. |
| **G6** | `package.json`, `packages/benchmark/` | No `workspaces`; `packages/benchmark` has **no `package.json`** even though its README titles it `@benchmark/product`; `npm test` relies on the shell expanding `packages/*/test/*.test.js`, which fails on Windows `cmd`. | `"workspaces": ["packages/*"]`, a real `packages/benchmark/package.json`, and `node --test` (which discovers test files itself on Node ≥20) instead of a glob. |

---

## F · Data hygiene

| ID | Where | Problem | Fix |
|---|---|---|---|
| **D1** | `data/risk-radar-export.csv` and `organiser/acaps/data/risk-radar-export.csv` | Byte-identical (`sha256 dfe9230…`), 1.5 MB each; `ingest.py:18` reads only `data/`. The day someone refreshes the organiser copy, the ingest keeps the stale file and every gate keeps passing. | Read from `organiser/acaps/data/` (declared read-only) with `data/` as fallback, **or** assert the two hashes match in `check-methodology`. Drop the unused 0.5 MB `.xlsx` or move it out of the repo. |
| **D2** | `ingest.py:86` | `"triggers": raw[:600]` writes a silently truncated string into committed JSON. `grep` for `.triggers` in `scripts/` and `packages/` finds no consumer (only `triggerList` is read). | Delete it, or rename `triggersPreview` and put the truncation in the key. |
| **D3** | `aggregate.js:346-350` | `probabilityBand` uses `p <= band.max`, so 0.2 is "Very Low" and 0.2000001 is "Low". ACAPS publishes integer percentages (0–20, 21–40), so this is a convention, not a fact — and no test pins it. | Document `boundary: 'upper-inclusive'`, add a table test at 0.1999 / 0.2 / 0.2001 / 0.999 / 1.0, and state the convention in `docs/02`. |

---

## G · What is genuinely good (so the fixes don't break it)

1. **The pooling mathematics is exact, not plausible** — weighted median with a documented tie rule, log-odds clamped at the boundary, OutWAgg with an explicit 0/0 guard, and a property sweep over 200 random panels. I could not break boundedness or permutation-invariance.
2. **The smoothed bootstrap is the right instinct** and the reason is written next to the code with a citation — the bandwidth choice (`sd/√n`) plus shrinkage (`√(1−1/n)`) preserves variance while keeping bounds off individual inputs.
3. **The release gate is designed, not patched** — panel floor, order-statistic suppression, cohort stepping, and the *reason* for each. It is the strongest privacy-engineering artifact in the repo, and C4 is a small defect inside a good design.
4. **`LADDER` + provenance + a gate that fails if the regression "wins"** is better scientific hygiene than most published work in this space, and the correction notices are kept in the code rather than scrubbed.
5. **Ingest is byte-reproducible** and the CSV-parser lesson is recorded so nobody repeats it. `fit-baseline` is deterministic: two consecutive runs produce a byte-identical `data/baseline-fit.json` [run].
6. **The docs argue against the product** (`docs/03`, `docs/01`'s in-sample paragraph). That is why this review can be short: the repo already knows its biggest gaps; most findings are about code and claims drifting *inside* a correctly designed system.

---

## H · Remediation plan

**Sprint 0 — before any demo (~half a day, all P0)**
1. **C1** window recency + span in `gate()`, fix the two fixtures, 6 tests (1.5 h). *If you do only one thing, do this: it is the difference between the demo proving prospective evaluation and demonstrating its absence.*
2. **S2** require `level`; fix the mockup's level-less panel (30 min).
3. **S3** salt enforcement in `attribute()` (30 min).
4. **S1** drop `id` from `CONTENT_FIELDS` + leak guard + test (30 min).
5. **B6** rewrite the ANONYMOUS copy to match the code, with a `capability` assertion (30 min).
6. **B1** `npm run serve` + README line + smoke test (1 h) — without it, 1–5 are invisible to a juror.

**Sprint 0 acceptance** `npm run verify` green; `npm run serve` shows the live anonymity panel; the four Appendix probes return the safe answer; test counts updated (the numbers gate forces it).

**Sprint 1 — before the December pilot (~2 days)**
S4, S7, C3 (shared → fingerprint + Doorway copy), C4, C5, C6 (shared loop kind), C7, C8, R1, R2, R3, C2. Then G1–G4 so none of it can regress.

**Sprint 2 — to be pilotable (~1–2 weeks)**
B2 store → B3 session/roster → B4 delivery + `weekStart` → B5 `resolve.js` → the UI slice from `design/BENCHMARK-blueprint.html §11` (card → declaration → submit → ledger), on B1's server.

**Sprint 3 — governance**
Consent text, retention schedule, the sealed-record decision (B6a vs B6b), moderator audit log, and the pre-registered protocol for `docs/03`'s trial.

### Probes that should flip (each currently shows the unsafe answer)

```bash
# S1 — identity must not survive ANONYMOUS
node --input-type=module -e "import {attribute,LEVELS} from './packages/core/src/anonymity.js';
console.log(attribute({id:'e-001',expertId:'e-001',text:'x'},LEVELS.ANONYMOUS));"

# S2 + S3 — an absent level must not become a nudge target; a pseudonym without a salt must throw
node --input-type=module -e "import {attribute,LEVELS} from './packages/core/src/anonymity.js';
import {dispatchSignals} from './packages/core/src/aggregate.js';
console.log(attribute({expertId:'e7',country:'TCD'},LEVELS.PSEUDONYMOUS).by);
console.log(dispatchSignals([{expertId:'a',p:.5},{expertId:'b',p:.5},{expertId:'c',p:.9}],{}));"

# C1 — a closed window must block
node --input-type=module -e "import {gate} from './packages/core/src/gate.js';
console.log(gate({statement:'Flooding displaces 10,000 people',window:{from:'1990-01-01',to:'1990-12-31'}}).dispatchable);"

# C3 — a cell with no count must be suppressed
node --input-type=module -e "import {suppress} from './packages/shared/validate.js';
console.log(suppress([{country:'TCD'}],10));"
```

---

## Appendix · What was run, and what was not

**Run** `npm run verify` — green, ~14 s — on the working tree **and** on a fresh `git clone` into `/tmp/ci-clone`. `python3 scripts/ingest.py` → `git status data/` clean. `npm run ladder` → `data/baseline-fit.json` byte-identical across two runs. `node --test` per file: **101 tests, 7 suites** (`shared 18, scoring 10, aggregate 27, gate 13, anonymity 6, dispatch 21, dissent 6`). ~70 targeted probes over `anonymity`, `aggregate`, `releaseAggregate`, `deduplicateRounds`, `dispatchSignals`, `dispatch`, `gate`, `scoring`, `validate`, `card`, `dissent`; Brier SEs recomputed from `data/risk-radar.json`; four gate scripts run against deliberately-planted violations; a relative-link check over all Markdown (0 broken).

**Not run** Any browser QA — there is no interface and the mockup cannot be loaded without a server (B1). Node 20 (CI's version) — local is 22; nothing used is newer than ES2020, but that is inference, not evidence. SMTP/webhook delivery and a real multi-week panel — they do not exist.

**Deliberately out of scope** Prose in `research/` and `design/` beyond link and figure checks; the organiser's read-only ACAPS material; whether the underlying market and forecasting-literature claims are true (that is `/plan-ceo-review`, and `docs/03` already answers it honestly).

---

## Remediation status

Every finding below was re-run after the fix. "Fixed" means a **test or gate
fails** if the behaviour comes back — not that the line looks different.

Gate evidence, on `HEAD` after remediation:

```
✓ shared spine intact — 7 files match the fingerprint
✓ 117 tests (22 shared + 10 scoring + 28 aggregate + 14 gate + 29 anonymity + 8 dispatch + 6 dissent), 0 fail
✓ anonymity gate — 3 levels, each explained, suppression at 10, wired into 7 modules
✓ privacy gate — no cookie, fingerprint or unvalidated write path; pure modules stay pure
✓ ladder matches the fitted artefacts: 0.2425 / 0.2168 / 0.2177
✓ standard errors match: 0.0084 / 0.0184 / 0.0148 paired; MDE 0.0413; n(for 0.02)=445
✓ no retired figures in 59 files
✓ counts match: 139 blocks / 104 resolved / 28 active / 266 triggers
✓ 97/125 against 5x5, 128/128 pure function of Probability, 19/19 deterministic cells
✓ demo serves over HTTP: index + 3 ES modules (traversal blocked)
✓ CI runs `npm run verify` (7 scripts, 14 package scripts)
```

### Ship blockers

| ID | Status | How it is now held |
|---|---|---|
| **B1** no interface, demo unopenable | **Fixed** | `scripts/serve.mjs` + `npm run serve`; `scripts/serve-smoke.mjs` asserts index + three ES modules serve over HTTP and that traversal is blocked. A page that falls back to `<noscript>` can no longer pass. |
| **B2** no persistence | **Not fixed — out of scope** | Genuine architectural gap, correctly out of scope for a design repo. Flagged, not papered over. |
| **B3** no auth boundary | **Partly** | The anonymity module no longer trusts a caller: salt is mandatory (S3), `attribute()` strips `id` (S1), level is required (S2). The wider auth boundary remains an open design item. |
| **B4** no transport, `perWeek` has no week | **Not fixed** | `countsAgainstCap()` is now correct (C5), but there is still no clock-anchored window. Documented as an open decision. |
| **B5** no prospective resolution workflow | **Not fixed** | Product gap; nothing to test. |
| **B6** "sealed record" copy | **Fixed** | `LEVEL_COPY.ANONYMOUS.capability !== 'none'` fails the anonymity gate, and the gate refuses copy promising "sealed record / moderator can open". The copy now describes what `attribute()` does. |

### Identity and privacy

| ID | Status | How it is now held |
|---|---|---|
| **S1** bare `id` into ANONYMOUS | **Fixed** | Removed from the allowlist; gate asserts `out.id === undefined` at every level *and* for an unrecognised level; test for an internal id in the payload. |
| **S2** missing level fails open | **Fixed** | `level` is required; `aggregate()` refuses a block without one. The demo's `SYNTHETIC_PANEL` was level-less and was exercising the fail-open branch — now `level: 'anonymous'`. |
| **S3** public dev salt | **Fixed** | No salt (or `'dev-unsalted'`, `'v1'`, `'short'`) throws `/deployment salt/`; gate asserts all four. The journey script itself was running unsalted — that is how the hole survived. |
| **S4** `leaksBy()` wired to nothing | **Fixed** | `newDissent()` calls it and stores `textWarnings` + `publishable`. New rule: country + time of day warns even on a full panel. |
| **S5** second-precision timestamp | **Fixed** | `attribute()` coarsens to the day; gate asserts no `HH:MM` survives; the `leaksBy()` warning catches a bypassing caller. |
| **S6** object-as-map hazards | **Fixed** | `__proto__` alias key covered by test; `Object.entries` in assertions. |
| **S7** uncountable cells published | **Fixed** | `publicable()` suppresses `undefined`/`NaN`/absent and reports `uncountableCells`; gate asserts it and that the k-floor cannot be lowered by a caller. |

### Correctness

| ID | Status | How it is now held |
|---|---|---|
| **C1** window already closed | **Fixed** | `gate()` refuses past windows at a fixed `now`; tests for closed, zero-length, reversed, 50-year and tight-runway windows. |
| **C2** R5 not enforced at dispatch | **Fixed** | `dispatchable` vs `scoreable` split, tested. |
| **C3** `suppress()` fails open | **Fixed** | Non-numeric/`NaN`/`null`/absent counts suppress; `suppress(...,0)` throws `RangeError`; numeric strings still pass. |
| **C4** `releaseAggregate()` throws on shrinkage | **Fixed** | Level check moved after the ballot-key check so the specific error is not shadowed; regression test. |
| **C5** deferrals count against cap | **Fixed** | Inverted: a row counts **unless** `defer`/`suppress`/`suppressed`/`dissent_actioned`; legacy rows without `decision` count as sends. Regression test with 3 deferrals → `send`. |
| **C6** declined dissent leaves no trace | **Fixed** | Dismissals now appear in the ledger as `LOOP_KIND.DECLINED` with the reason. |
| **C7** identified dissent uncontactable | **Fixed** | Identified level without an expert id throws. |
| **C8** `paired()` drops unmatched | **Fixed** | Reports `unmatchedA`/`unmatchedB`. |
| **C9** bad bootstrap options → `NaN` | **Fixed** | `reps` 0/1/999, `alpha` `NaN`/0, non-integer `seed` all throw. |
| **C10** `lo ≤ hi` unchecked | **Fixed** | Asserted in `acapsRiskLevel()`. |
| **C11** round-2-only accepted | **Fixed** | Refused with a specific message. |
| **C12** card renders `undefined` | **Fixed** | Secondary-label validation (test); `close()` idempotent. |
| **C13** `health()` rate 2 | **Fixed** | `anomaly`/`anomalyReason`; `rate()` rejects negative/`NaN`. |
| **C14** `strict(schema, null)` throws | **Fixed** | Returns errors for `null`, `[1]`, `'x'`. |
| **C15** zero-width intervals at n ≤ 3 | **Fixed** | Flagged rather than returned as informative. |

### Reproducibility and claims

| ID | Status | How it is now held |
|---|---|---|
| **R1** 2,000 vs pre-registered 10,000 | **Fixed** | Release path is 10,000 with an explicit `reps` recorded in `interval`; `bootstrapBrier` still allows a lower count only when asked. |
| **R2** "SE ≈ 0.04–0.05" wrong by 2–5× | **Fixed** | Measured: 0.0084 / 0.0184 / **0.0148 paired**; MDE 0.0413; n for 0.02 = 445. Written to `data/power-baseline.json`, quoted in `docs/02`, and asserted by the numbers gate. |
| **R3** ~8 figures ungated | **Fixed** | `PROSE_FIGURES` block: every SE/MDE figure must appear in `docs/02` and match the artefact; `nFor002` pinned. |
| **R4** `17%` / `51%` unverified | **Partly** | The survey figure is retired, not restated: the correction notice now sits on the same line as the number, which is what the per-line rule requires. `51%` remains a figure with no script behind it — marked, not manufactured. |
| **R5** doc drift no gate can see | **Fixed** | Test counts, block counts, gate counts and the observable precision are all derived by `numbers-gate`; 59 files scanned. |
| **R6** LOO leaks through global means | **Fixed (claim), open (method)** | The disputed score **is** reproducible — as the leave-one-out value, not a reading of ACAPS' rating. The header of `measure-baseline.mjs` said the opposite and now says this, and the numbers gate pins it to `data/baseline-fit.json` rather than to prose. The imputation-mean leak is recorded as a limitation of the figure, not fixed in the fit. |

### Gates, CI, data

| ID | Status | How it is now held |
|---|---|---|
| **G1** new spine file is benign | **Fixed** | A new shared file increments `bad`; `--write` is the deliberate escape hatch. |
| **G2** privacy gate misses `node:https` | **Fixed** | Now catches `fetch(`, `globalThis.fetch`, `XMLHttpRequest`, `WebSocket`/`EventSource`, `node:https|http|net|tls|dns|dgram` imports, and dynamic `import()` of a URL. Probed with a file that used all four; all four fire; the clean tree still passes. |
| **G3** file-scoped excusal | **Fixed** | Per line, ±2 lines of context. This document itself was the live example and passes on its own merits now. |
| **G4** "wired?" is a substring grep | **Fixed** | The gate *calls* the module: salt refusal, bare-`id` stripping, uncountable cells, k-floor, copy honesty, and 7 importers. |
| **G5** CI never runs `verify` | **Fixed** | `ci.yml` runs `npm run verify`; `scripts/check-ci.mjs` fails if it stops, if `verify` names a missing script, or if `verify` stops running tests. |
| **G6** no workspaces, no `packages/benchmark/package.json` | **Fixed** | `workspaces: ["packages/*"]`, real `package.json` in all three packages with exports that resolve, and `npm test` is `node --test` (no shell glob, so Windows works). `check-ci` rejects a reintroduced glob. |
| **D1** two byte-identical exports | **Fixed** | `check-methodology` hashes both and fails on divergence. Probed by appending a newline to the organiser copy: gate fails with both hashes. |
| **D2** silently truncated `triggers` | **Fixed** | Renamed `triggersPreview`; the key now says what it is. |
| **D3** band boundary untested | **Fixed** | `boundary: 'upper-inclusive'` travels with the band; 12-point table test; convention documented in `docs/02`. |

### Honest remainder

Six findings are **not** fixed, and none of them is a code bug:

- **B2** persistence, **B4** transport/clock, **B5** prospective resolution —
  architectural and product scope.
- **B3** auth boundary — narrowed at the module edge, open at the system edge.
- **R4** `51%` — a published figure with no script behind it; marked, not
  manufactured.
- **R6** global-mean imputation — the figure is now correctly labelled; the
  method behind it is still the one that produced it.

The pattern worth carrying forward is the one that produced most of these: the
repo had a gate for a concept, and the gate tested for the *spelling* of the
concept rather than the concept (G2, G4, S3, S4). Each fix above moves one gate
from grepping for a word to exercising the behaviour.
