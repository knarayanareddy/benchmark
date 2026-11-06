/**
 * @hfg8/core — the shared spine.
 *
 * Card · Route · Counter · Loop. Copied verbatim into both repositories so each
 * one stands alone. Do not add product-specific logic here; if Doorway and
 * Benchmark would diverge, it belongs in the product package instead.
 */
export * as card from './card.js';
export * as validate from './validate.js';
export * as loop from './loop.js';
export * as a11y from './a11y.js';

export const SPINE = Object.freeze(['Card', 'Route', 'Counter', 'Loop']);
export const VERSION = '0.1.0';
