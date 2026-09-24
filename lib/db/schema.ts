import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
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
  // One of CATEGORIES' ids (lib/content.ts). The DDL default is the free-text era's sentinel and
  // is never used — every insert writes the column — but moving it would make drizzle-kit rebuild
  // this table, which is the path that aborts midway here. Reads normalize anything off the list.
  category: text('category').notNull().default('uncategorized'),
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
  // The post's card image, as a site-relative `/uploads/<name>` path. Empty
  // means "not set by the author", which is not the same as "no image": the
  // reader-facing value is resolved by lib/thumbnail.ts, which falls back to the
  // first upload referenced in the body. Kept as a path rather than an absolute
  // URL so it stays valid across the origin changes SITE_ORIGIN exists for.
  // Also appended at the tail — see the note above; on this table that is the
  // only shape of schema change that reaches a populated DB in place.
  thumbnail: text('thumbnail').notNull().default(''),
  // A published post excluded from the home/tag/category listings and the RSS
  // feed, reachable only by its direct URL. The opaque slug (see the note
  // above) is what makes that safe — there is no separate access check.
  // Appended at the tail for the same reason as `draftContent`/`thumbnail`.
  unlisted: integer('unlisted', { mode: 'boolean' }).notNull().default(false),
});

// Failed-login bookkeeping, so a public `/login` can't be tried at the speed the
// server answers. Keyed by the submitted username, whether or not it exists —
// tracking only real accounts would make "does this name get throttled?" an
// existence oracle. Rows are transient: cleared on a successful login and pruned
// once they age past the decay window (lib/login-throttle.ts).
export const loginAttempts = sqliteTable('login_attempts', {
  username: text('username').primaryKey(),
  failures: integer('failures').notNull().default(0),
  // Epoch milliseconds: only compared, never displayed.
  lastFailureAt: integer('last_failure_at').notNull(),
});

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  // What the account may do beyond writing (docs/editor-requirements.md §12.33.1). `author` writes
  // posts; `admin` also runs the screens that change the whole site, such as the tag dictionary.
  // A reader has no row at all. Read from here on each check, not carried in the session token, so
  // a changed role takes effect on the next request rather than when the 14-day cookie runs out.
  role: text('role', { enum: ['admin', 'author'] }).notNull().default('author'),
});

// What is known about an external link card's target (docs/link-card-requirements.md §14.3). The
// editor fills it and the published page only reads it: that page is `force-dynamic`, so a fetch
// there would run per reader request at a third party's latency, and a process-local cache would
// drop every card to a plain link on restart. Its own table, since `posts` only accepts columns
// appended at its tail (see `draftContent` above).
export const linkPreviews = sqliteTable('link_previews', {
  // The `data-href` exactly as the body carries it: reference, fetch and `<a href>` are one string.
  url: text('url').primaryKey(),
  // Empty is a real answer (a page without a description, or a `failed` row); the card omits it.
  title: text('title').notNull().default(''),
  description: text('description').notNull().default(''),
  // Why the row is empty; no row means not fetched yet. `partial` (page read, image not) retries
  // sooner (§14.3.1).
  status: text('status', { enum: ['ok', 'partial', 'failed'] }).notNull(),
  // The reader version that wrote the row; an older one is stale whatever its timestamp (§14.3.1).
  version: integer('version').notNull().default(0),
  // Epoch milliseconds, compared by the route's TTL (shorter for `failed`).
  fetchedAt: integer('fetched_at').notNull(),
  // The og:image URL, kept as a reference, never bytes (§14.4); readers load the signed
  // `/api/link-image` path derived from it. Empty includes "could not be fetched".
  image: text('image').notNull().default(''),
});

// Past versions of a post (docs/revision-requirements.md). Its own table, not columns on `posts`:
// one post carries several, and `posts` only accepts schema changes appended at its tail.
//
// No foreign key. `deletePost` removes a post's revisions in the same transaction instead, because
// a cascade would hold only where `foreign_keys` is on — the app's connection, not test/db.ts's —
// and a test of "deleting a post deletes its revisions" would then measure nothing.
export const postRevisions = sqliteTable('post_revisions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  postId: integer('post_id').notNull(),
  // Epoch milliseconds, like `loginAttempts.lastFailureAt`; the history page formats it as JST.
  createdAt: integer('created_at').notNull(),
  // What was about to be lost when this was taken (§3): a published version being replaced, or
  // what a restore replaced.
  reason: text('reason', { enum: ['publish', 'restore'] }).notNull(),
  // A DraftContent, newlines normalized to LF. Read through `normalizeDraftContent`, for the same
  // reason `draft_content` is: `$type` asserts the shape of rows written before a field existed.
  content: text('content', { mode: 'json' }).$type<DraftContent>().notNull(),
});

// The tag dictionary (docs/editor-requirements.md §12.33). A post's `tags` column, its working
// copy and its revisions hold slugs from here, never names: `slug` is the URL (`/tags/<slug>`)
// and is fixed once the tag exists, `name` is what every surface shows and is the part that can be
// renamed. A tag reaches this table from the editor (typed, then confirmed as new) or from
// /admin/tags; nothing else creates one.
export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull().unique(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// Other identifiers that stand for a tag (docs/editor-requirements.md §12.33) — `next` for
// `nextjs`, as Zenn keeps them. An alias is never stored in a post: choosing one in the editor
// stores the tag's own identifier, and /tags/<alias> redirects to /tags/<identifier>. One word
// names one tag, so an alias is unique here and never equal to any tag's identifier (lib/tags.ts
// checks the second; this key the first). Recorded automatically when an identifier is changed or
// merged away, so the old word keeps leading to the tag; added by hand in /admin/tags.
export const tagAliases = sqliteTable('tag_aliases', {
  alias: text('alias').primaryKey(),
  tagId: integer('tag_id')
    .notNull()
    .references(() => tags.id, { onDelete: 'cascade' }),
});
