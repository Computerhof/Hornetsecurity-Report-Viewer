/* ESLint-Konfiguration (Flat Config). `npm run lint:js` */
'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['dist/**', 'local/**', 'node_modules/**', '*.html'] },
  js.configs.recommended,
  {
    /* Browser-Code: klassische Skripte, die build.ps1 in die HTML-Datei einsetzt */
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: { ...globals.browser }
    }
  },
  {
    /* core.js exportiert zusätzlich per module.exports für die Node-Tests */
    files: ['src/core.js'],
    languageOptions: { globals: { module: 'readonly' } }
  },
  {
    /* ui.js liest PRVCore aus core.js (gleiche HTML-Seite) */
    files: ['src/ui.js'],
    languageOptions: { globals: { PRVCore: 'readonly' } }
  },
  {
    /* Node-Skripte: Tests, Generator, Gates, diese Datei */
    files: ['test/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    }
  },
  {
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'off', /* Browser-Code bewusst im ES5-Stil */
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-eval': 'error'
    }
  }
];
