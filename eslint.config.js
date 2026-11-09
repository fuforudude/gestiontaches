import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  // Le script de la page tourne dans le navigateur, sans TypeScript.
  { files: ['public/**/*.js'], ...tseslint.configs.disableTypeChecked },
  {
    files: ['public/**/*.js'],
    languageOptions: { globals: { document: 'readonly', window: 'readonly', fetch: 'readonly', navigator: 'readonly', confirm: 'readonly', prompt: 'readonly', location: 'readonly', setInterval: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', URLSearchParams: 'readonly' } },
  },
  { files: ['eslint.config.js'], ...tseslint.configs.disableTypeChecked },
);
