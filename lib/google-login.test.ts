import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { appSettings, authorAllowlist, users } from '@/lib/db/schema';
import { addInvite, listInvites, saveAuthorAccessMode } from '@/lib/author-access';
import { decideGoogleLogin, initialDisplayName, signInWithGoogle } from '@/lib/google-login';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

const claims = { sub: 'google-sub-1', email: 'Hanako.Sato@Example.com', name: '佐藤 花子' };

beforeEach(() => {
  for (const table of [users, authorAllowlist, appSettings]) db.delete(table).run();
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
    ['a new person, invited', null, 'allowlist', true, { kind: 'create' }],
    ['a new person, open', null, 'open', false, { kind: 'create' }],
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
