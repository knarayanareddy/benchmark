# @hfg8/core — the shared spine

**Card · Route · Counter · Loop.**

Four primitives, ~430 lines, zero dependencies. Copied verbatim into both the
Doorway and Benchmark repositories so that each one stands alone: no shared
package registry, no sibling checkout, no build step.

This code is **byte-identical in both repos on purpose.** If you find yourself
editing it differently in one of them, the change almost certainly belongs in
that product's own package instead.

```bash
node --test core.test.js     # 16 tests
```

---

## The four primitives

| Module | What it is | Used by |
|---|---|---|
| `card.js` | The decision surface. Shadow-DOM mounted, one primary action, phone-first, descriptor-validated so a headline that will not fit 320px is refused at build time rather than discovered in a demo. | Doorway (the warning gate) · Benchmark (the estimate card) |
| `validate.js` | Strict whitelist validation. **Unknown keys are rejected, not stripped** — a silently stripped identifier is an identifier someone believed they had removed. Plus k-anonymity suppression and a rate that cannot exist without its denominator. | Doorway (the eight-field counter) · Benchmark (export shape) |
| `loop.js` | The return path. Tells a person what their action caused. Doorway: service-side arrival counts. Benchmark: "your dissent changed the statement." | Both |
| `a11y.js` | Focus trap, reduced-motion detection, plain-language linting, screen-reader announcement. | Both |

---

## Why these four and not more

The two products genuinely diverge on content, routing tables, inference and
buyer. They genuinely agree on exactly four things: **a ninety-second card, a
deterministic route, a counter that cannot identify anyone, and a loop that
closes back to the person.** Anything outside that list belongs in the product
package.

## The rules this package encodes

1. **A card with no primary action is refused.** A gate with no way forward is a trap.
2. **Unknown keys are rejected.** Silent stripping is how identifiers survive a "removal".
3. **A rate is never reported alone.** `rate(n, d)` returns `d` alongside the value and flags small denominators.
4. **Loop messages never name a person who was helped.** And a non-causal arrival claim is labelled `association, not attribution`.
5. **Plain language is a build-time rule.** `MAX_SENTENCE_WORDS = 20`, enforced by lint, not by good intentions.
