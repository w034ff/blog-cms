import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { appSettings, authorAllowlist } from '@/lib/db/schema';
import {
  addInvite,
  isInvited,
  listInvites,
  readAuthorAccessMode,
  removeInvite,
  saveAuthorAccessMode,
} from '@/lib/author-access';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

beforeEach(() => {
  for (const table of [authorAllowlist, appSettings]) db.delete(table).run();
});

describe('author access mode (docs/multi-author-requirements.md §9.4)', () => {
  it('is allowlist until saved otherwise', () => {
    expect(readAuthorAccessMode()).toBe('allowlist');
    saveAuthorAccessMode('open');
    expect(readAuthorAccessMode()).toBe('open');
    saveAuthorAccessMode('allowlist');
    expect(readAuthorAccessMode()).toBe('allowlist');
  });

  it('reads an unknown stored value as the default', () => {
    db.insert(appSettings).values({ key: 'author_access_mode', value: 'everyone' }).run();
    expect(readAuthorAccessMode()).toBe('allowlist');
  });
});

describe('invites (§9.4)', () => {
  it('stores addresses trimmed and lower-cased, and refuses a second copy', () => {
    expect(addInvite('  Mio.Tanaka@Example.com ')).toBe('added');
    expect(addInvite('mio.tanaka@example.com')).toBe('duplicate');
    expect(isInvited('MIO.TANAKA@example.com')).toBe(true);
    expect(listInvites().map((invite) => invite.email)).toEqual(['mio.tanaka@example.com']);
  });

  it('keeps Gmail dots and plus tags as written', () => {
    addInvite('a.b+blog@gmail.com');
    expect(isInvited('ab@gmail.com')).toBe(false);
    expect(isInvited('a.b+blog@gmail.com')).toBe(true);
  });

  it('lists the newest first and removes one', () => {
    addInvite('old@example.com', new Date('2026-10-01T00:00:00Z'));
    addInvite('new@example.com', new Date('2026-10-02T00:00:00Z'));
    expect(listInvites().map((invite) => invite.email)).toEqual([
      'new@example.com',
      'old@example.com',
    ]);
    removeInvite('NEW@example.com');
    expect(listInvites().map((invite) => invite.email)).toEqual(['old@example.com']);
  });
});
