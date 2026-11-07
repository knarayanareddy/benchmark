# Benchmark — ACAPS *Ground Truth*

A ninety-second expert card that turns each ACAPS risk statement into a probability, with an interval, plus a dissent loop that routes objections back into the wording of the risk.

**Status: a verified core; a service on Postgres with migrations, SSO, a two-moderator safety override and device-held anonymous ballots; an installable React app for experts and staff; and a card-authoring pipeline. Not deployed. No panel has been run.**

**The one number.** ACAPS' own probability rating scores **0.2171** Brier on the 104 resolved risks; a logistic regression on the same fields scores **0.2177**. At n=104 the two are **indistinguishable from each other and from the base rate** (paired intervals span zero), so this is a bar to test against prospectively, not a finding. Reproduce it with `npm run ladder`.

```
npm ci && npm run verify   # 338 tests inside 15 checks, one pass/fail table
npm run serve              # the service and its pages (needs secrets; see docs/07-deploy.md)
npm run worklist           # triage every headline and trigger for a human author
```

**Built:** scoring, aggregation and release rules, the gate, dispatch, anonymity levels, the dissent loop; a service on Postgres with invites and re-invites, roles, audit, a release ledger, erase/export, forward-only migrations; OpenID Connect staff sign-in; the safety override; blind-signed ballots; React apps with an offline queue; type-checking, lint, an audit and component tests in CI.
**Not done, and not code:** nobody has written the objectives for the cards (0 of 28 Active risks can open yet), two human raters have not re-measured the `observable` check (86.2% warn precision on 50 items by one rater; 95% interval 69–94%), **the blind-signature code has not been reviewed by a cryptographer**, SSO has not met a real identity provider, the container files and the installed app have never been run on a real host or phone, and there is no DPIA.

Start with [`BUILD.md`](BUILD.md). Everything else, including the module map and the six measured facts, is in [`docs/00-overview.md`](docs/00-overview.md). Historical documents live in [`archive/`](archive/).
