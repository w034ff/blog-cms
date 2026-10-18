import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { displayNameHistory, users } from '@/lib/db/schema';
import {
  DISPLAY_NAME_MAX_CHARS,
  DISPLAY_NAME_INVISIBLE,
  DISPLAY_NAME_REQUIRED,
  DISPLAY_NAME_RESERVED,
  DISPLAY_NAME_TAKEN,
  DISPLAY_NAME_TOO_LONG,
  NO_LINE_BREAKS,
} from '@/lib/display-name';

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

describe('display name rules (docs/multi-author-requirements.md §10.4)', () => {
  const HOUR = 60 * 60 * 1000;
  let clock = Date.parse('2026-10-18T00:00:00.000Z');

  function addUser(values: Partial<typeof users.$inferInsert>): number {
    return db
      .insert(users)
      .values({ role: 'author', displayName: '', ...values })
      .returning({ id: users.id })
      .get().id;
  }
  function nameOf(id: number): string | undefined {
    return db.select().from(users).where(eq(users.id, id)).get()?.displayName;
  }
  async function save(id: number, name: string) {
    currentSession.userId = id;
    return saveAccountAction({}, form(name));
  }

  beforeEach(() => {
    db.delete(users).run();
    db.delete(displayNameHistory).run();
    clock = Date.parse('2026-10-18T00:00:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(clock);
  });

  it('refuses an empty name from a Google author and allows it for a password account (criterion 30)', async () => {
    const google = addUser({ googleSub: 'sub-g', displayName: 'Google Author' });
    const admin = addUser({
      role: 'admin',
      username: 'admin',
      passwordHash: 'x',
      displayName: 'Admin',
    });
    expect(await save(google, '   ')).toEqual({ errors: { displayName: DISPLAY_NAME_REQUIRED } });
    expect(nameOf(google)).toBe('Google Author');
    expect(await save(admin, '')).toHaveProperty('at');
    expect(nameOf(admin)).toBe('');
  });

  it("refuses another account's current name, ignoring width and case (criterion 30)", async () => {
    addUser({ googleSub: 'sub-k', displayName: 'kenta' });
    const me = addUser({ googleSub: 'sub-me', displayName: 'me' });
    for (const name of ['kenta', 'KENTA', 'ｋｅｎｔａ', ' Kenta ']) {
      expect(await save(me, name)).toEqual({ errors: { displayName: DISPLAY_NAME_TAKEN } });
    }
    expect(nameOf(me)).toBe('me');
  });

  it('lets a name go once its holder has moved on from it', async () => {
    const other = addUser({ googleSub: 'sub-o', displayName: 'Old Name', role: 'admin' });
    const me = addUser({ googleSub: 'sub-me', displayName: 'me' });
    expect(await save(other, 'New Name')).toHaveProperty('at');
    expect(await save(me, 'Old Name')).toHaveProperty('at');
  });

  it('lets an author rename once per 24 hours, counting only names they set (criterion 31)', async () => {
    const me = addUser({ googleSub: 'sub-me', displayName: 'Initial' });
    db.insert(displayNameHistory)
      .values({
        userId: me,
        displayName: 'Initial',
        kind: 'initial',
        changedAt: new Date(clock).toISOString(),
      })
      .run();
    expect(await save(me, 'First')).toHaveProperty('at');

    clock += 23 * HOUR;
    vi.setSystemTime(clock);
    const refused = await save(me, 'Second');
    expect(refused.errors?.displayName).toMatch(
      /^表示名を変えられるのは 1 日 1 回です。次は 10月19日 09:00 から変えられます。$/,
    );
    expect(nameOf(me)).toBe('First');

    clock += HOUR;
    vi.setSystemTime(clock);
    expect(await save(me, 'Second')).toHaveProperty('at');
  });

  it('refuses characters that draw nothing, so no name can pass for another or for nothing', async () => {
    addUser({ googleSub: 'sub-k', displayName: 'kenta' });
    const me = addUser({ googleSub: 'sub-me', displayName: 'me' });
    for (const name of [
      'k\u200Benta',
      '\u200B',
      '\u3164',
      '\u2800',
      '\u202Ekenta',
      '\u00ADkenta',
    ]) {
      expect(await save(me, name)).toEqual({ errors: { displayName: DISPLAY_NAME_INVISIBLE } });
    }
    expect(nameOf(me)).toBe('me');
  });

  it('refuses an empty name from a Google author whose name is already empty', async () => {
    const legacy = addUser({ googleSub: 'sub-legacy', displayName: '' });
    expect(await save(legacy, '')).toEqual({ errors: { displayName: DISPLAY_NAME_REQUIRED } });
  });

  it('keeps the placeholder shape for new authors only', async () => {
    const me = addUser({ googleSub: 'sub-me', displayName: 'me' });
    for (const name of ['著者 5', '著者5', '著者　１２']) {
      expect(await save(me, name)).toEqual({ errors: { displayName: DISPLAY_NAME_RESERVED } });
    }
    expect(await save(me, '著者 5 号')).toHaveProperty('at');
    const placeholder = addUser({ googleSub: 'sub-p', displayName: '著者 7' });
    expect(await save(placeholder, '著者 7')).toHaveProperty('at');
  });

  it('does not limit an admin', async () => {
    const admin = addUser({
      role: 'admin',
      username: 'admin',
      passwordHash: 'x',
      displayName: 'A',
    });
    expect(await save(admin, 'B')).toHaveProperty('at');
    expect(await save(admin, 'C')).toHaveProperty('at');
  });

  it('adds history only when the name actually changes (criterion 29)', async () => {
    const me = addUser({ googleSub: 'sub-me', displayName: 'Same' });
    expect(await save(me, 'Same')).toHaveProperty('at');
    expect(db.select().from(displayNameHistory).all()).toEqual([]);
    expect(await save(me, 'Different')).toHaveProperty('at');
    expect(
      db
        .select({ displayName: displayNameHistory.displayName, kind: displayNameHistory.kind })
        .from(displayNameHistory)
        .all(),
    ).toEqual([{ displayName: 'Different', kind: 'change' }]);
  });
});
