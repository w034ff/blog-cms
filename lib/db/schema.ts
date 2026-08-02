import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { DEFAULT_CATEGORY } from '@/lib/content';
import type { DraftContent } from '@/lib/types';

export const posts = sqliteTable('posts', {
  // Stable internal identity, decoupled from the public slug. Autosave can
  // materialize a row (and the editor can address it) before any slug exists.
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Public URL: an opaque auto-generated slug (20 hex chars) assigned once at row
  // creation, drafts included, and never changed. Unique. Kept nullable at the
  // column level only because tightening it to NOT NULL needs a full table
  // rebuild (drizzle-kit push is broken on this table); in practice every row
  // has a slug.
  slug: text('slug').unique(),
  title: text('title').notNull(),
  date: text('date').notNull(),
  description: text('description').notNull().default(''),
  category: text('category').notNull().default(DEFAULT_CATEGORY),
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
  draft: integer('draft', { mode: 'boolean' }).notNull().default(false),
  body: text('body').notNull().default(''),
  createdAt: text('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  // Private working copy of a published post's pending edits. Null unless the
  // post is published (draft=false) and has unpublished changes. Public reads
  // never touch this — only the editor and publish/unpublish flows do.
  // Appended last so drizzle-kit push can ALTER TABLE ADD COLUMN in place.
  draftContent: text('draft_content', { mode: 'json' }).$type<DraftContent>(),
});

// Failed-login bookkeeping, so a public `/login` can't be tried at the speed the
// server answers. Keyed by the submitted username, whether or not it exists —
// tracking only real accounts would make "does this name get throttled?" an
// existence oracle. Rows are transient: cleared on a successful login and pruned
// once they age past the decay window (lib/login-throttle.ts).
export const loginAttempts = sqliteTable('login_attempts', {
  username: text('username').primaryKey(),
  failures: integer('failures').notNull().default(0),
  // Epoch milliseconds, not the ISO text used for post dates: this column is only
  // ever compared and subtracted, never displayed.
  lastFailureAt: integer('last_failure_at').notNull(),
});

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
});
