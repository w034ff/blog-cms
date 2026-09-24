import type { CategoryId } from '@/lib/content';

export type PostFrontmatter = {
  title: string;
  date: string;
  tags: string[];
  category: CategoryId;
  draft: boolean;
  // The card image the author chose, as a `/uploads/<name>` path; '' when they
  // chose none. Not the image a reader sees — that is `resolveThumbnail`
  // (lib/thumbnail.ts), which falls back to the body's first upload.
  thumbnail: string;
  // Refreshed on every publish/update/unpublish (`commitPost`), UTC ISO. Shown
  // publicly (date-only) only when it names a different calendar day than
  // `date` — a same-day value is noise, not information (docs/cms-features.md,
  // 更新日表示).
  updatedAt: string;
};

// A dictionary entry (lib/tags.ts): `slug` is what posts store and the URL, `name` is what shows.
export type Tag = {
  slug: string;
  name: string;
};

// A tag with the other identifiers that stand for it (lib/tags.ts), for the two screens that let
// an author reach it by one of them: the editor's tag field and /admin/tags.
export type DictionaryTag = Tag & {
  aliases: string[];
};

export type Post = PostFrontmatter & {
  // `tags` resolved against the dictionary, for the surfaces that draw them. Not part of
  // PostFrontmatter, and so not of DraftContent: a name is the dictionary's, not the post's, and a
  // rename must not read as an unpublished edit.
  tagList: Tag[];
  // Stable internal id (PK). The editor and admin address posts by this; the
  // public site addresses them by `slug`.
  id: number;
  // Opaque public URL slug, assigned at row creation. Typed nullable to match
  // the (deliberately not-yet-tightened) column, but in practice always set.
  slug: string | null;
  body: string;
  // Excluded from the home/tag/category listings and the RSS feed; still reachable at its own
  // `/posts/<slug>` URL by anyone who has it. Read-only now: the editor's control was retired
  // 2026-09-21 and nothing writes the column (docs/cms-features.md「非公開限定URL投稿」), so it is
  // false on every row. Kept on Post, and off PostFrontmatter and so off DraftContent, because
  // the listing filters it drives are what a revival would reuse.
  unlisted: boolean;
};

// The editable content of a post, minus its identity (slug), visibility (draft)
// flag, publish date, and update timestamp. `date`/`updatedAt` are server-managed
// (stamped by lib/posts-write.ts, never hand-edited), so neither is part of the
// editable content. Stored in posts.draft_content as a private working copy of a
// *published* post: autosave writes here so the live (public) columns stay
// untouched until the author explicitly publishes.
export type DraftContent = Omit<PostFrontmatter, 'draft' | 'date' | 'updatedAt'> & {
  body: string;
};

export type TagCount = Tag & {
  count: number;
};

export type CategoryCount = {
  category: CategoryId;
  count: number;
};

// One row of `/api/posts/search` — what the link card's NodeView draws and what its insert search
// lists (docs/link-card-requirements.md §5.3). Declared here rather than in the route so the
// editor can import the type without importing a server module. Deliberately no `body`: a search
// must not become a way to read whole posts.
export type PostSearchResult = {
  slug: string;
  title: string;
  date: string;
  draft: boolean;
  // The image the card draws, already resolved by `resolveThumbnail` — the
  // column when the author set one, else the body's first upload. `null` is the
  // normal answer for a text-only post, not an error, so it stays nullable
  // rather than collapsing to '' like `slug` does.
  //
  // This is the one thing here derived from the body, which the rule above
  // otherwise keeps out. It is a single `/uploads/…` path that the target
  // post's own page already shows to anyone, the route is admin-only (401
  // without a session), and what crosses is the resolver's answer rather than
  // the text it read — so a search still cannot be used to read a post.
  thumbnail: string | null;
  // The post's own category, drawn as the second line of an insert-search row
  // (§5.2-5). The id, not the label: the row looks the label up through
  // `categoryLabel`, the same map every other surface uses.
  category: CategoryId;
};
