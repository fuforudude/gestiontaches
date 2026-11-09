import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/serveur.ts', 'src/outils/**'],
      thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 },
    },
  },
});
