import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'archive/**', 'data/**', 'mockups/**', 'organiser/**', 'coverage/**', 'dist/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-throw-literal': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },
  {
    // Browser code: no Node globals, and the DOM sinks that cause XSS are banned outright.
    files: ['packages/service/public/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-properties': ['error',
        { property: 'innerHTML', message: 'Use textContent / el(); page content must never become markup.' },
        { property: 'outerHTML', message: 'Use el().' },
        { property: 'insertAdjacentHTML', message: 'Use el().' }],
    },
  },
  {
    // Vendored spine: copied verbatim into a sister repo and fingerprinted, so it is not edited here.
    files: ['packages/shared/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { 'no-unused-vars': 'off', 'prefer-const': 'off' },
  },
];
