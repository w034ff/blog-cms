import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { appSettings, authorAllowlist, displayNameHistory, users } from '@/lib/db/schema';
import { addInvite, listInvites, saveAuthorAccessMode } from '@/lib/author-access';
import { decideGoogleLogin, initialDisplayName, signInWithGoogle } from '@/lib/google-login';
import { hashEmail } from '@/lib/email-hash';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

const claims = { sub: 'google-sub-1', email: 'Hanako.Sato@Example.com', name: '佐藤 花子' };

beforeEach(() => {
  for (const table of [users, authorAllowlist, appSettings, displayNameHistory])
    db.delete(table).run();
});

function userBySub(sub: string) {
  return db.select().from(users).where(eq(users.googleSub, sub)).get();
}

describe('decideGoogleLogin (docs/multi-author-requirements.md §9.3, criterion 12)', () => {
  const active = { id: 7, suspendedAt: null };
  const suspended = { id: 7, suspendedAt: '2026-10-18T00:00:00.000Z' };

  it.each([
    [
      'an existing author, allowlist, not invited',
      active,
      'allowlist',
      false,
      { kind: 'login', userId: 7 },
    ],
    ['an existing author, open', active, 'open', false, { kind: 'login', userId: 7 }],
    [
      'a suspended author, even when invited',
      suspended,
      'open',
      true,
      { kind: 'reject', reason: 'suspended' },
    ],
    ['a new person, invited', null, 'allowlist', true, { kind: 'create', joinedVia: 'invite' }],
    ['a new person, open', null, 'open', false, { kind: 'create', joinedVia: 'open' }],
    [
      'a new person invited under the open policy',
      null,
      'open',
      true,
      { kind: 'create', joinedVia: 'invite' },
    ],
    [
      'a new person, not invited',
      null,
      'allowlist',
      false,
      { kind: 'reject', reason: 'not_invited' },
    ],
  ] as const)('%s', (_label, existing, mode, invited, expected) => {
    expect(decideGoogleLogin({ existing, mode, invited })).toEqual(expected);
  });
});

describe('initialDisplayName (§9.2, criterion 15)', () => {
  it('keeps a short name', () => {
    expect(initialDisplayName(' 佐藤 花子 ')).toBe('佐藤 花子');
  });

  it('joins lines and cuts to 20 code points', () => {
    expect(initialDisplayName('一二三四五\n六七八九十一二三四五六七八九十超過')).toBe(
      '一二三四五 六七八九十一二三四五六七八九',
    );
    expect(Array.from(initialDisplayName('𠮷'.repeat(30)))).toHaveLength(20);
  });
});

describe('signInWithGoogle (§9.3)', () => {
  it('creates an invited author with no username or password and uses up the invite', () => {
    addInvite('hanako.sato@example.com');
    const result = signInWithGoogle(claims);
    const row = userBySub(claims.sub);
    expect(result).toEqual({ ok: true, userId: row?.id });
    expect(row).toMatchObject({
      role: 'author',
      username: null,
      passwordHash: null,
      displayName: '佐藤 花子',
      suspendedAt: null,
      // §13.6 row 49: the automatic ID, written with the row.
      handle: `user${row?.id}`,
      handleChosenAt: null,
    });
    expect(listInvites()).toEqual([]);
  });

  it('refuses someone not invited and creates nothing', () => {
    expect(signInWithGoogle(claims)).toEqual({ ok: false, reason: 'not_invited' });
    expect(db.select().from(users).all()).toEqual([]);
  });

  it('lets anyone in when the policy is open', () => {
    saveAuthorAccessMode('open');
    expect(signInWithGoogle(claims).ok).toBe(true);
  });

  it('lets an existing author back in after the policy tightens, and clears a stale invite', () => {
    saveAuthorAccessMode('open');
    const first = signInWithGoogle(claims);
    saveAuthorAccessMode('allowlist');
    addInvite(claims.email);
    expect(signInWithGoogle(claims)).toEqual(first);
    expect(listInvites()).toEqual([]);
    expect(db.select().from(users).all()).toHaveLength(1);
  });

  it('refuses a suspended author', () => {
    saveAuthorAccessMode('open');
    signInWithGoogle(claims);
    db.update(users).set({ suspendedAt: '2026-10-18T00:00:00.000Z' }).run();
    expect(signInWithGoogle(claims)).toEqual({ ok: false, reason: 'suspended' });
  });

  it('keeps no email on the user', () => {
    addInvite(claims.email);
    signInWithGoogle(claims);
    expect(JSON.stringify(userBySub(claims.sub))).not.toContain('example.com');
  });
});

describe('what sign-in records about an author (§10.2-§10.4)', () => {
  const now = new Date('2026-10-18T05:00:00.000Z');

  function history(userId: number) {
    return db
      .select({ displayName: displayNameHistory.displayName, kind: displayNameHistory.kind })
      .from(displayNameHistory)
      .where(eq(displayNameHistory.userId, userId))
      .all();
  }

  it('records how an author joined, when, and an initial history row (criteria 25, 29)', () => {
    addInvite(claims.email);
    const invited = signInWithGoogle(claims, now);
    saveAuthorAccessMode('open');
    const open = signInWithGoogle({ sub: 'sub-2', email: 'x@example.com', name: 'X' }, now);
    expect(invited.ok && open.ok).toBe(true);
    if (!invited.ok || !open.ok) return;
    expect(userBySub(claims.sub)).toMatchObject({
      joinedVia: 'invite',
      createdAt: now.toISOString(),
    });
    expect(userBySub('sub-2')?.joinedVia).toBe('open');
    expect(history(invited.userId)).toEqual([{ displayName: '佐藤 花子', kind: 'initial' }]);
  });

  it('keeps only a keyed hash of the email and rewrites it on every sign-in (criterion 26)', () => {
    saveAuthorAccessMode('open');
    signInWithGoogle(claims, now);
    const row = userBySub(claims.sub);
    expect(row?.emailHash).toBe(hashEmail(claims.email));
    expect(JSON.stringify(row)).not.toMatch(/example\.com/i);

    db.update(users).set({ emailHash: 'stale' }).run();
    signInWithGoogle({ ...claims, email: 'new.address@example.com' }, now);
    expect(userBySub(claims.sub)?.emailHash).toBe(hashEmail('new.address@example.com'));
  });

  it('starts an author with no Google name or a taken one as 著者 <id> (criterion 32)', () => {
    saveAuthorAccessMode('open');
    db.insert(users)
      .values({ username: 'admin', passwordHash: 'x', role: 'admin', displayName: 'ＳＡＴＯ' })
      .run();
    const nameless = signInWithGoogle({ sub: 'sub-a', email: 'a@example.com', name: '' }, now);
    const taken = signInWithGoogle({ sub: 'sub-b', email: 'b@example.com', name: 'sato' }, now);
    if (!nameless.ok || !taken.ok) throw new Error('sign-in refused');
    expect(userBySub('sub-a')?.displayName).toBe(`著者 ${nameless.userId}`);
    expect(userBySub('sub-b')?.displayName).toBe(`著者 ${taken.userId}`);
    expect(history(taken.userId)).toEqual([
      { displayName: `著者 ${taken.userId}`, kind: 'initial' },
    ]);
  });

  it('drops invisible characters from a Google name and refuses the placeholder shape', () => {
    saveAuthorAccessMode('open');
    const invisible = signInWithGoogle(
      { sub: 'sub-i', email: 'i@example.com', name: '\u200Bha\u200Bna\u202E' },
      now,
    );
    const blank = signInWithGoogle(
      { sub: 'sub-z', email: 'z@example.com', name: '\u200B\u3164' },
      now,
    );
    const reserved = signInWithGoogle(
      { sub: 'sub-r', email: 'r@example.com', name: '著者 99' },
      now,
    );
    if (!invisible.ok || !blank.ok || !reserved.ok) throw new Error('sign-in refused');
    expect(userBySub('sub-i')?.displayName).toBe('hana');
    expect(userBySub('sub-z')?.displayName).toBe(`著者 ${blank.userId}`);
    expect(userBySub('sub-r')?.displayName).toBe(`著者 ${reserved.userId}`);
  });

  it('adds no history on a later sign-in', () => {
    saveAuthorAccessMode('open');
    const first = signInWithGoogle(claims, now);
    signInWithGoogle({ ...claims, name: 'Another Name' }, now);
    if (!first.ok) throw new Error('sign-in refused');
    expect(history(first.userId)).toHaveLength(1);
    expect(userBySub(claims.sub)?.displayName).toBe('佐藤 花子');
  });
});
