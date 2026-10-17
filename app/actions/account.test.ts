import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { DISPLAY_NAME_MAX_CHARS, DISPLAY_NAME_TOO_LONG, NO_LINE_BREAKS } from '@/lib/display-name';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

const currentSession = vi.hoisted(() => ({ userId: 1 as number | null }));
vi.mock('@/lib/dal', () => ({
  getOptionalSession: async () =>
    currentSession.userId !== null ? { userId: currentSession.userId } : null,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import { saveAccountAction } from './account';

function form(displayName: string, extraFields: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.set('displayName', displayName);
  for (const [key, val] of Object.entries(extraFields)) {
    data.set(key, val);
  }
  return data;
}

describe('saveAccountAction (docs/multi-author-requirements.md §7 id=10)', () => {
  let user1Id: number;
  let user2Id: number;

  beforeEach(() => {
    db.delete(users).run();
    currentSession.userId = null;

    const u1 = db
      .insert(users)
      .values({
        username: 'user1',
        passwordHash: 'hash1',
        role: 'author',
        displayName: 'Original User 1',
      })
      .returning({ id: users.id })
      .get();
    user1Id = u1.id;

    const u2 = db
      .insert(users)
      .values({
        username: 'user2',
        passwordHash: 'hash2',
        role: 'author',
        displayName: 'Original User 2',
      })
      .returning({ id: users.id })
      .get();
    user2Id = u2.id;

    currentSession.userId = user1Id;
  });

  it('saves a valid 20-character display name for the session user', async () => {
    const exactly20 = 'a'.repeat(DISPLAY_NAME_MAX_CHARS);
    const result = await saveAccountAction({}, form(exactly20));

    expect(result.at).toBeTypeOf('number');
    expect(result.errors).toBeUndefined();

    const saved = db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, user1Id))
      .get();
    expect(saved?.displayName).toBe(exactly20);
  });

  it('refuses 21 characters with a reason and does not touch the database', async () => {
    const tooLong = 'a'.repeat(DISPLAY_NAME_MAX_CHARS + 1);
    const result = await saveAccountAction({}, form(tooLong));

    expect(result.errors?.displayName).toBe(DISPLAY_NAME_TOO_LONG);
    expect(result.at).toBeUndefined();

    const saved = db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, user1Id))
      .get();
    expect(saved?.displayName).toBe('Original User 1');
  });

  it('refuses line breaks with a reason and does not touch the database', async () => {
    const result = await saveAccountAction({}, form('Line\nBreak'));

    expect(result.errors?.displayName).toBe(NO_LINE_BREAKS);
    expect(result.at).toBeUndefined();

    const saved = db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, user1Id))
      .get();
    expect(saved?.displayName).toBe('Original User 1');
  });

  it('allows an empty display name and saves empty string', async () => {
    const result = await saveAccountAction({}, form(''));

    expect(result.at).toBeTypeOf('number');
    expect(result.errors).toBeUndefined();

    const saved = db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, user1Id))
      .get();
    expect(saved?.displayName).toBe('');
  });

  it('trims leading and trailing whitespace before saving', async () => {
    const result = await saveAccountAction({}, form('   Trimmed Name   '));

    expect(result.at).toBeTypeOf('number');
    expect(result.errors).toBeUndefined();

    const saved = db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, user1Id))
      .get();
    expect(saved?.displayName).toBe('Trimmed Name');
  });

  it('counts surrogate pairs as one character', async () => {
    const pairs20 = '𠮷'.repeat(DISPLAY_NAME_MAX_CHARS);
    const result = await saveAccountAction({}, form(pairs20));

    expect(result.at).toBeTypeOf('number');
    expect(result.errors).toBeUndefined();

    const saved = db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, user1Id))
      .get();
    expect(saved?.displayName).toBe(pairs20);
  });

  it('writes only the session user’s row even if formData contains another user id', async () => {
    const result = await saveAccountAction(
      {},
      form('Updated User 1', { id: String(user2Id), userId: String(user2Id) }),
    );

    expect(result.at).toBeTypeOf('number');

    const u1 = db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, user1Id))
      .get();
    expect(u1?.displayName).toBe('Updated User 1');

    const u2 = db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, user2Id))
      .get();
    expect(u2?.displayName).toBe('Original User 2');
  });

  it('refuses when there is no active session', async () => {
    currentSession.userId = null;
    const result = await saveAccountAction({}, form('No Session'));

    expect(result.error).toBeTruthy();
    expect(result.at).toBeUndefined();

    const u1 = db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, user1Id))
      .get();
    expect(u1?.displayName).toBe('Original User 1');
  });
});
