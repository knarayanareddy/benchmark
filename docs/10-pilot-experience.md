# Pilot experience: profile, Pulse, risk browser, dispatch lab, demo mode

**Status: specification for a build in progress.** It adapts the useful screens of the "Benchmark-upleveled-improved" prototype to this repository's engine, **without** its persona switcher, cookie-is-the-identity sessions, track-record weighting or live honour roll. Written for a real pilot first; demo data only decorates it.

Read `docs/05-service-and-privacy.md` and `docs/09-roundtable-and-credit.md` first. Every rule below exists to keep those guarantees.

---

## 0. Principles (non-negotiable)

1. **The person types their own profile and the app uses it.** There is no screen where you pick someone else to be. In a pilot you arrive by single-use invite; in demo mode (`BENCHMARK_DEMO=1`) you may open an account without an invite. Either way the profile you enter drives what you are asked.
2. **Blind Round 1 stays blind.** An expert must not be able to read ACAPS's rating, level, impact, trend, rationale or triggers for a risk that has a live question (a card, not yet resolved) before answering it. The server enforces this; the UI cannot be trusted. See §3.
3. **Declaration and profile decide who is *asked*, never how much weight anyone carries.** No track-record weighting. No per-person scores.
4. **Profile fields are for the person.** `organisation` and `roleType` are held in the roster store, shown to nobody but their owner, included in "export my data", removed by "erase my data". They never appear in the answers store, the audit log, a post, a dispatch preview, or any staff payload.
5. **Demo data is labelled and kept out of the second-look analysis.** Cards flagged `demo` never enter `secondLookSummary`, and every screen shows a plain banner while demo mode is on. This is the ONLY analysis that skips them today: demo cards still flow through `cardRelease` and raw exports, so **a demo deployment must never share a database with a pilot** (`serve.mjs` refuses unless told otherwise).
6. **The cap limits what is *pushed*, not what can be answered.** An expert can always answer any question that matches them from the radar section; the cap only decides which are presented as "asked of you this week".

---

## 1. Profile

### Stored (roster store, on the expert document)
`profile: { organisation: string|null (<=120), roleType: key of ROLE_TYPES|null, weeklyCap: int 1..7 (default 3), completedAt: ms|null }` plus the existing `declaration: { countries (ISO3, >=1), regions, themes }`.
- **Who may answer what is unchanged and strict** (`matches` in `core/dispatch.js`): every dimension a person declared must match (their countries; any themes; any regions). There is no soft score and no minimum-match setting (decided with the owner: it would change who can answer what, which is a sampling decision for ACAPS). A question with no theme or region is not narrowed by it.
- `themes` entries must be keys of `THEMES`. The profile screen edits countries and themes only; `declaration.regions` is left exactly as stored (staff can still set it on an invite) and `setProfile` ignores a `regions` input.
- `completedAt` is set the first time the person saves their profile. An expert without it is shown the profile screen before anything else (`needsSetup`).

### Methods (`packages/service/src/profile.js`, `createProfile(ctx)`)
| Method | Who | Behaviour |
|---|---|---|
| `getProfile(actor)` | expert, `me.manage` | `{ name, level, mode, organisation, roleType, declaration:{countries,regions,themes}, weeklyCap, needsSetup, vocab:{ themes:{key:label}, roleTypes:{key:label} } }` |
| `setProfile(actor, { organisation, roleType, countries, themes, weeklyCap })` | expert, `me.manage` | Validates every field (clear `ValidationError` messages), writes `declaration` and `profile`, sets `completedAt`, returns the same shape as `getProfile`. Audit: **none** (profile is not a staff action and the audit log never names an expert). |
| `exportFor(expert)` | export | Adds `profile` to `exportMe`. |

`setDeclaration` stays as it is (it is what `setProfile` delegates its declaration part to, or shares validation with).

### Routes
```
GET  /api/me/profile
PUT  /api/me/profile   { organisation, roleType, countries, themes, weeklyCap }
```

---

## 2. Demo mode (`BENCHMARK_DEMO=1`)

Off by default. Turned on only for showcase deployments; **never on a real pilot database** (the start-up log says so; docs/07 says so).

- `createService({ ..., demo: true })` adds `demoJoin` and `seedDemo` to the service. Without it neither exists and the routes answer 404.
- `POST /api/demo/join { name, level, mode, consentVersion, profile:{ organisation, roleType, countries, themes, weeklyCap } }` (no login, no invite): creates a **real** account from what the person typed, exactly as `redeemInvite` would (same consent text and hash, same levels, same device-held option), sets `profile.completedAt`, returns `{ sessionToken, expertId, level, mode }`. Capped at 300 demo accounts in total (`ConflictError` after that). Internally it composes `createInvite` + `redeemInvite` through a system staff actor.
- `seedDemo()` is idempotent (does nothing if a card with `demo: true` exists). It creates, **through the public service methods** (so every normal rule applies):
  - a synthetic panel of 8 experts (roster `demo: true`, levels mixed: identified, pseudonymous, anonymous) and
  - 7 forecastable cards written from real radar risks, with `riskId`, `demo: true`, spread over regions and themes so different profiles get different Pulses: 4 open in Round 1; 1 closed in Round 1 with a roundtable thread and a few approved posts; 1 in Round 2 with a released aggregate and a second-look background; 1 more open card in a sensitive country.
  - Synthetic estimates are written for the panel only. Statements are plausible forecasts, not claims about real events, and each card's `objective` starts with "DEMO:".
- `GET /api/config` (no login) -> `{ demo, deviceKeys, breakGlass, demoLabels }`: four booleans and nothing else (`docs/13-onboarding.md`). `demoLabels` is true only with `demo` on and `BENCHMARK_DEMO_LABELS` not `0`. Demo staff credentials are random per boot (or set with `BENCHMARK_DEMO_STAFF_CREDENTIALS`) and are printed to the server console only; they are never served over HTTP.
- Every screen shows `<DemoBanner/>` while `config.demoLabels` is true: "Demo data: these questions and the panel are made up to show how it works. Nothing here is a result."
- Presenter mode: `BENCHMARK_DEMO_LABELS=0` (with `BENCHMARK_DEMO=1`) hides the banner, the demo notice in the Join wizard and the `DEMO:` prefix on card objectives. Demo flags on the data, the isolation from the second-look analysis and the database refusal are unchanged. It is for presenting a showcase, not for a pilot.
- `secondLookSummary` ignores `demo` cards. (Test: a demo card with a full panel contributes nothing.) Nothing else does; see principle 5.

---

## 3. Risk browser (read-only radar)

Source: the organisers' export already in the repo, `data/risk-radar.json` (139 risks). Path override: `BENCHMARK_RADAR_FILE`. Loaded once at start-up by `packages/service/src/radar.js`; if the file is missing the browser is simply empty and the service still starts.

### Core (`packages/core/src/radar.js`, pure)
`normaliseRisk(raw)` -> `{ id, title, country, isos: string[], region, theme, riskType, status, outcome: 0|1|null, level, probability, impact, rationale, triggers:[{ id, title, description }] }`. `isos` come from the `iso` field, which may list several codes ("COD, RWA"). `region` is the region of the first iso with a mapping; `theme` is `themeOfText(title + rationale)`.
`neutralView(risk)` -> `{ id, title, country, isos, region, theme, riskType }`. Nothing else. This is what an expert may see for a risk with a live question.

### The gating rule (the point of this section)
Blind Round 1 only holds if an expert cannot read ACAPS's analysis of a risk **before** a question about it exists, because a card can be opened on any risk later. So:
- **Experts** get the full view unless a **live** card linked to the risk (open or closed; a `retired` card counts as neither) is **unanswered by them**: no Round-1 estimate on file for that card. A risk with no live card is full for every expert. A risk with a live card they have answered is full too.
- **Device-held experts**: their answers are not on the server, so any live card locks the risk for them.
- A locked risk gets `neutralView`, with `lock` (`answer` = an open card they have not answered; `closed` = the card closed before they answered; `device` = a device-held expert with a live card) and `question: { id, open, answered }` (`answered` is `null` for device-held experts). `hasQuestion: true` when a card is live.
- **Staff** (analyst, moderator) always get the full view.
- Consequence, stated plainly: while an expert has an unanswered live question on a risk, the risk's browser entry is a list of titles, places and themes, not ACAPS's reading. Answering Round 1 (or the card resolving) shows the analysis. That is deliberate.
- The same rule guards the release: `GET /api/cards/:id/release` refuses an expert who has not answered Round 1 on an unresolved card, with `403` ("answer this question first to see the circle result"). Device-held experts are always refused on an unresolved card, because the server cannot see their answer. Staff, and any expert on a resolved card, are not refused.
- A card's `theme` is chosen by the moderator, and a risk's derived `theme` (used for filtering) is classified from its **title only**, never from the hidden rationale.
- The restricted fields are `status`, `outcome`, `level`, `probability`, `impact`, `rationale` and `triggers`. They must not appear anywhere in a neutral response (tests serialise the payload and regex it).
- Response shapes: a full view is `{ view: 'full', hasQuestion, question, ...normalisedRisk, timeline }`; a locked expert's view is `{ view: 'neutral', hasQuestion, lock, question, id, title, country, isos, region, theme, riskType }`. For staff the view is always `full`.

### Methods (`radar.js`, `createRadar(ctx)`)
| Method | Who | Behaviour |
|---|---|---|
| `listRisks(actor, { q, region, theme, country, view })` | expert (`risk.read`) or staff | `[{ id, title, country, region, theme, riskType, hasQuestion, liveQuestions, answered }]`, filtered (case-insensitive text match on title and country name; exact region, theme and iso; `view` = `active` or `history`), sorted by id, never more than 200. A row for a risk the expert is locked out of carries only the neutral fields; an unlocked row also carries `level`, `probability` and `status`. |
| `getRisk(actor, id)` | same | The gated view above. 404 for an unknown id. |
| `has(id)` | internal | Used by `createCard` to validate `riskId`. |
| `hasLiveQuestion(riskId)` | internal | As defined above. |

### Routes
```
GET /api/risks?q=&region=&theme=&country=
GET /api/risks/:id
```
(Bearer expert or staff.) `createCard` accepts an optional `riskId` (must exist in the radar, else `ValidationError`) and stores it on the card.

---

## 4. Pulse (what is asked of you this week)

### Core (`packages/core/src/pulse.js`, pure)
`whyAsked(card, declaration, { responses })` -> `[{ label }]`: `Covers <ISO>` if the card's country is a declared country; `Theme match` if the card's theme is a declared theme; `The circle needs more views` if `responses < 5`. Labels only, no numbers.
`rankAsks(cards, profile, { now, responsesOf })` -> `{ asks, radar }` over the candidates the caller supplies (already eligible under the strict rule): candidates are ordered **thin circle first (fewer than 5 responses), then newer card first, then id**; **asks** = the first `profile.weeklyCap` among cards created within the last 7 days; **radar** = every other candidate (older, or beyond the cap). Every entry is `{ card, why, reason }` (`reason` = the labels joined, plus " (older than a week)" or " (beyond this week's cap)" for radar). There is no score, no region rule and no minimum-match setting.

### Method (`packages/service/src/pulse.js`, `createPulse(ctx)`)
`pulse(actor)` (expert, `inbox.read`) -> `{ week:{ from, to }, weeklyCap, asks:[entry], radar:[entry], waiting:{ revise: n, discussion: n, offers: n }, deviceMode }` where each `entry` is `{ card: cardView, why:[{label}], reason }`.
- Candidates are exactly the inbox's `toAnswer` (same eligibility, same device-held handling: for a device-held expert the server cannot know what was answered, so entries carry `deviceHeld: true` and the device filters). **Pulse never reveals a card the inbox would not.**
- `waiting` counts what is waiting on the Questions screen: Round-2 revisions, discussions, publication offers still `proposed`.
- No ACAPS rating anywhere in the response.

### Dispatch preview (same file)
`previewDispatch(actor, { cardId, draft })` (moderator, `dispatch.read`) -> `{ card:{ id|null, country, region, theme }, counts:{ ask, radar, outside, answered }, rows:[{ label, level, why, decision, reason }] }`.
- `draft` = `{ country, region, theme }` for a card not created yet; `cardId` for an existing open Round-1 card. Exactly one of the two.
- `decision`: `outside` = the strict rule would not offer this card to that person at all; `ask` / `radar` = where it lands in their own Pulse (their cap, the cards already waiting for them); `answered` = reported **only for keyed experts**. For anonymous (service-held and device-held) experts the preview never checks answers.
- `label`: the name for identified experts, the stored alias for pseudonymous ones (never created by a preview), `Anonymous expert` for the rest. **No expert id, respondent key, organisation or role type anywhere in the response.** Rows are sorted by decision then label so an anonymous row cannot be tied to a person by position.

### Routes
```
GET  /api/pulse
POST /api/staff/dispatch/preview   { cardId } | { draft:{ country, region, theme } }
```

---

## 5. Screens

### Expert app
*This section describes the earlier one-screen onboarding. The current join flow is the four-step Join wizard (`packages/web/src/expert/Join.jsx`), specified in [`docs/13-onboarding.md`](13-onboarding.md); the demo entry bullet below is superseded by it.*
- Navigation: **Pulse** (the new home) · Questions (the current inbox, unchanged) · Risks · My data.
- **Profile setup**: after signing in, if `needsSetup` the person sees the profile form before anything else. The form is also in **My data** as "My profile".
- **Demo entry**: on the landing page, only when `config.demo`: "Try the demo": the person types a name, picks a level (and the device-held option where offered), accepts the consent text, and enters their profile.
- **Pulse**: "Asked of you this week" (each with chips explaining why: `Covers TCD`, `Theme match`…), answer in place using the existing `CardView`; "On your radar, not pushed"; a strip linking to Questions when `waiting` is non-zero. Empty and error states.
- **Risks**: search and filters (region, theme, country); a list; a detail page. A risk with a live question shows only the neutral header and a plain sentence that the analysis is hidden until the question is answered or resolved, so that the answer is the person's own.
- **Round-1 answer card** (`expert/CardView.jsx`, used by Questions and Pulse): the statement, a "How this will be resolved" disclosure (the objective, the source and the resolver, all written by staff), the blind-round notice, and a slider or typed number with no starting value. Before "Lock in my estimate" the person may add, all optionally: how sure they are, a reason (600 characters at most), the basis for the estimate, and a conflict-of-interest box. Their level is shown, not chosen. Identifying details in the reason raise a warning and never block the answer. The screen sends the context with a first answer only, never with a revision. The guarantees are in the rows of `docs/05` and in amendment seven of `docs/06`. Checked in headless Chrome at 1180px and 390px in demo mode; submitting in a browser, the device-held path, the offline queue and Round 2 are not browser-checked.

### Staff app
- **Dispatch** tab: pick a risk (search the radar, full view), see its analysis, then "Draft a card from this risk" (hands the draft to the **Cards** form, pre-filled with the country, region, theme, risk id and the ACAPS rating band; the moderator writes the statement, objective, resolution source and resolver). Below it, **Preview who would be asked** (by draft or by existing card) as a table of labels, reasons and decisions with the counts. Everything the tab says about experts is label-only.
- The **Cards** form gains a risk id (read-only when drafted from a risk) and theme/region selects from `THEMES`/`REGIONS`.

---

## 6. Shared wiring already in place (not owned by any feature agent)
`taxonomy.js` constants; the four service modules as stubs; the routes in `http.js`; `GET /api/config`; the permissions `risk.read`, `dispatch.read`; `createCard` accepting `riskId`; the expert nav and views in `App.jsx`; the staff tab and `draft` state in `StaffApp.jsx`; `DemoBanner` and `Profile` stubs (the demo form `DemoJoin.jsx` and the consent form `Onboard.jsx` have since been deleted; the join flow is now the Join wizard in `packages/web/src/expert/Join.jsx`, see [`docs/13-onboarding.md`](13-onboarding.md)); the migration-free storage (everything is a document field in existing tables).

## 7. Decisions that belong to ACAPS
1. Whether the risk browser should show experts any ACAPS analysis at all before a question resolves (the build says no).
2. The region and theme heuristics: they are guesses that ACAPS should confirm.
3. The default `weeklyCap` (3), and whether matching should ever become soft (neighbouring regions, a per-person threshold): that changes who can answer what.
4. Whether demo mode is ever allowed on a public URL.
