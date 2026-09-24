// Content normalization shared by the editor (client) and the publish/autosave
// paths (server) — keep this module importable from both sides (no 'server-only').

// The categories a post can be filed under — a fixed list, not free text, so the set cannot grow
// one typo at a time (docs/editor-requirements.md §12.32). The `id` is what the column stores and
// what /categories/<id> is addressed by; the `label` is what every surface shows. Order is display
// order: the editor's choices and the public index both follow it. `description` is addressed to the
// author choosing in 記事の設定, not to readers, which is why the public index does not show it.
export const CATEGORIES = [
  { id: 'tech', label: '技術記事', description: '実際に試して確かめた内容や、技術的な知見' },
  { id: 'blog', label: 'ブログ', description: '技術を離れた話題、考えや振り返り、お知らせ' },
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

// Longest display name /admin/tags accepts — what readers see, which may be a phrase.
export const TAG_NAME_MAX_LENGTH = 40;

// Longest identifier: what an author types and what the editor draws as a chip. Zenn's limit for a
// topic (`validateTopicLength`, 18), and what keeps any one chip inside the drawer's width.
export const TAG_SLUG_MAX_LENGTH = 18;

// A tag name as the dictionary stores it: NFKC (so a full-width `Ｒｅａｃｔ` is `React`), trimmed,
// and with runs of whitespace collapsed to one space. Case is kept — the name is for display.
export function normalizeTagName(raw: string): string {
  return raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

// Half-width symbols and the space (docs/editor-requirements.md §12.33) — Zenn's own rule for
// topics, `validateInvalidTopicLetters` in zenn-editor's packages/zenn-model/src/utils.ts, the same
// character class. A tag written with none of them has one spelling: `Next.js`, `next.js` and
// `next-js` can only be written `nextjs`. Checked after NFKC, so a full-width `＃` or `　` counts.
const TAG_SYMBOLS = /[ -/:-@[-`{-~]/;

export const TAG_SYMBOL_MESSAGE = 'タグに記号やスペースは使えません。';

export function hasTagSymbols(name: string): boolean {
  return TAG_SYMBOLS.test(normalizeTagName(name));
}

// Why typed text cannot be an identifier, or null when it can. Shared by the editor, which says it
// as the text is typed, and the server, which refuses with the same words.
export function tagSlugProblem(name: string): string | null {
  if (hasTagSymbols(name)) return TAG_SYMBOL_MESSAGE;
  if ([...normalizeTagName(name)].length > TAG_SLUG_MAX_LENGTH) {
    return `タグは ${TAG_SLUG_MAX_LENGTH} 文字まで入力できます。`;
  }
  return null;
}

// The identifier a new tag gets from what was typed: the normalized text, lowercased, so `NextJS`
// and `nextjs` are one tag. '' when that is empty or has a problem (`tagSlugProblem`) — a symbol is
// refused rather than stripped, since stripping would make `C#` the tag `c`. Only new identifiers
// go through this; the ones backfilled by drizzle/0010 kept the value they were already stored under.
export function tagSlug(name: string): string {
  return tagSlugProblem(name) === null ? normalizeTagName(name).toLowerCase() : '';
}

// What the editor's search compares: lowercased with the symbols dropped, so typing `Next.js`
// still finds `nextjs` — the tag the author is being steered to.
export function tagSearchKey(text: string): string {
  return normalizeTagName(text).toLowerCase().replace(new RegExp(TAG_SYMBOLS.source, 'g'), '');
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
