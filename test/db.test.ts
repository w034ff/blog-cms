import { describe, expect, it } from 'vitest';
import { getTableColumns, sql } from 'drizzle-orm';
import { posts } from '@/lib/db/schema';
import { createTestDb } from '@/test/db';

// Guard against drift between the hand-written CREATE TABLE in test/db.ts and the
// real schema in lib/db/schema.ts (they are synced by hand because drizzle-kit
// push is broken on `posts`). Catches added/renamed/removed columns — the common
// and impactful drift — by name. It does NOT check types/constraints/defaults.
describe('test DB schema drift guard', () => {
  it('posts columns in test/db.ts match lib/db/schema.ts', () => {
    const db = createTestDb();
    const actual = db
      .all<{ name: string }>(sql`PRAGMA table_info(posts)`)
      .map((column) => column.name)
      .sort();
    const expected = Object.values(getTableColumns(posts))
      .map((column) => column.name)
      .sort();
    expect(actual).toEqual(expected);
  });
});
