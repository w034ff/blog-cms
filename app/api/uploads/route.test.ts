import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import {
  AUTHORS_UPLOAD_TOTAL_BYTES,
  NEW_AUTHOR_DAILY_LIMIT,
  NEW_AUTHOR_DAYS,
  NEW_AUTHOR_QUOTA_BYTES,
  UPLOAD_DAILY_LIMIT,
  UPLOAD_MIN_FREE_BYTES,
  UPLOAD_QUOTA_BYTES,
} from '@/lib/upload-quota';

const mockGetOptionalSession = vi.fn();
vi.mock('@/lib/dal', () => ({
  getOptionalSession: () => mockGetOptionalSession(),
}));
vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});
const uploadDir = vi.hoisted(() => ({ value: '' }));
vi.mock('@/lib/upload-dir', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const nodePath = await import('node:path');
  uploadDir.value = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'uploads-route-'));
  return { UPLOAD_DIR: uploadDir.value };
});
const mockStatfs = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  mockWriteFile.mockImplementation(actual.writeFile);
  return { ...actual, statfs: mockStatfs, writeFile: mockWriteFile };
});

const { POST } = await import('./route');

afterAll(() => {
  rmSync(uploadDir.value, { recursive: true, force: true });
});

describe('POST /api/uploads', () => {
  const loggedInSession = { userId: 1, username: 'admin' };

  beforeEach(() => {
    mockGetOptionalSession.mockReset();
  });

  describe('malformed body handling', () => {
    it('returns 400 when transmission is truncated before boundary', async () => {
      mockGetOptionalSession.mockResolvedValue(loggedInSession);
      const req = new NextRequest('http://localhost/api/uploads', {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=x' },
        body: '--x\r\nContent-Disposition: form-data; name="file"\r\n\r\nincomplete',
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'malformed form data' });
    });

    it('returns 400 when boundary is missing in content-type header', async () => {
      mockGetOptionalSession.mockResolvedValue(loggedInSession);
      const req = new NextRequest('http://localhost/api/uploads', {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data' },
        body: 'any-body',
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'malformed form data' });
    });

    it('returns 400 when request is not multipart', async () => {
      mockGetOptionalSession.mockResolvedValue(loggedInSession);
      const req = new NextRequest('http://localhost/api/uploads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'malformed form data' });
    });
  });

  it('returns 401 when not logged in even with a malformed body', async () => {
    mockGetOptionalSession.mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/uploads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 file is required when valid multipart lacks file field', async () => {
    mockGetOptionalSession.mockResolvedValue(loggedInSession);
    const body = '--x\r\nContent-Disposition: form-data; name="text"\r\n\r\nhello\r\n--x--\r\n';
    const req = new NextRequest('http://localhost/api/uploads', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'file is required' });
  });
});

// docs/abuse-limits-requirements.md §5, §8 rows 1-6, 13 and 14.
describe('POST /api/uploads limits', () => {
  const NOW = new Date('2026-10-19T12:00:00.000Z');
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;
  const ADMIN_ID = 1;
  const AUTHOR_ID = 2;
  const OTHER_ID = 3;
  const GB = 1024 * 1024 * 1024;
  const SERVER_FULL =
    'サーバーの空き容量が足りないため、画像を保存できません。管理者に知らせてください。';
  const sqlite = db.$client;
  let colour = 0;

  // A distinct image per call, so each one has its own stored name.
  async function image(): Promise<File> {
    colour += 1;
    const png = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: colour % 256, g: colour >> 8, b: 0 },
      },
    })
      .png()
      .toBuffer();
    return new File([new Uint8Array(png)], 'a.png', { type: 'image/png' });
  }

  async function upload(file: File): Promise<Response> {
    const formData = new FormData();
    formData.append('file', file);
    return POST(
      new NextRequest('http://localhost/api/uploads', { method: 'POST', body: formData }),
    );
  }

  function as(userId: number): void {
    mockGetOptionalSession.mockResolvedValue({ userId, username: `u${userId}` });
  }

  function addUser(id: number, role: 'admin' | 'author', createdAt: string | null): void {
    db.insert(users)
      .values({ id, username: `u${id}`, role, createdAt })
      .run();
  }

  function addRow(userId: number, name: string, bytes: number, createdAt = NOW.toISOString()) {
    sqlite
      .prepare('INSERT INTO uploads (name, user_id, bytes, created_at) VALUES (?, ?, ?, ?)')
      .run(name, userId, bytes, createdAt);
  }

  function addRows(userId: number, count: number, createdAt = NOW.toISOString()): void {
    for (let i = 0; i < count; i++) addRow(userId, `filler-${userId}-${i}.png`, 1, createdAt);
  }

  function ledgerNames(userId: number): string[] {
    return sqlite
      .prepare('SELECT name FROM uploads WHERE user_id = ? ORDER BY name')
      .pluck()
      .all(userId)
      .map(String);
  }

  function files(): string[] {
    return readdirSync(uploadDir.value);
  }

  function setFree(bytes: number): void {
    mockStatfs.mockResolvedValue({ bavail: bytes, bsize: 1 });
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    sqlite.exec('DELETE FROM uploads; DELETE FROM users');
    for (const name of files()) rmSync(path.join(uploadDir.value, name));
    // Long enough ago that no account is new unless a test says so.
    addUser(ADMIN_ID, 'admin', null);
    addUser(AUTHOR_ID, 'author', new Date(NOW.getTime() - 30 * DAY_MS).toISOString());
    addUser(OTHER_ID, 'author', null);
    setFree(UPLOAD_MIN_FREE_BYTES + GB);
    as(AUTHOR_ID);
  });

  it('adds a ledger row for an upload, and none for the same image again', async () => {
    const file = await image();
    const first = await upload(file);
    expect(first.status).toBe(200);
    const [name] = files();
    expect(files()).toHaveLength(1);
    const url = `/uploads/${name}`;
    expect(await first.json()).toEqual({ url });
    expect(ledgerNames(AUTHOR_ID)).toEqual([name]);

    const again = await upload(file);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ url });
    expect(ledgerNames(AUTHOR_ID)).toHaveLength(1);
  });

  it('gives the same image its own row under each account', async () => {
    const file = await image();
    await upload(file);
    as(OTHER_ID);
    expect((await upload(file)).status).toBe(200);
    expect(ledgerNames(OTHER_ID)).toEqual(ledgerNames(AUTHOR_ID));
  });

  it('refuses the 51st image within 24 hours with 429, leaving no file or row', async () => {
    addRows(AUTHOR_ID, UPLOAD_DAILY_LIMIT);
    const res = await upload(await image());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: '画像は 24 時間に 50 枚までです。時間をおいてから試してください。',
    });
    expect(files()).toEqual([]);
    expect(ledgerNames(AUTHOR_ID)).toHaveLength(UPLOAD_DAILY_LIMIT);
  });

  it('counts only the last 24 hours', async () => {
    addRows(AUTHOR_ID, UPLOAD_DAILY_LIMIT, new Date(NOW.getTime() - DAY_MS - 1).toISOString());
    expect((await upload(await image())).status).toBe(200);
  });

  it('refuses an image that takes the total past the quota with 507, leaving no file or row', async () => {
    addRow(AUTHOR_ID, 'big.png', UPLOAD_QUOTA_BYTES - 1);
    const res = await upload(await image());
    expect(res.status).toBe(507);
    expect(await res.json()).toEqual({
      error: '画像の保存容量（200MB）を超えます。記事から外した画像は、1〜2 日で容量が空きます。',
    });
    expect(files()).toEqual([]);
    expect(ledgerNames(AUTHOR_ID)).toEqual(['big.png']);
  });

  it('refuses an author when the disk is below the free floor', async () => {
    setFree(UPLOAD_MIN_FREE_BYTES - 1);
    const res = await upload(await image());
    expect(res.status).toBe(507);
    expect(await res.json()).toEqual({ error: SERVER_FULL });
    expect(files()).toEqual([]);
    expect(ledgerNames(AUTHOR_ID)).toEqual([]);
  });

  it('never refuses an admin for count, total or free space', async () => {
    as(ADMIN_ID);
    addRows(ADMIN_ID, UPLOAD_DAILY_LIMIT);
    addRow(ADMIN_ID, 'big.png', UPLOAD_QUOTA_BYTES);
    addRow(ADMIN_ID, 'huge.png', AUTHORS_UPLOAD_TOTAL_BYTES);
    setFree(0);
    expect((await upload(await image())).status).toBe(200);
    expect(files()).toHaveLength(1);
    expect(ledgerNames(ADMIN_ID)).toHaveLength(UPLOAD_DAILY_LIMIT + 3);
  });

  it('lets an account re-upload an image it already holds when every limit is reached', async () => {
    const file = await image();
    await upload(file);
    const [held] = ledgerNames(AUTHOR_ID);
    addRows(AUTHOR_ID, UPLOAD_DAILY_LIMIT);
    addRow(AUTHOR_ID, 'big.png', UPLOAD_QUOTA_BYTES);
    addRow(OTHER_ID, 'authors.png', AUTHORS_UPLOAD_TOTAL_BYTES);
    setFree(0);
    const res = await upload(file);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: `/uploads/${held}` });
    expect(ledgerNames(AUTHOR_ID).filter((name) => name === held)).toHaveLength(1);
  });

  it('still refuses an image only another account holds', async () => {
    const file = await image();
    await upload(file);
    as(OTHER_ID);
    addRows(OTHER_ID, UPLOAD_DAILY_LIMIT);
    expect((await upload(file)).status).toBe(429);
  });

  describe('a new author', () => {
    const NOTE = '参加から 7 日間は、上限を小さくしています。';

    function joinedDaysAgo(days: number): void {
      sqlite
        .prepare('UPDATE users SET created_at = ? WHERE id = ?')
        .run(new Date(NOW.getTime() - days * DAY_MS).toISOString(), AUTHOR_ID);
    }

    it('has the small daily limit, and the message names the days', async () => {
      expect(NEW_AUTHOR_DAYS).toBe(7);
      joinedDaysAgo(NEW_AUTHOR_DAYS - 1);
      addRows(AUTHOR_ID, NEW_AUTHOR_DAILY_LIMIT);
      const res = await upload(await image());
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({
        error: `画像は 24 時間に 10 枚までです。時間をおいてから試してください。${NOTE}`,
      });
    });

    it('has the small quota, and the message names the days', async () => {
      joinedDaysAgo(1);
      addRow(AUTHOR_ID, 'big.png', NEW_AUTHOR_QUOTA_BYTES - 1);
      const res = await upload(await image());
      expect(res.status).toBe(507);
      expect(await res.json()).toEqual({
        error: `画像の保存容量（20MB）を超えます。記事から外した画像は、1〜2 日で容量が空きます。${NOTE}`,
      });
    });

    it('gets the ordinary limits from the seventh day on', async () => {
      joinedDaysAgo(NEW_AUTHOR_DAYS);
      addRows(AUTHOR_ID, NEW_AUTHOR_DAILY_LIMIT);
      expect((await upload(await image())).status).toBe(200);
    });

    it('is not new when created_at is null', async () => {
      sqlite.prepare('UPDATE users SET created_at = NULL WHERE id = ?').run(AUTHOR_ID);
      addRows(AUTHOR_ID, NEW_AUTHOR_DAILY_LIMIT);
      expect((await upload(await image())).status).toBe(200);
    });
  });

  describe('the authors’ total', () => {
    it('refuses with the free-space wording when the non-admin rows would pass it', async () => {
      addRow(OTHER_ID, 'theirs.png', AUTHORS_UPLOAD_TOTAL_BYTES - 1);
      const res = await upload(await image());
      expect(res.status).toBe(507);
      expect(await res.json()).toEqual({ error: SERVER_FULL });
      expect(files()).toEqual([]);
      expect(ledgerNames(AUTHOR_ID)).toEqual([]);
    });

    it('does not count an admin’s rows', async () => {
      addRow(ADMIN_ID, 'admin.png', AUTHORS_UPLOAD_TOTAL_BYTES);
      expect((await upload(await image())).status).toBe(200);
    });

    it('counts the same image under two accounts twice', async () => {
      const file = await image();
      await upload(file);
      const [name] = ledgerNames(AUTHOR_ID);
      sqlite.prepare('UPDATE uploads SET bytes = ?').run(AUTHORS_UPLOAD_TOTAL_BYTES / 2);
      addRow(OTHER_ID, name, AUTHORS_UPLOAD_TOTAL_BYTES / 2);
      expect((await upload(await image())).status).toBe(507);
    });
  });

  it('removes the row and answers 500 when the file cannot be written', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('disk error'));
    const res = await upload(await image());
    expect(res.status).toBe(500);
    expect(ledgerNames(AUTHOR_ID)).toEqual([]);
    expect(files()).toEqual([]);
  });
});
