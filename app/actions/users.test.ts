import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { appSettings, authorAllowlist, posts, users } from '@/lib/db/schema';
import { hashEmail } from '@/lib/email-hash';
import * as usersActions from './users';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

const admin = vi.hoisted(() => ({ current: false }));
vi.mock('@/lib/dal', () => ({
  isAdmin: async () => admin.current,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

beforeEach(() => {
  db.delete(authorAllowlist).run();
  db.delete(appSettings).run();
  db.delete(users).run();
  admin.current = false;
});

function form(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
}

// docs/multi-author-requirements.md §9.9 row 16.
describe('user actions called by an author (all exports of users.ts)', () => {
  it('refuses all exports and makes no change to the DB', async () => {
    admin.current = false;

    // Seed initial user and invite
    db.insert(users)
      .values({ id: 1, role: 'author', username: 'author1', displayName: 'Author 1' })
      .run();
    db.insert(authorAllowlist)
      .values({ email: 'initial@example.com', createdAt: '2026-10-18T00:00:00.000Z' })
      .run();

    const beforeUsers = db.select().from(users).all();
    const beforeInvites = db.select().from(authorAllowlist).all();
    const beforeSettings = db.select().from(appSettings).all();

    const formData = form({
      mode: 'open',
      email: 'new@example.com',
      id: '1',
    });

    const entries = Object.entries(usersActions).filter(([, value]) => typeof value === 'function');
    expect(entries.length).toBeGreaterThan(0);

    for (const [, fn] of entries) {
      const actionFn = fn as (...args: unknown[]) => Promise<{ error?: string }>;
      const result =
        actionFn.length === 2 ? await actionFn({}, formData) : await actionFn(formData);

      expect(result).toHaveProperty('error');
      expect(result.error).toBeTruthy();

      expect(db.select().from(users).all()).toEqual(beforeUsers);
      expect(db.select().from(authorAllowlist).all()).toEqual(beforeInvites);
      expect(db.select().from(appSettings).all()).toEqual(beforeSettings);
    }
  });
});

// docs/multi-author-requirements.md §9.9 row 17.
describe('admin safeguards and invite validation (criteria 17)', () => {
  beforeEach(() => {
    admin.current = true;
  });

  it('refuses to suspend an admin account and makes no change to DB', async () => {
    db.insert(users)
      .values({ id: 1, role: 'admin', username: 'admin', displayName: 'Admin' })
      .run();

    const result = await usersActions.suspendUserAction({}, form({ id: '1' }));
    expect(result).toEqual({ error: '管理者は停止できません。' });

    const adminRow = db.select().from(users).where(eq(users.id, 1)).get();
    expect(adminRow?.suspendedAt).toBeNull();
  });

  it('refuses invalid email format and duplicate invite', async () => {
    // 1. Invalid email format
    const invalidResult = await usersActions.addInviteAction({}, form({ email: 'not-an-email' }));
    expect(invalidResult).toEqual({ error: 'メールアドレスの形ではありません。' });
    expect(db.select().from(authorAllowlist).all()).toHaveLength(0);

    // 2. Valid email
    const validResult = await usersActions.addInviteAction(
      {},
      form({ email: 'author@example.com' }),
    );
    expect(validResult).toHaveProperty('at');
    expect(db.select().from(authorAllowlist).all()).toHaveLength(1);

    // 3. Duplicate email
    const duplicateResult = await usersActions.addInviteAction(
      {},
      form({ email: 'author@example.com' }),
    );
    expect(duplicateResult).toEqual({ error: 'このメールアドレスは招待済みです。' });
    expect(db.select().from(authorAllowlist).all()).toHaveLength(1);
  });

  it('accepts an address of 254 characters and refuses one of 255', async () => {
    const address = (domainTail: number) =>
      `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(domainTail)}.com`;
    expect(address(57)).toHaveLength(254);

    const tooLong = await usersActions.addInviteAction({}, form({ email: address(58) }));
    expect(tooLong).toEqual({ error: 'メールアドレスの形ではありません。' });
    expect(db.select().from(authorAllowlist).all()).toHaveLength(0);

    const atLimit = await usersActions.addInviteAction({}, form({ email: address(57) }));
    expect(atLimit).toHaveProperty('at');
    expect(db.select().from(authorAllowlist).all()).toHaveLength(1);
  });

  it('normalizes email with leading/trailing spaces and uppercase to one row', async () => {
    const result = await usersActions.addInviteAction({}, form({ email: '  User@Example.COM  ' }));
    expect(result).toHaveProperty('at');

    const rows = db.select().from(authorAllowlist).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('user@example.com');

    // Duplicate check also normalizes
    const duplicateResult = await usersActions.addInviteAction(
      {},
      form({ email: 'user@example.com' }),
    );
    expect(duplicateResult).toEqual({ error: 'このメールアドレスは招待済みです。' });
    expect(db.select().from(authorAllowlist).all()).toHaveLength(1);
  });
});

// docs/multi-author-requirements.md §10.7 criteria 28.
describe('email lookup action (criteria 28)', () => {
  it('returns lookupByEmail results when called by an admin', async () => {
    admin.current = true;

    db.insert(users)
      .values({
        id: 2,
        role: 'author',
        googleSub: 'sub-lookup-1',
        emailHash: hashEmail('author@example.com'),
      })
      .run();
    db.insert(authorAllowlist)
      .values({
        email: 'author@example.com',
        createdAt: '2026-10-18T00:00:00.000Z',
      })
      .run();

    const result = await usersActions.lookupByEmailAction('Author@Example.com');
    expect(result).toEqual({
      userIds: [2],
      inviteEmails: ['author@example.com'],
    });

    const notFound = await usersActions.lookupByEmailAction('notfound@example.com');
    expect(notFound).toEqual({
      userIds: [],
      inviteEmails: [],
    });

    // A request can carry anything; an over-long or non-string argument matches nothing.
    const none = { userIds: [], inviteEmails: [] };
    const overLong = `${'a'.repeat(243)}@example.com`;
    db.insert(authorAllowlist)
      .values({ email: overLong, createdAt: '2026-10-18T00:00:00.000Z' })
      .run();
    expect(await usersActions.lookupByEmailAction(overLong)).toEqual(none);
    expect(await usersActions.lookupByEmailAction(['author@example.com'])).toEqual(none);
    expect(await usersActions.lookupByEmailAction(null)).toEqual(none);
  });
});

// docs/multi-author-requirements.md §12.8 row 42.
describe('deleting a user (deleteUserAction)', () => {
  beforeEach(() => {
    admin.current = true;
    db.delete(posts).run();
    db.insert(users)
      .values([
        { id: 1, role: 'admin', username: 'admin' },
        { id: 2, role: 'author', suspendedAt: '2026-10-17T00:00:00.000Z' },
        { id: 3, role: 'author' },
      ])
      .run();
    db.insert(posts)
      .values([
        { slug: 'by-2', title: 't', date: '2026-10-01', authorId: 2 },
        { slug: 'by-3', title: 't', date: '2026-10-01', authorId: 3 },
      ])
      .run();
  });

  it('deletes a suspended author with their posts', async () => {
    expect(await usersActions.deleteUserAction({}, form({ id: '2' }))).toHaveProperty('at');
    expect(db.select().from(users).where(eq(users.id, 2)).get()).toBeUndefined();
    expect(
      db
        .select()
        .from(posts)
        .all()
        .map((post) => post.slug),
    ).toEqual(['by-3']);
  });

  it('refuses an author who is not suspended, and an admin', async () => {
    for (const id of ['3', '1']) {
      const result = await usersActions.deleteUserAction({}, form({ id }));
      expect(result.error).toBe('削除できるのは停止中の著者だけです。');
    }
    expect(db.select().from(users).all()).toHaveLength(3);
    expect(db.select().from(posts).all()).toHaveLength(2);
  });
});
