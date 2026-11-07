# Situation evolution: timelines, panel series, regional grid, analyst links

**Status: built and tested; the staff Evolution tab and Dispatch timeline were checked in a browser; never used by real analysts or experts.** Answers an expert's request to "map how a situation has evolved". Read `docs/11-questions-for-acaps.md` first: it says what the data can and cannot support and what we assume. Privacy rules: `docs/05`, `docs/10`.

## Principles
1. **Blind Round 1 covers the timeline.** A risk's timeline is ACAPS analysis. It follows the radar rule exactly (`docs/10`, section 3): an expert is held back only while a live card on the risk that is put to them (matches their declaration) is unanswered by them (device-held experts: any matching live card holds it back); an expert never asked a question on the risk sees it; staff always. It lives INSIDE the full risk view and is never part of the neutral view.
2. **Real data only, labelled as recorded.** Dates are "as recorded by ACAPS". No durations or lags are computed from them. Completion rate is shown as "analyst-recorded, meaning not standardised", never as a probability. Triggers have no probability of their own: none is derived from the parent risk's band or from a completion rate. The timeline shows only what the export holds; no ACAPS history beyond it is assumed, and no ACAPS data is needed to build or to register anything here.
3. **No automatic cross-risk inference.** A link between two questions is created only by a moderator, with a stated mechanism and a rival explanation, and is labelled "analyst judgement".
4. **Panel series respect the release floor.** A round with fewer than 5 respondents is never shown; intervals accompany every point; no per-person trajectories; times are day-coarse. Staff only for now.
5. **Small cells are marked, not hidden, in the staff grid** (counts of radar risks and cards; no expert data), and the grid says cells under 10 are descriptive only.

## 1. Data: timeline fields (ingest + core)
`scripts/ingest.py` keeps every existing field of `data/risk-radar.json` unchanged and ADDS:
- per risk: `riskTrend` (string|null), `rationaleUpdates: [{ date: 'YYYY-MM-DD', text }]` parsed from "Rationale update" (headers `UPDATE dd/mm/yyyy`, day-first; text before the first header, if any, is kept as an entry with `date: null`);
- per trigger (inside `triggerList`): `completionHistory: [{ date, value }]` and `trendHistory: [{ date, value }]` (`date` ISO, `value` an integer percent / the trend word), in file order, same-day entries kept in file order; `dateEntered` and `lastUpdate` as ISO.
`packages/core/src/timeline.js` (pure): `buildTimeline(risk)` -> `{ riskTrend, rationaleUpdates, triggers:[{ id, title, completion:[{date,value}], trend:[{date,value}], dateEntered, lastUpdate, movement:{ completion:'up'|'down'|'flat'|'none', trend } }], span:{ from, to }|null, points: n }` plus `hasHistory(risk)`. Same-day conflicting entries are flagged `conflict: true` on the point. `core/src/radar.js normaliseRisk` carries the fields through (as `timeline` source data) but `neutralView` must stay exactly its seven keys.
Service: the FULL risk view (`getRisk`) gains `timeline` (the output of `buildTimeline`). Neutral views and list rows never carry it.

## 2. Panel series (staff)
`core/src/series.js` (pure): `buildSeries(releases, { floor = 5 })` -> `{ points:[{ round, day, n, estimate, lo, hi }], withheld:[{ round }] }` from the ledger documents of one card (`answers.releases`: `{ cardId, round, n, closed, at, snapshot }`; read `service.js cardRelease` and `core/aggregate.js releaseAggregate` for the exact shape of `snapshot`). A release whose `n < floor` or whose snapshot is suppressed goes to `withheld` (no numbers). `day` is `YYYY-MM-DD` from `at`.
The service passes ONLY ledger documents with `closed: true` and `visibility: 'panel'` (never an open round's snapshot, which would reintroduce sequential differencing, see `docs/05`), taking the one with the largest `n` per round. Estimates, `lo` and `hi` are FRACTIONS in [0,1] on the wire; the UI multiplies by 100.
Service `GET /api/staff/cards/:id/series` (permission `evolution.read`, analyst and moderator): `{ cardId, statement, status, points, withheld, note }`. `note` says plainly there are at most two rounds per card and later windows are new cards.

## 3. Regional grid (staff)
`core/src/grid.js` (pure): `buildGrid(risks, cards)` -> `{ regions, themes, cells:[{ region, theme, risks, cards, live, small }], minCell: 10 }` counting radar risks (by derived region/theme) and cards (by card region/theme, with `riskId` region as fallback), `live` = cards open or closed, `small` = risks < 10. No expert or answer data.
Service `GET /api/staff/evolution/grid` (permission `evolution.read`).

## 4. Analyst links (staff)
Store: `answers.card_links` documents `{ id, fromCardId, toCardId, mechanism, rival, by, day, version }` (migration `0008_card_links.sql`). `core/src/links.js` (pure): `validateLink(input)` -> `{ ok, problems, link }`: both ids non-empty and different; `mechanism` 20..500 chars and `rival` 20..500 chars after trimming (the rival explanation is REQUIRED); `downstream(links, cardId, { maxDepth: 3 })` -> `[{ cardId, depth, via }]`; `wouldDuplicate(links, from, to)`.
Service: `GET /api/staff/links` -> `[{ id, fromCardId, toCardId, fromStatement, toStatement, mechanism, rival, by, day }]`; `POST /api/staff/links { fromCardId, toCardId, mechanism, rival }` (moderator; both cards must exist; no duplicate ordered pair; audit `link.create` with the link id only); `DELETE /api/staff/links/:id` (moderator; audit `link.remove`). Permission `evolution.link` (moderator) and `evolution.read` (analyst, moderator).
Every link is displayed with "Analyst judgement, not a finding", its mechanism and its rival explanation.

## 5. Screens
- **Risk detail (full view only):** `Timeline` section: a step chart per trigger for completion rate (0..100%) and a marker row for trend (Deteriorated / Stable / Improved), the dated rationale updates as a list, and the caption "Dates and values as recorded by ACAPS analysts. Completion rate is a judgement whose meaning has not been standardised." Never rendered for a neutral view, even if the payload contains it.
- **Staff Evolution tab (new):** (a) Panel series: pick a card, see rounds with intervals or "withheld: fewer than 5 respondents"; (b) Regional grid: region x theme table of risk and card counts, small cells marked "descriptive only"; (c) Links: list, create (two card selects, mechanism, rival), remove, and for a chosen card the downstream chain.
- `StepChart` is an accessible SVG component (title, desc, a data table alternative, no colour-only meaning).

## 6. Not built, by design
Automatic cascade detection; correlation statistics between questions (not detectable at pilot scale. This is an estimate from the planner's prototype, not measured by a script in this repository; the power specification is in progress as `docs/14` and is not yet written); expert-facing panel series; anything that treats completion rate as a probability.
