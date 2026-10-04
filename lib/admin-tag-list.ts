import type { DictionaryTag } from '@/lib/types';

// タグの管理's tabs and sort, carried in the URL as 記事一覧's are (lib/admin-post-list.ts), so a view
// survives a reload and the back button. The search stays in the field: it is also the add field,
// and a word typed to add is not a view to keep. Pure, so the rules are tested without a page
// (lib/admin-tag-list.test.ts).

// 未使用 is the tab the screen is opened for: tags no post carries, drafts and pending edits included
// (lib/tags.ts `tagUsage`), are the ones to tidy away.
export const TAG_USES = ['all', 'used', 'unused'] as const;
export type TagUse = (typeof TAG_USES)[number];

export const TAG_SORTS = ['slug', 'most', 'least'] as const;
export type TagSort = (typeof TAG_SORTS)[number];

export type TagListParams = { use: TagUse; sort: TagSort };

export const DEFAULT_TAG_PARAMS: TagListParams = { use: 'all', sort: 'slug' };

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function oneOf<T extends string>(options: readonly T[], value: string, fallback: T): T {
  return options.find((option) => option === value) ?? fallback;
}

// Anything off the lists falls back to the default: a hand-edited or stale URL still shows the table.
export function parseTagListParams(raw: RawParams): TagListParams {
  return {
    use: oneOf(TAG_USES, first(raw.use), DEFAULT_TAG_PARAMS.use),
    sort: oneOf(TAG_SORTS, first(raw.sort), DEFAULT_TAG_PARAMS.sort),
  };
}

export function matchesUse(count: number, use: TagUse): boolean {
  if (use === 'used') return count > 0;
  if (use === 'unused') return count === 0;
  return true;
}

export function countByUse(
  tags: readonly DictionaryTag[],
  usage: Record<string, number>,
): Record<TagUse, number> {
  const used = tags.filter((tag) => (usage[tag.slug] ?? 0) > 0).length;
  return { all: tags.length, used, unused: tags.length - used };
}

// Ties on a count fall back to the identifier, so the order is the same on every load.
export function sortTags(
  tags: readonly DictionaryTag[],
  usage: Record<string, number>,
  sort: TagSort,
): DictionaryTag[] {
  return [...tags].sort((a, b) => {
    const byCount = (usage[b.slug] ?? 0) - (usage[a.slug] ?? 0);
    const bySlug = a.slug.localeCompare(b.slug);
    if (sort === 'most') return byCount || bySlug;
    if (sort === 'least') return -byCount || bySlug;
    return bySlug;
  });
}

// The screen's URL with `change` applied, defaults left out so the plain /admin/tags stays plain.
export function tagListHref(params: TagListParams, change: Partial<TagListParams>): string {
  const next = { ...params, ...change };
  const query = new URLSearchParams();
  if (next.use !== DEFAULT_TAG_PARAMS.use) query.set('use', next.use);
  if (next.sort !== DEFAULT_TAG_PARAMS.sort) query.set('sort', next.sort);
  const search = query.toString();
  return search ? `/admin/tags?${search}` : '/admin/tags';
}
