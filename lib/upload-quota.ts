import 'server-only';
import { statfs } from 'node:fs/promises';
import type Database from 'better-sqlite3';

// What one account, and all authors together, may keep in UPLOAD_DIR, and the check that enforces
// it (docs/abuse-limits-requirements.md §3, §5). It takes a raw better-sqlite3 connection: the
// check and the ledger insert must be one synchronous transaction, which drizzle's wrapper adds
// nothing to.

const MB = 1024 * 1024;
const GB = 1024 * MB;
const DAY_MS = 24 * 60 * 60 * 1000;

export const UPLOAD_QUOTA_BYTES = 200 * MB;
export const UPLOAD_DAILY_LIMIT = 50;
export const NEW_AUTHOR_DAYS = 7;
export const NEW_AUTHOR_QUOTA_BYTES = 20 * MB;
export const NEW_AUTHOR_DAILY_LIMIT = 10;
export const AUTHORS_UPLOAD_TOTAL_BYTES = 10 * GB;
export const UPLOAD_MIN_FREE_BYTES = 5 * GB;

const STATUS_TOO_MANY = 429;
const STATUS_INSUFFICIENT_STORAGE = 507;

// Shown for the free-space floor and for the authors' total alike: a refusal must not tell its
// recipient how much the other authors use.
const SERVER_FULL_MESSAGE =
  'サーバーの空き容量が足りないため、画像を保存できません。管理者に知らせてください。';

export type UploadAccount = {
  userId: number;
  isAdmin: boolean;
  // `users.created_at`; null for an account older than the column.
  createdAt: string | null;
};

export type UploadRefusal = { status: number; error: string };

// `recorded` is false when the account already had the name, which costs it nothing.
export type UploadOutcome = { refused: UploadRefusal } | { recorded: boolean };

// An account that cannot be read is treated as an ordinary author, never as an admin.
export function readUploadAccount(sqlite: Database.Database, userId: number): UploadAccount {
  const row = sqlite.prepare('SELECT role, created_at FROM users WHERE id = ?').get(userId);
  const role = typeof row === 'object' && row !== null && 'role' in row ? row.role : null;
  const createdAt =
    typeof row === 'object' && row !== null && 'created_at' in row ? row.created_at : null;
  return {
    userId,
    isAdmin: role === 'admin',
    createdAt: typeof createdAt === 'string' ? createdAt : null,
  };
}

// A null or unparseable `created_at` is not new: those rows predate the column, so they belong to
// accounts that have been here far longer than NEW_AUTHOR_DAYS.
export function isNewAuthor(createdAt: string | null, now: number): boolean {
  if (createdAt === null) return false;
  const joined = Date.parse(createdAt);
  return !Number.isNaN(joined) && now - joined < NEW_AUTHOR_DAYS * DAY_MS;
}

export function hasUploadRow(sqlite: Database.Database, userId: number, name: string): boolean {
  return (
    sqlite.prepare('SELECT 1 FROM uploads WHERE user_id = ? AND name = ?').get(userId, name) !==
    undefined
  );
}

// Removes the row `recordUpload` added, when the file behind it could not be written.
export function removeUploadRow(sqlite: Database.Database, userId: number, name: string): void {
  sqlite.prepare('DELETE FROM uploads WHERE user_id = ? AND name = ?').run(userId, name);
}

// The refusal for a disk with less than UPLOAD_MIN_FREE_BYTES free, or null. Measured on the
// filesystem holding `dir` and counted as an unprivileged process sees it (`bavail`).
export async function diskFloorRefusal(dir: string): Promise<UploadRefusal | null> {
  const stats = await statfs(dir);
  const free = stats.bavail * stats.bsize;
  return free < UPLOAD_MIN_FREE_BYTES
    ? { status: STATUS_INSUFFICIENT_STORAGE, error: SERVER_FULL_MESSAGE }
    : null;
}

function sumBytes(sqlite: Database.Database, where: string, ...params: number[]): number {
  const total = sqlite
    .prepare(`SELECT COALESCE(SUM(bytes), 0) FROM uploads WHERE ${where}`)
    .pluck()
    .get(...params);
  return typeof total === 'number' ? total : 0;
}

function megabytes(bytes: number): string {
  return `${bytes / MB}MB`;
}

// Records the upload in the ledger unless a limit refuses it (§5 steps 5 to 8, after the disk
// floor). Immediate, and one transaction around the checks and the insert, so two requests
// arriving together cannot both pass a limit that only has room for one. Immediate rather than
// deferred because scripts/gc-uploads.mts writes the same file from its own process, and a
// deferred transaction that reads first cannot upgrade after another connection commits
// (scripts/open-db.mts).
export function recordUpload(
  sqlite: Database.Database,
  account: UploadAccount,
  name: string,
  bytes: number,
  now: number,
): UploadOutcome {
  return sqlite
    .transaction((): UploadOutcome => {
      if (hasUploadRow(sqlite, account.userId, name)) return { recorded: false };
      if (!account.isAdmin) {
        const refused = limitRefusal(sqlite, account, bytes, now);
        if (refused) return { refused };
      }
      sqlite
        .prepare('INSERT INTO uploads (name, user_id, bytes, created_at) VALUES (?, ?, ?, ?)')
        .run(name, account.userId, bytes, new Date(now).toISOString());
      return { recorded: true };
    })
    .immediate();
}

function limitRefusal(
  sqlite: Database.Database,
  account: UploadAccount,
  bytes: number,
  now: number,
): UploadRefusal | null {
  // An admin's rows are left out: they are exempt, so they must not use up the authors' room.
  const authorsTotal = sumBytes(sqlite, "user_id IN (SELECT id FROM users WHERE role <> 'admin')");
  if (authorsTotal + bytes > AUTHORS_UPLOAD_TOTAL_BYTES) {
    return { status: STATUS_INSUFFICIENT_STORAGE, error: SERVER_FULL_MESSAGE };
  }

  const isNew = isNewAuthor(account.createdAt, now);
  const dailyLimit = isNew ? NEW_AUTHOR_DAILY_LIMIT : UPLOAD_DAILY_LIMIT;
  const quota = isNew ? NEW_AUTHOR_QUOTA_BYTES : UPLOAD_QUOTA_BYTES;
  const smallerLimitsNote = isNew
    ? `参加から ${NEW_AUTHOR_DAYS} 日間は、上限を小さくしています。`
    : '';

  // The last 24 hours rather than the calendar day: no day boundary or time zone to pick.
  const since = new Date(now - DAY_MS).toISOString();
  const recent = sqlite
    .prepare('SELECT COUNT(*) FROM uploads WHERE user_id = ? AND created_at > ?')
    .pluck()
    .get(account.userId, since);
  if (typeof recent === 'number' && recent >= dailyLimit) {
    return {
      status: STATUS_TOO_MANY,
      error: `画像は 24 時間に ${dailyLimit} 枚までです。時間をおいてから試してください。${smallerLimitsNote}`,
    };
  }

  if (sumBytes(sqlite, 'user_id = ?', account.userId) + bytes > quota) {
    return {
      status: STATUS_INSUFFICIENT_STORAGE,
      error: `画像の保存容量（${megabytes(quota)}）を超えます。記事から外した画像は、1〜2 日で容量が空きます。${smallerLimitsNote}`,
    };
  }
  return null;
}
