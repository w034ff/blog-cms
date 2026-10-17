import { describe, expect, it } from 'vitest';
import { namesTargets } from './e2e-args.mts';

describe('namesTargets', () => {
  it.each([
    [['e2e/search.spec.ts']],
    [['e2e/search.spec.ts:42']],
    [['--repeat-each=5', 'e2e/a.spec.ts', '--workers=1']],
    [['--last-failed']],
  ])('accepts %j', (args) => {
    expect(namesTargets(args)).toBe(true);
  });

  // Each of these runs every spec under `playwright test`.
  it.each([[[]], [['--grep', 'search']], [['--workers=1']], [['e2e/']]])('refuses %j', (args) => {
    expect(namesTargets(args)).toBe(false);
  });
});
