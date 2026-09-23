// Content normalization shared by the editor (client) and the publish/autosave
// paths (server) — keep this module importable from both sides (no 'server-only').

// The categories a post can be filed under — a fixed list, not free text, so the set cannot grow
// one typo at a time (docs/editor-requirements.md §12.32). The `id` is what the column stores and
// what /categories/<id> is addressed by; the `label` is what every surface shows. Order is display
// order: the editor's choices and the public index both follow it.
export const CATEGORIES = [
  { id: 'tech', label: '技術記事' },
  { id: 'blog', label: 'ブログ' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];

// The category a new post starts in. The row exists before the author ever opens 記事の設定
// (autosave creates it), so there is no "not chosen yet" state to fall back on.
export const DEFAULT_CATEGORY: CategoryId = 'tech';

export function isCategoryId(value: unknown): value is CategoryId {
  return CATEGORIES.some((category) => category.id === value);
}

// Anything that is not one of the ids reads as the default. The stored values were migrated when
// the list became fixed (drizzle/0008), so this is for what no migration reaches: a JSON column
// asserted by `$type`, or a request body.
export function normalizeCategory(value: unknown): CategoryId {
  return isCategoryId(value) ? value : DEFAULT_CATEGORY;
}

export function categoryLabel(id: CategoryId): string {
  return CATEGORIES.find((category) => category.id === id)?.label ?? id;
}

// Parse the comma-separated tags field into clean tag names: trim each entry and
// drop empties, so stray commas and spaces don't produce ghost tags.
export function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}
