import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module; keep it out of the bundle so it runs from node_modules.
  serverExternalPackages: ['better-sqlite3'],
  // Allow an isolated build dir so a second dev server (the Playwright E2E harness)
  // can run alongside `npm run dev` without sharing .next or its dev-server lock
  // (<distDir>/dev/lock). Unset = the default .next, so normal dev is unchanged.
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

// In E2E mode (NEXT_DIST_DIR set) the harness runs a second dev server, and Next
// auto-writes its generated-type includes into the tsconfig it uses. Redirect that
// to a throwaway tsconfig.e2e.json (gitignored, created by e2e/prepare-db.mts) so
// the tracked tsconfig.json is never rewritten.
if (process.env.NEXT_DIST_DIR) {
  nextConfig.typescript = { tsconfigPath: 'tsconfig.e2e.json' };
}

export default nextConfig;
