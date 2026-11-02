import prettier from 'eslint-config-prettier';
import { fileURLToPath } from 'node:url';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import typescriptParser from '@typescript-eslint/parser';

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

/** @type {import('eslint').Linter.Config[]} */ export default [
  includeIgnoreFile(gitignorePath),
  { ignores: ['vendor/**', 'vendor-src/**', 'src/routes/.well-known/workflow/**'] },
  js.configs.recommended,
  ...svelte.configs.recommended,
  prettier,
  ...svelte.configs.prettier,

  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } }
  },

  {
    files: ['**/*.svelte', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        parser: { ts: typescriptParser, typescript: typescriptParser },
        svelteConfig: { compilerOptions: {} }
      }
    }
  }
];
