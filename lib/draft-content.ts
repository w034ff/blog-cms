import { normalizeCategory } from '@/lib/content';
import type { DraftContent } from '@/lib/types';

// The pieces of DraftContent handling that more than one table needs: `posts.draft_content` and
// `post_revisions.content` store the same shape and hit the same two hazards, so the answers live
// here rather than in whichever module met the hazard first.

// Autosave keeps the editor's LF while form submission (publish/unpublish) turns newlines into CRLF,
// and a line-based reader like lib/footnotes.ts then miscounted. One form is stored: LF.
export function normalizeNewlines(body: string): string {
  return body.replace(/\r\n?/g, '\n');
}

// `$type<DraftContent>()` only asserts the shape: a row written before a field existed lacks it (a
// missing `thumbnail` read as `undefined`, not `''`, and broke the editor's fallback), and
// `category` held free text before the fixed list (drizzle/0008 migrated what it could see).
// Normalized once at the read; a field added later needs its default here.
export function normalizeDraftContent(stored: DraftContent): DraftContent {
  return {
    ...stored,
    category: normalizeCategory(stored.category),
    thumbnail: stored.thumbnail ?? '',
  };
}

// Whether two contents are the same post as an author would see it. Written out field by field on
// purpose: a field added to DraftContent later needs a line here too, the same obligation
// `normalizeDraftContent` above carries for its defaults.
export function sameDraftContent(a: DraftContent, b: DraftContent): boolean {
  return (
    a.title === b.title &&
    a.category === b.category &&
    a.body === b.body &&
    a.thumbnail === b.thumbnail &&
    a.tags.length === b.tags.length &&
    a.tags.every((tag, index) => tag === b.tags[index])
  );
}
