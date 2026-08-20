// ESLint flat config (ESLint 10 compatible).
//
// NOTE: Full TypeScript linting requires `@typescript-eslint/parser` (and
// ideally `eslint-config-next`) to be installed. Those packages are not
// present in node_modules and cannot be added in a locked-down environment,
// so this config currently lints only the JavaScript files that ESLint's
// built-in parser can parse. Once `@typescript-eslint/parser` is installed,
// add a `files: ['**/*.{ts,tsx}']` block with `parser:
// '@typescript-eslint/parser'` to cover TypeScript sources.

export default [
  {
    ignores: ['node_modules/**', '.next/**', 'out/**', 'build/**', 'next-env.d.ts'],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly',
        Request: 'readonly', Response: 'readonly', fetch: 'readonly', crypto: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly',
        clearInterval: 'readonly', globalThis: 'readonly', __dirname: 'readonly',
        require: 'readonly', module: 'readonly', exports: 'readonly', AbortController: 'readonly',
        FormData: 'readonly', Headers: 'readonly', File: 'readonly', Blob: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error', 'no-dupe-keys': 'error', 'no-dupe-args': 'error',
      'no-duplicate-case': 'error', 'no-unreachable': 'error', 'no-func-assign': 'error',
      'no-import-assign': 'error', 'no-obj-calls': 'error', 'no-unsafe-finally': 'error',
      'use-isnan': 'error', 'valid-typeof': 'error', 'no-cond-assign': 'error',
      'no-const-assign': 'error', 'no-delete-var': 'error', 'no-global-assign': 'error',
      'no-invalid-regexp': 'error', 'no-octal': 'error', 'no-redeclare': 'error',
      'no-with': 'error', 'no-shadow-restricted-names': 'error',
    },
  },
];