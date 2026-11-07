import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['node_modules/**', 'archive/**', 'data/**', 'mockups/**', 'organiser/**', 'coverage/**', '**/dist/**', 'packages/simulate/out/**'] },
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
    // The React apps: browser globals, JSX, hooks rules, and the DOM sinks that cause XSS banned outright.
    files: ['packages/web/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser }, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Components used only in JSX look "unused" without a React lint plugin (none supports ESLint 10 yet).
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^[A-Z]', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-restricted-properties': ['error',
        { property: 'innerHTML', message: 'Use JSX; page content must never become markup.' },
        { property: 'outerHTML', message: 'Use JSX.' },
        { property: 'insertAdjacentHTML', message: 'Use JSX.' }],
    },
  },
  {
    // Build configuration and the service worker.
    files: ['packages/web/vite.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['packages/web/public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
    rules: { 'no-undef': 'error' },
  },
  {
    // Vendored spine: copied verbatim into a sister repo and fingerprinted, so it is not edited here.
    files: ['packages/shared/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { 'no-unused-vars': 'off', 'prefer-const': 'off' },
  },
];
