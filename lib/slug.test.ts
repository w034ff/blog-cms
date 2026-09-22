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
  // The shape of the slug is not asserted: `randomBytes(10).toString('hex')` is the whole of it,
  // and nothing in the repo reads the length back — the routes match `[0-9a-f]+`.
  it('retries with a fresh slug until it finds an unused one', () => {
    slugExistsMock.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false);
    const slug = generateUniqueSlug();
    expect(slugExistsMock).toHaveBeenCalledTimes(3);
    // **Fresh, not merely retried.** A slug hoisted out of the loop would keep this function asking
    // about the same taken value forever, which is a hang rather than a wrong answer — so the two
    // calls it was asked about have to differ from each other.
    const asked = slugExistsMock.mock.calls.map(([value]) => value);
    expect(new Set(asked).size).toBe(asked.length);
    expect(asked).toContain(slug);
  });
});
