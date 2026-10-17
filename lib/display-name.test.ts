import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { posts, users } from '@/lib/db/schema';
import {
  DISPLAY_NAME_MAX_CHARS,
  DISPLAY_NAME_TOO_LONG,
  NO_LINE_BREAKS,
  getPostAuthorDisplayName,
  getUserDisplayName,
  validateDisplayName,
} from './display-name';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

describe('validateDisplayName', () => {
  it('accepts an empty string', () => {
    expect(validateDisplayName('')).toEqual({ ok: true, value: '' });
  });

  it('trims leading and trailing whitespace and accepts empty result', () => {
    expect(validateDisplayName('   ')).toEqual({ ok: true, value: '' });
    expect(validateDisplayName('  Alice  ')).toEqual({ ok: true, value: 'Alice' });
  });

  it('accepts exactly 20 characters', () => {
    const exactly20 = 'a'.repeat(DISPLAY_NAME_MAX_CHARS);
    expect(validateDisplayName(exactly20)).toEqual({ ok: true, value: exactly20 });
  });

  it('refuses 21 characters with too-long error', () => {
    const tooLong = 'a'.repeat(DISPLAY_NAME_MAX_CHARS + 1);
    expect(validateDisplayName(tooLong)).toEqual({
      ok: false,
      error: DISPLAY_NAME_TOO_LONG,
      errors: { displayName: DISPLAY_NAME_TOO_LONG },
    });
  });

  it.each([
    ['newline', 'Alice\nBob'],
    ['carriage return', 'Alice\rBob'],
    ['CRLF', 'Alice\r\nBob'],
  ])('refuses %s with no-line-breaks error', (_label, input) => {
    expect(validateDisplayName(input)).toEqual({
      ok: false,
      error: NO_LINE_BREAKS,
      errors: { displayName: NO_LINE_BREAKS },
    });
  });

  it('counts a surrogate pair as one character', () => {
    const pair20 = '𠮷'.repeat(DISPLAY_NAME_MAX_CHARS);
    expect(validateDisplayName(pair20)).toEqual({ ok: true, value: pair20 });

    const pair21 = '𠮷'.repeat(DISPLAY_NAME_MAX_CHARS + 1);
    expect(validateDisplayName(pair21)).toEqual({
      ok: false,
      error: DISPLAY_NAME_TOO_LONG,
      errors: { displayName: DISPLAY_NAME_TOO_LONG },
    });
  });
});

describe('getUserDisplayName', () => {
  beforeEach(() => {
    db.delete(posts).run();
    db.delete(users).run();
  });

  it('returns empty string for non-existent user or invalid id', () => {
    expect(getUserDisplayName(null)).toBe('');
    expect(getUserDisplayName(undefined)).toBe('');
    expect(getUserDisplayName(NaN)).toBe('');
    expect(getUserDisplayName(999)).toBe('');
    expect(getUserDisplayName(999)).toBe('');
  });

  it('returns display name when user exists', () => {
    const insert = db
      .insert(users)
      .values({
        username: 'alice',
        passwordHash: 'hash',
        role: 'author',
        displayName: 'Alice Liddell',
      })
      .returning({ id: users.id })
      .get();

    expect(getUserDisplayName(insert.id)).toBe('Alice Liddell');
    expect(getUserDisplayName(insert.id)).toBe('Alice Liddell');
  });

  it('returns empty string when user display name is empty', () => {
    const insert = db
      .insert(users)
      .values({
        username: 'bob',
        passwordHash: 'hash',
        role: 'author',
        displayName: '',
      })
      .returning({ id: users.id })
      .get();

    expect(getUserDisplayName(insert.id)).toBe('');
  });
});

describe('getPostAuthorDisplayName', () => {
  beforeEach(() => {
    db.delete(posts).run();
    db.delete(users).run();
  });

  it('returns empty string for missing post or invalid id', () => {
    expect(getPostAuthorDisplayName(NaN)).toBe('');
    expect(getPostAuthorDisplayName(999)).toBe('');
  });

  it('returns empty string when post has no author', () => {
    const post = db
      .insert(posts)
      .values({
        title: 'Post Without Author',
        date: '2026-10-17T00:00:00Z',
        authorId: null,
      })
      .returning({ id: posts.id })
      .get();

    expect(getPostAuthorDisplayName(post.id)).toBe('');
  });

  it('returns author display name when post has an author with display name', () => {
    const user = db
      .insert(users)
      .values({
        username: 'carol',
        passwordHash: 'hash',
        role: 'author',
        displayName: 'Carol Danvers',
      })
      .returning({ id: users.id })
      .get();

    const post = db
      .insert(posts)
      .values({
        title: 'Carol’s Post',
        date: '2026-10-17T00:00:00Z',
        authorId: user.id,
      })
      .returning({ id: posts.id })
      .get();

    expect(getPostAuthorDisplayName(post.id)).toBe('Carol Danvers');
  });
});
