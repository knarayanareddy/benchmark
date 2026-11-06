# Benchmark — ACAPS, *Ground Truth*

A ninety-second elicitation that turns each of ACAPS' own risk statements into a probability, without asking any expert to read more than one card — plus a dispatch layer that puts the right question in front of the right expert, and a dissent channel that routes objections back into the language of the risk rather than only its number.

**Status: runnable scaffold, not a product.** The pure core, the shared spine, the gate, the dissent loop and 35 tests are real and green, and they run against the real 139-risk export. The interface layer is not built — see `BUILD.md`. Note that Benchmark carries one risk Doorway does not: its central claim is unproven and cannot be proven this weekend.

```bash
npm run verify     # 35 tests, privacy gate, numbers gate, gate on the real export, baselines, dissent journey
npm run ladder     # regenerates the three baseline figures from data/
```

---

## Read in this order

| # | Document | What it is | Read time |
|---|---|---|---|
| 1 | [`design/BENCHMARK-blueprint.html`](design/BENCHMARK-blueprint.html) | **The build blueprint.** Architecture, schemas, dissent lifecycle, dispatch layer, scoring module, repo tree, build order, acceptance tests, pitch script. Sections 07–10 and 14–17 are ACAPS-specific. | 45 min |
| 2 | [`research/market-landscape.html`](research/market-landscape.html) | **The market analysis.** Four layers, the nine ways this dies, the methods literature, and §08 (revised) on the UNICRI layer. | 40 min |
| 3 | [`research/00-challenge-analysis.html`](research/00-challenge-analysis.html) | The original end-to-end read of the ACAPS challenge and its data. | 20 min |
| 4 | [`research/02-repo-audit.html`](research/02-repo-audit.html) | What is actually in the ACAPS starter repo, file by file. | 15 min |
| 5 | [`design/01-project-directions.html`](design/01-project-directions.html) | Fourteen possible directions, scored. Context for why Benchmark is shaped the way it is. | 20 min |
| 6 | [`design/03-product-blueprint.html`](design/03-product-blueprint.html) | The earlier product design. **Partly superseded** by the blueprint — kept for the reasoning, and because the earlier framing had the Brier benchmark wrong. | 20 min |
| 7 | [`planning/BENCHMARK-plan.html`](planning/BENCHMARK-plan.html) | The original planning document. Superseded by the blueprint; retained for the build-order reasoning. | 20 min |
| 8 | [`planning/product-audit.html`](planning/product-audit.html) | The 17-finding audit of both products. §09 is the ACAPS audit and contains the finding that reshaped the pitch. | 25 min |
| 9 | [`mockups/benchmark-expert-flow.html`](mockups/benchmark-expert-flow.html) | The expert flow, as a mockup. | 5 min |
| 10 | [`design/04-adoption-review.md`](design/04-adoption-review.md) | **What ACAPS' own methodology tells us, and what we adopt.** Five adoptions, one correction to our weighting design, one refusal. | 14 min |
| 11 | [`docs/01-one-pager.md`](docs/01-one-pager.md) | The submission one-pager. | 2 min |
| 12 | [`docs/03-the-gap-to-real.md`](docs/03-the-gap-to-real.md) | **Read this before claiming it works.** | 10 min |

---

## The thesis in three numbers

- **266** dated trigger statements across **139** risks — statements are the unit with volume, not risks. **104** resolved.
- **~17%** is the one published response rate for this behaviour: ACAPS surveyed *more than 60* external experts for its Afghanistan risk report and **ten replied**. That is the closest thing to a baseline for the exact behaviour a panel depends on, and it is a survey response rate — not matrix completion, a figure earlier drafts of this file got wrong.
- **101 of the 139 triggers that carry a completion rate carry no written resolution criterion** — 73% of ACAPS's own progress tracking is measured against something unstated.
- **31 of 139 risks have no triggers at all**, **11 have no probability rating** and **7 have no status**. The corpus is a working export, and every one of those gaps is a place where an expert could add something in ninety seconds.
- The performance ladder: naive floor **0.2425** → **ACAPS' own judgement 0.2168** → a logistic regression **0.2177** out of sample. **Lower is better, so the regression lost to the experts.** All three rungs are measured by scripts in this repo (`npm run ladder`); none is quoted.
- At n ≈ 104 the standard error on a Brier score is **0.04–0.05**, so neither gap in that ladder is distinguishable from zero.

---

## The five things that must be true

1. A dissent can be raised, actioned and notified in under sixty seconds.
2. Every score on screen has an interval beside it.
3. The gate rejects at least one real statement from the export, with a reason.
4. The card completes in ninety seconds on a phone, one thumb.
5. Somebody can say "the bar is ACAPS' 0.2168, and our regression lost" without hesitating — and can show the two scripts that compute it.

---

## What this is not

Nothing here is a working product. And unlike Doorway, Benchmark has a second problem: **no panel has ever been run, and a regression on ACAPS' own fields does not beat ACAPS' own analysts.** The honest position is a pre-registered hypothesis, which is a legitimate submission and a weaker one than "here is the number." See [`docs/03-the-gap-to-real.md`](docs/03-the-gap-to-real.md) §4.

---

*Compiled 6 November 2026 · Hackathon for Good #8 · The Hague.*
