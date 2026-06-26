export type PostFrontmatter = {
  title: string;
  date: string;
  description: string;
  tags: string[];
  category: string;
  draft: boolean;
};

export type Post = PostFrontmatter & {
  // Stable internal id (PK). The editor and admin address posts by this; the
  // public site addresses them by `slug`.
  id: number;
  // Opaque public URL slug, assigned at row creation. Typed nullable to match
  // the (deliberately not-yet-tightened) column, but in practice always set.
  slug: string | null;
  body: string;
};

// The editable content of a post, minus its identity (slug) and visibility
// (draft) flag. Stored in posts.draft_content as a private working copy of a
// *published* post: autosave writes here so the live (public) columns stay
// untouched until the author explicitly publishes.
export type DraftContent = Omit<PostFrontmatter, 'draft'> & {
  body: string;
};

export type TagCount = {
  tag: string;
  count: number;
};

export type CategoryCount = {
  category: string;
  count: number;
};
