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
  // Epoch milliseconds, not the ISO text used for post dates: this column is only
  // ever compared and subtracted, never displayed.
  lastFailureAt: integer('last_failure_at').notNull(),
});

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
});

// What is known about a URL a link card points at (docs/link-card-requirements.md §14.3).
//
// A card stores a reference and nothing the reader sees (§4.2), so something has to hold the
// target's title. For a card pointing at this blog that something is `posts`; for an external URL
// it is this table, filled by the editor when the author inserts or opens a card and read — never
// written, never fetched around — by the published page.
//
// That split is the whole point: the public page is `force-dynamic`, so a fetch placed there would
// run per reader request, at the third party's latency (measured 2026-08-18: 113ms–2450ms across
// ten sites). Persisting the answer is what lets the reader's request touch nothing but SQLite.
// A process-local cache would not do — losing it on restart drops every card on the site back to a
// plain link, which is exactly what `<a>` fallback exists to survive, not to be the normal state.
//
// Its own table rather than columns on `posts`: three posts linking the same URL want one row, and
// `posts` only accepts schema changes appended at its tail (see the notes on `draftContent` and
// `thumbnail` above).
export const linkPreviews = sqliteTable('link_previews', {
  // The `data-href` string exactly as the author's body carries it. Not normalized: the reference
  // in the markdown, the URL fetched, and the published `<a href>` are one string, which is worth
  // more than collapsing `?utm_source=` variants into one row.
  url: text('url').primaryKey(),
  // Empty is a real answer for both — a page can have a title and no description (measured
  // 2026-08-18: og:description or `<meta name="description">` on 6 of 10 sites), and a `failed`
  // row has neither. The card omits a line rather than showing an empty one.
  title: text('title').notNull().default(''),
  description: text('description').notNull().default(''),
  // Why the row is empty, since "not fetched yet" is the absence of a row and must stay
  // distinguishable from "fetched, and there was nothing to read". `partial` is the third answer:
  // the page was read but the image it advertised could not be, which is worth retrying far sooner
  // than a page that simply has no image (§14.3.1).
  status: text('status', { enum: ['ok', 'partial', 'failed'] }).notNull(),
  // What this project knew how to read when the row was written. A row from an older version is
  // stale whatever its timestamp says — measured the hard way on 2026-08-18: rows written in the
  // hours before the `image` column existed sat there for the rest of their week-long TTL with no
  // picture, and no amount of reopening the post could shake them loose (§14.3.1).
  version: integer('version').notNull().default(0),
  // Epoch milliseconds, like `loginAttempts.lastFailureAt` and for the same reason: only ever
  // compared, never displayed. Read by the route's TTL, which is shorter for `failed`.
  fetchedAt: integer('fetched_at').notNull(),
  // The target's og:image, as the target gives it — a third party's absolute URL, kept as a
  // reference and never as bytes (§14.4). What a reader's browser actually loads is this site's own
  // `/api/link-image?url=…&sig=…`, derived from this column at render time, so the value here is
  // signed into a proxy path rather than published. Empty means the page had no usable image, which
  // includes "it had one and it could not be fetched when the row was written".
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
