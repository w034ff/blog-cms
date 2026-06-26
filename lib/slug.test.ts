import { beforeEach, describe, expect, it, vi } from 'vitest';
import { slugExists } from '@/lib/posts-write';
import { generateUniqueSlug } from '@/lib/slug';

// Isolate the unit from the database: slugExists is its only collaborator, so
// mocking it keeps the test from loading the SQLite-backed posts-write module.
vi.mock('@/lib/posts-write', () => ({
  slugExists: vi.fn(),
}));

const slugExistsMock = vi.mocked(slugExists);

beforeEach(() => {
  slugExistsMock.mockReset();
});

describe('generateUniqueSlug', () => {
  it('returns a 20-char lowercase hex slug', () => {
    slugExistsMock.mockReturnValue(false);
    expect(generateUniqueSlug()).toMatch(/^[0-9a-f]{20}$/);
  });

  it('retries until it finds an unused slug', () => {
    slugExistsMock.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false);
    expect(generateUniqueSlug()).toMatch(/^[0-9a-f]{20}$/);
    expect(slugExistsMock).toHaveBeenCalledTimes(3);
  });

  it('produces a different slug on each call', () => {
    slugExistsMock.mockReturnValue(false);
    expect(generateUniqueSlug()).not.toBe(generateUniqueSlug());
  });
});
