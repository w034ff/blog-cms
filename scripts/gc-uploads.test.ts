import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestSqlite } from '@/test/db';
import { sweepUploads } from './gc-uploads.mts';

const NOW = Date.parse('2026-10-19T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
const GRACE_MS = 24 * HOUR_MS;

let dir: string;
let sqlite: Database.Database;

function addFile(name: string, ageHours: number): void {
  const file = path.join(dir, name);
  writeFileSync(file, 'x');
  const at = new Date(NOW - ageHours * HOUR_MS);
  utimesSync(file, at, at);
}

function addLedgerRow(userId: number, name: string): void {
  sqlite
    .prepare(
      "INSERT INTO uploads (name, user_id, bytes, created_at) VALUES (?, ?, 1, '2026-10-01T00:00:00.000Z')",
    )
    .run(name, userId);
}

function ledger(): string[] {
  return sqlite
    .prepare("SELECT user_id || ':' || name FROM uploads ORDER BY user_id, name")
    .pluck()
    .all()
    .map(String);
}

function sweep(apply: boolean, refs: string[] = []) {
  return sweepUploads({
    uploadDir: dir,
    refs: new Set(refs),
    graceMs: GRACE_MS,
    now: NOW,
    apply,
    ledger: apply ? sqlite : null,
  });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'gc-uploads-'));
  mkdirSync(dir, { recursive: true });
  sqlite = createTestSqlite();
  addFile('orphan.png', 48);
  addFile('kept.png', 48);
  addFile('young.png', 1);
  // The same orphan under two accounts, and rows for the files the sweep keeps.
  addLedgerRow(1, 'orphan.png');
  addLedgerRow(2, 'orphan.png');
  addLedgerRow(2, 'kept.png');
  addLedgerRow(2, 'young.png');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// docs/abuse-limits-requirements.md §8 row 7.
describe('sweepUploads and the upload ledger', () => {
  it('removes every account’s row for a file it deletes, and only those', () => {
    const result = sweep(true, ['kept.png']);
    expect(result.deleted.map((o) => o.name)).toEqual(['orphan.png']);
    expect(existsSync(path.join(dir, 'orphan.png'))).toBe(false);
    // Referenced and within the grace window: the file stays, so its row does.
    expect(ledger()).toEqual(['2:kept.png', '2:young.png']);
  });

  it('writes nothing without --delete', () => {
    const result = sweep(false, ['kept.png']);
    expect(result.orphans.map((o) => o.name)).toEqual(['orphan.png']);
    expect(result.deleted).toEqual([]);
    expect(existsSync(path.join(dir, 'orphan.png'))).toBe(true);
    expect(ledger()).toHaveLength(4);
  });

  it('sweeps a DB the ledger migration has not reached', () => {
    sqlite.exec('DROP TABLE uploads');
    expect(sweep(true, ['kept.png']).deleted.map((o) => o.name)).toEqual(['orphan.png']);
  });
});
