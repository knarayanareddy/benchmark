# @benchmark/product

Product-specific layer. `dissent.js` is here and tested; the React PWA interface
is not written.

The logic that matters already lives in two tested places:

- `packages/shared/` — the card, validation, loop and a11y primitives
- `packages/core/` — scoring, the gate, dispatch

The interface (card screen, declaration grid, analyst desk) goes here.
