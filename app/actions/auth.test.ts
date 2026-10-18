import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

const sessionMock = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('@/lib/session', () => ({
  createSession: (payload: unknown) => sessionMock.create(payload),
  deleteSession: () => sessionMock.delete(),
}));

const redirectMock = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}));

const { login, logout } = await import('./auth');

function form(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  db.delete(users).run();
  sessionMock.create.mockClear();
  sessionMock.delete.mockClear();
  redirectMock.mockClear();
});

function seedUser(
  id: number,
  username: string,
  password: string,
  suspendedAt: string | null = null,
): void {
  db.insert(users)
    .values({
      id,
      username,
      passwordHash: bcrypt.hashSync(password, 4),
      role: 'author',
      suspendedAt,
    })
    .run();
}

// docs/multi-author-requirements.md §7 row 8.
describe('login and logout with suspension', () => {
  it('logs in an active user and redirects to /admin', async () => {
    seedUser(1, 'active', 'pass123', null);
    await login({}, form({ username: 'active', password: 'pass123' }));

    expect(sessionMock.create).toHaveBeenCalledWith({ userId: 1 });
    expect(redirectMock).toHaveBeenCalledWith('/admin');
  });

  it('refuses a suspended user with the correct password and creates no session', async () => {
    seedUser(2, 'suspended', 'pass123', '2026-10-17T12:00:00.000Z');
    const result = await login({}, form({ username: 'suspended', password: 'pass123' }));

    expect(result).toEqual({ error: 'このアカウントは停止されています。' });
    expect(sessionMock.create).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('refuses a suspended user with an incorrect password with the standard wrong password error', async () => {
    seedUser(2, 'suspended', 'pass123', '2026-10-17T12:00:00.000Z');
    const result = await login({}, form({ username: 'suspended', password: 'wrong' }));

    expect(result).toEqual({ error: 'ユーザー名またはパスワードが違います。' });
    expect(sessionMock.create).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('logs out and redirects to /login', async () => {
    await logout();
    expect(sessionMock.delete).toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });
});
