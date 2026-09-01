import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    // Isolated build dir used by the Playwright E2E dev server (mirrors .next). The sharded
    // runner gives each shard its own port and its own dist dir beside it (`.next-e2e-3100`,
    // `-3101`, …), which `.gitignore` already covers as `/.next-e2e-*/` and this did not — so a
    // sharded run left ~2300 lint errors in build output and `npm run lint` could not be used
    // until the dirs were deleted.
    '.next-e2e/**',
    '.next-e2e-*/**',
    // Playwright's own output. Tracked nowhere (`.gitignore`), and its bundled report viewer is
    // minified vendor JS.
    'playwright-report/**',
    'test-results/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
]);

export default eslintConfig;
