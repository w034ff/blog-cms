import { describe, expect, it } from 'vitest';
import { getTableColumns, getTableName, sql } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as schema from '@/lib/db/schema';
import { createTestDb } from '@/test/db';

// test/db.ts replays drizzle/, so this guards that the migrations still add up to lib/db/schema.ts:
// editing schema.ts without `npm run db:generate` fails here rather than in production. Column
// names only, not types, constraints or defaults.
describe('migrations match the declared schema', () => {
  // No type predicate: narrowing to the generic SQLiteTable would lose the column types
  // getTableColumns needs.
  const tables = Object.values(schema).filter((value) => value instanceof SQLiteTable);

  it('declares at least one table', () => {
    expect(tables.length).toBeGreaterThan(0);
  });

  it.each(tables.map((table) => [getTableName(table), table] as const))(
    '%s has the declared columns',
    (name, table) => {
      const db = createTestDb();
      const actual = db
        .all<{ name: string }>(sql`PRAGMA table_info(${sql.identifier(name)})`)
        .map((column) => column.name)
        .sort();
      const expected = Object.values(getTableColumns(table))
        .map((column) => column.name)
        .sort();
      expect(actual).toEqual(expected);
    },
  );
});
