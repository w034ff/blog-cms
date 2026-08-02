import { describe, expect, it } from 'vitest';
import { getTableColumns, getTableName, sql } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as schema from '@/lib/db/schema';
import { createTestDb } from '@/test/db';

// test/db.ts builds its database by replaying drizzle/, so this no longer guards a
// hand-written copy of the schema — it guards the thing that replaced it: whether
// the migrations on disk still add up to what lib/db/schema.ts declares. Editing
// schema.ts and forgetting `npm run db:generate` fails here, which is the mistake
// that would otherwise be found in production, where the column really is missing.
// Compares column names only — not types, constraints or defaults.
describe('migrations match the declared schema', () => {
  // No type predicate: each entry is already a concretely-typed table, and
  // narrowing to the generic SQLiteTable would widen away the column types that
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
