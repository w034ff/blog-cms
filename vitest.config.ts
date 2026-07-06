import path from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

const root = process.cwd();

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.{test,spec}.ts'],
    // The Playwright E2E specs under e2e/ are also *.spec.ts, but must never run
    // under vitest (they import @playwright/test and drive a real browser). The
    // Stop hook runs `vitest run`, so excluding them keeps that hook green.
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // Reset mock call history between tests so counts/return queues don't leak.
    clearMocks: true,
    alias: [
      // Mirror the tsconfig "@/*" → "./*" path alias for test resolution.
      { find: /^@\//, replacement: `${root}/` },
      // `server-only` throws when imported outside an RSC bundle (Node has no
      // `react-server` export condition), so stub it to an empty module for tests.
      { find: /^server-only$/, replacement: path.join(root, 'test/server-only-stub.ts') },
    ],
  },
});
