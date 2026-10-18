import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashEmail } from './email-hash';

afterEach(() => vi.unstubAllEnvs());

describe('hashEmail (docs/multi-author-requirements.md §10.3)', () => {
  it('ignores case and surrounding space, and hides the address', () => {
    const hash = hashEmail('Hanako.Sato@Example.com ');
    expect(hash).toBe(hashEmail('hanako.sato@example.com'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('hanako');
  });

  it('tells different addresses apart', () => {
    expect(hashEmail('a@example.com')).not.toBe(hashEmail('b@example.com'));
  });

  it('depends on SESSION_SECRET, so it is not a plain hash anyone can recompute', () => {
    const before = hashEmail('a@example.com');
    vi.stubEnv('SESSION_SECRET', 'another-secret');
    expect(hashEmail('a@example.com')).not.toBe(before);
  });

  it('refuses to hash without a secret', () => {
    vi.stubEnv('SESSION_SECRET', '');
    expect(() => hashEmail('a@example.com')).toThrow();
  });
});
