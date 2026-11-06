# Working on Benchmark

## Before you push

```bash
python3 scripts/ingest.py && npm run verify
```

## The three rules that cannot be broken

1. **Every score has an interval.** If you add a display path, it must call `bootstrapBrier()` or `paired()`, not compute a mean.
2. **Comparisons are paired, on the same items.** Never compare two independent Brier scores.
3. **Unobservable outcomes are excluded, not scored as misses.** `Active` is not `Not materialised`.

## Where logic goes

- **Pure, testable → `packages/core/src/`** — scoring, gate, dispatch. Reviewed hardest.
- **Stateful flows → `packages/benchmark/src/`** — dissent lifecycle.
- **Data → `data/risk-radar.json`**, produced only by `scripts/ingest.py`.

## The claim you must not oversell

**The bar is ACAPS' own judgement, at 0.2168 — not the regression.** Out of sample a logistic regression on the same structured fields scores 0.2177 — marginally *worse*. An earlier revision of this project had these numbers backwards, called the regression "the bar to beat", and used a model that was fitting the same field twice (Risk Level is a pure function of Probability, 125/125). Both corrections are recorded in `packages/core/src/scoring.js`. Run `npm run ladder` and you get 0.2425 / 0.2168 / 0.2177 back. Any copy claiming a model beat ACAPS is wrong.
