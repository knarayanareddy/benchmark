# Benchmark — ACAPS *Ground Truth*

A ninety-second expert card that turns each ACAPS risk statement into a probability, with an interval, plus a dissent loop that routes objections back into the wording of the risk.

**Status: a verified core and a service layer, not a deployed product. No panel has been run.**

**The one number.** ACAPS' own probability rating scores **0.2171** Brier on the 104 resolved risks; a logistic regression on the same fields scores **0.2177**. At n=104 the two are **indistinguishable from each other and from the base rate** (paired intervals span zero), so this is a bar to test against prospectively, not a finding. Reproduce it with `npm run ladder`.

```
npm run verify    # 142 tests, anonymity / privacy / numbers / export gates, baselines, dissent journey
npm run serve     # the HTTP service (needs secrets; see packages/service/bin/serve.mjs)
```

**Built:** scoring, aggregation and release rules, the gate, dispatch, anonymity levels, the dissent loop; a service layer with invites, roles, audit, a release ledger, erase/export, and an HTTP API; a Postgres schema.
**Not built:** the interface, a Postgres adapter, staff SSO, break-glass, a DPIA. 86.2% is the lexical `observable` warning's precision on 50 labelled items.

Start with [`BUILD.md`](BUILD.md). Everything else, including the module map and the six measured facts, is in [`docs/00-overview.md`](docs/00-overview.md). Historical documents live in [`archive/`](archive/).
