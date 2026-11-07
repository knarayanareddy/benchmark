# Onboarding: a four-step "Join the circle" wizard

**Status: built and tested; the demo-mode path was clicked through in a browser; never used by real invitees.** Replaces the one-screen consent form (`Onboard.jsx`, deleted) and the demo form (`DemoJoin.jsx`, deleted) with one guided flow, modelled on the prototype's `JoinFlow` (invitation, expertise, visibility, rhythm), on this repository's engine. Read `docs/05`, `docs/10` first.

## Principles
1. **One person, one invite.** Invitations stay single-use, bound to a person. There are no shared circle codes and no clickable demo codes. Step 1 accepts the personal link (already carried in the address) or a pasted link or code.
2. **The visibility preview is written from the consent text's own source.** Each level card and its "what each audience sees" panel is built from `LEVEL_COPY` (`@benchmark/core/anonymity`), the same source `consentText` uses, so what a person reads while choosing and what they accept cannot disagree. The prototype's claim "ACAPS doesn't know who I am either" for an alias is FALSE here (a pseudonymous expert is known to ACAPS) and must not appear.
3. **The exact consent text is still shown and still accepted before anything is created** (step 4, for the chosen level and mode). Its hash is what the service stores.
4. **Advice is labelled as advice.** "Recommended for you" is a hint, never a default, and says why.
5. **Honest scope.** There is no verification-evidence step (we have no verification queue) and no honour-roll language ("On the stage"). Named public credit is a separate, per-item consent after the fact.

## Steps (pills show done / now / todo; Back and Continue; every step validates on click)
1. **Invitation.** If the page address carries `#invite=<token>`: "Your invitation was recognised." and Continue. Otherwise a field "Paste your invitation link or code" (accepts a full link containing `invite=<token>` or the raw token; trims spaces). In demo mode this step is skipped and its pill shows it done; the demo starts at step 2, and it is entered from the landing screen's "Join the demo" button, with no invitation. On step 2, a button "Fill with an example" pre-fills the form with a made-up example profile the person can edit (labelled as an example; never a persona to impersonate).
2. **Your expertise.** Demo only: your name (the pilot's name comes from the invitation staff wrote). Organisation (optional; "Only you see this."). Role: single-select chips from `ROLE_TYPES` (optional). Countries: searchable chips by country NAME (never typed ISO codes), at least 1, at most 6 (`MAX_COUNTRIES`), selected ones shown first. Themes: multi-select chips from `THEMES` (optional). Short plain text: what you declare decides which questions we ask you, never how much weight your answers carry.
3. **Your visibility.** Three cards (Known = `identified`, Pseudonymous, Anonymous) in the prototype's layout with the tagline and a "What each audience sees" panel from `LEVEL_COPY` plus the fixed lines: the public sees aggregates only (`PUBLIC.minCount`), and for anonymous the safety line is the override sentence or the no-override sentence, depending on `breakGlass`, and it names the device-held case in both. Anonymous has the nested option "Keep my key on this device only", offered only when `deviceKeys`. A "Recommended for you" tag: on Pseudonymous by default; on Anonymous when any chosen country is in `DEFAULT_SENSITIVE_COUNTRIES` (`@benchmark/core/sensitive`), with the reason shown ("you cover a context where being named can put people at risk"). Choosing a level fetches `GET /api/consent/<level>[?mode=device]`.
4. **Your rhythm and confirmation.** Weekly cap chips 1, 2, 3, 5 (default 3), explanatory line ("We only ask about <countries> and your chosen themes. You will see anything else, such as a reply to something you raised, when you visit; nothing is sent to your phone or email."). A summary of everything chosen (name only in demo, countries by name, themes, visibility, cap). The consent text for the chosen level and mode (full, readable). Device-held: the recovery code panel and "I have saved my recovery code", shown on this step. The checkbox "I have read this and I choose this level." Then "Join the circle".

## What "Join" does
- Pilot: `POST /api/invite/redeem { token, level, consentVersion, mode }` -> session; then `PUT /api/me/profile { organisation, roleType, countries, themes, weeklyCap }` with that session. If the profile save fails after the account exists, the person is still signed in and lands on the profile setup screen (`needsSetup`, the recovery path). The failure message is **not shown** to the person.
- Demo: `POST /api/demo/join { name, level, mode, consentVersion, profile }` (unchanged contract).
- Then `onDone({ token, mode, level })` as today. Errors in role="alert". The recovery secret rules (create on choosing device, clear on switching off) are unchanged.

## /api/config
`GET /api/config` returns exactly four booleans and nothing else, each from its own flag in `packages/service/bin/serve.mjs`:

```json
{ "demo": false, "deviceKeys": true, "breakGlass": true, "demoLabels": false }
```

- `demo`: `BENCHMARK_DEMO=1`.
- `deviceKeys`: a blind-signature key is configured (`BENCHMARK_BLIND_KEY` or `BENCHMARK_BLIND_KEY_FILE`). The wizard offers a device-held key only when the server can issue one.
- `breakGlass`: a break-glass public key is configured (`BENCHMARK_BREAKGLASS_PUBLIC_KEY` or `..._FILE`). It decides whether the anonymous safety line describes the override or says that nobody can open an objection.
- `demoLabels`: true only when `demo` is on and `BENCHMARK_DEMO_LABELS` is not `0`. Presenter mode (`BENCHMARK_DEMO_LABELS=0`) answers false: the demo notice in the Join wizard and the demo banner are hidden. Demo flags on the data are unchanged.

Key material is never returned. The client (`lib/config.js`) treats any failure, or any `demo`, `deviceKeys` or `breakGlass` value that is not `true`, as off. It treats `demoLabels` the other way: only a literal `false` hides the label, so an unreadable config keeps the demo label on.

## Components (all under packages/web/src)
- `components/StepPills.jsx`: `StepPills({ steps: string[], current: number })` ordered list, `aria-current="step"`.
- `components/ChipGroup.jsx`: `ChipGroup({ label, options:[{value,label,hint?}], value, onChange, multiple=false, max?, describedBy? })`; chips are `<button type="button" aria-pressed>` in a `role="group"` labelled by `label`; at max, unselected chips are disabled and a note says so. A weekly-cap chip cannot be cleared once chosen.
- `components/CountryPicker.jsx`: `CountryPicker({ value: string[], onChange, max })`: a search box (filters by name, case and accent tolerant) over chips for `COUNTRY_NAMES`, selected chips pinned first, count "N of 6 chosen".
- `expert/Join.jsx`: `Join({ api, invite, demo, deviceKeys, breakGlass = false, demoLabels = true, onDone, onCancel })`. `App.jsx` passes `breakGlass`, `demoLabels` and `deviceKeys` from `GET /api/config`.
- Core `packages/core/src/onboarding.js`: `MAX_COUNTRIES`, `CAP_OPTIONS`, `STEPS`, `COUNTRY_NAMES`, `countryName(iso)`, `searchCountries(q)`, `levelCards({ breakGlass })`, `recommendedLevel(countries, sensitive?)`, `validateStep(n, state)` (returns every problem at once), `parseInvite(input)`.

## Deviations from the first plan
These were decided during the build and are recorded so they are not mistaken for the spec:
- **Demo mode skips the invitation step.** The demo starts at expertise, and the pill for step 1 shows it done.
- **The recovery code appears on step 4**, next to the consent text, not on the device-key choice.
- **Switching the device key off clears the secret** from this device, and switching it on creates a new one.
- **Weekly-cap chips cannot be cleared.** One of 1, 2, 3 or 5 is always chosen (default 3).
- **Join and Continue are always enabled** and validate on click, so a person sees every problem at once instead of a disabled button.
- **A failed profile save is silent to the person.** They are signed in and land on the profile setup screen; the reason is not shown.

## Not built, by design
Shared circle codes; verification evidence and queue; peer vouching; the prototype's persona demo codes; honour-roll opt-in.

## Not yet checked
The pilot invitation path, the device-held path in a browser, and a phone-width pass beyond screenshots. Only the demo-mode path (expertise, visibility, confirm, join) was clicked through, in headless Chrome.
