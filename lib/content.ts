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

// How many tags a post can carry. Enforced by the editor's field and refused at publish.
export const MAX_TAGS = 5;

// Longest tag name the dictionary accepts — a tag is a word or two, and the name is drawn as a chip.
export const TAG_NAME_MAX_LENGTH = 40;

// A tag name as the dictionary stores it: NFKC (so a full-width `Ｒｅａｃｔ` is `React`), trimmed,
// and with runs of whitespace collapsed to one space. Case is kept — the name is for display.
export function normalizeTagName(raw: string): string {
  return raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

// The slug a new tag gets from its name (docs/editor-requirements.md §12.33): the normalized name,
// lowercased, with whitespace turned into `-` and the characters that would break a URL path
// segment or the form's comma-separated field removed. So `Next.js` and `next.js` are one tag, and
// `React Server Components` is `react-server-components`. '' when nothing usable is left, which the
// caller refuses. Only new tags go through this; the ones backfilled by drizzle/0010 kept the value
// they were already stored under.
export function tagSlug(name: string): string {
  const slug = normalizeTagName(name)
    .toLowerCase()
    .replace(/[,/?#%\\]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  // `.` and `..` are path segments a URL resolves away, not a tag page.
  return /^\.+$/.test(slug) ? '' : slug;
}

// Parse the comma-separated tags field into slugs: trim each entry, drop empties and repeats, so
// stray commas and spaces don't produce ghost tags. Whether each slug is in the dictionary is the
// server's question (lib/tags.ts `knownTagSlugs`) — this module is shared with the client.
export function parseTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    ),
  ];
}
