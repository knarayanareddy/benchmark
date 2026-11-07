# Benchmark — ACAPS *Ground Truth*

A ninety-second expert card that turns each ACAPS risk statement into a probability, with an interval, plus a dissent loop that routes objections back into the wording of the risk.

**Status: a verified core, a service with a database, sign-in and usable pages, and a card-authoring pipeline. Not deployed. No panel has been run.**

**The one number.** ACAPS' own probability rating scores **0.2171** Brier on the 104 resolved risks; a logistic regression on the same fields scores **0.2177**. At n=104 the two are **indistinguishable from each other and from the base rate** (paired intervals span zero), so this is a bar to test against prospectively, not a finding. Reproduce it with `npm run ladder`.

```
npm ci && npm run verify   # 217 tests and 12 other checks, one pass/fail table
npm run serve              # the service and its pages (needs secrets; see docs/07-deploy.md)
npm run worklist           # triage every headline and trigger for a human author
```

**Built:** scoring, aggregation and release rules, the gate, dispatch, anonymity levels, the dissent loop; a service on Postgres with invites, roles, audit, a release ledger, erase/export; OpenID Connect staff sign-in; HTML pages for experts and staff; type-checking, lint and an audit in CI.
**Not done, and not code:** nobody has written the objectives for the cards (0 of 28 Active risks can open yet; 20 need a measurable threshold, 8 need an objective, source, window and resolver), two human raters have not re-measured the `observable` check (86.2% precision, 95% interval 69–95%, on 50 items by one rater), SSO has not met a real identity provider, the container files have never been run, and there is no DPIA.

Start with [`BUILD.md`](BUILD.md). Everything else, including the module map and the six measured facts, is in [`docs/00-overview.md`](docs/00-overview.md). Historical documents live in [`archive/`](archive/).
