import { isCategoryId, type CategoryId } from '@/lib/content';
import type { AdminPost } from '@/lib/posts';
import { first, oneOf, type RawParams } from '@/lib/search-params';

// 記事一覧's tabs, category, sort and title search, carried in the URL so a view survives a reload
// and the browser's back button. Pure, so the rules are tested without a page (lib/admin-post-list.test.ts).

// 作業中 is unpublished work of either kind — a draft, or a published post's pending edits — since
// the tab is opened to finish what was left, and the row's badge already tells the two apart. A
// published post with pending edits is in both 公開中 and 作業中, so the counts overlap.
export const STATUSES = ['all', 'published', 'working'] as const;
export type Status = (typeof STATUSES)[number];

export const SORTS = ['edited', 'published'] as const;
export type Sort = (typeof SORTS)[number];

export type ListParams = {
  status: Status;
  sort: Sort;
  category: CategoryId | null;
  q: string;
};

export const DEFAULT_PARAMS: ListParams = { status: 'all', sort: 'edited', category: null, q: '' };

// Anything off the lists falls back to the default rather than erroring: a hand-edited or stale URL
// still shows a list.
export function parseListParams(raw: RawParams): ListParams {
  const category = first(raw.category);
  return {
    status: oneOf(STATUSES, first(raw.status), DEFAULT_PARAMS.status),
    sort: oneOf(SORTS, first(raw.sort), DEFAULT_PARAMS.sort),
    category: isCategoryId(category) ? category : null,
    q: first(raw.q).trim(),
  };
}

export function matchesStatus(post: AdminPost, status: Status): boolean {
  if (status === 'published') return !post.draft;
  if (status === 'working') return post.draft || post.hasPendingEdits;
  return true;
}

// Category and search narrow the set the tabs count, so a tab's number is what clicking it shows.
export function narrow(posts: readonly AdminPost[], params: ListParams): AdminPost[] {
  const needle = params.q.toLowerCase();
  return posts.filter(
    (post) =>
      (params.category === null || post.category === params.category) &&
      (needle === '' || post.title.toLowerCase().includes(needle)),
  );
}

export function countByStatus(posts: readonly AdminPost[]): Record<Status, number> {
  return {
    all: posts.length,
    published: posts.filter((post) => matchesStatus(post, 'published')).length,
    working: posts.filter((post) => matchesStatus(post, 'working')).length,
  };
}

// 公開日 order puts posts never published (date '') after the rest, by last edit among themselves.
export function sortPosts(posts: readonly AdminPost[], sort: Sort): AdminPost[] {
  const byEdited = (a: AdminPost, b: AdminPost) => b.editedAt.localeCompare(a.editedAt);
  if (sort === 'edited') return [...posts].sort(byEdited);
  return [...posts].sort((a, b) => b.date.localeCompare(a.date) || byEdited(a, b));
}

// The list's URL with `change` applied, defaults left out so the plain basePath stays plain.
export function listHref(
  basePath: string,
  params: ListParams,
  change: Partial<ListParams>,
): string {
  const next = { ...params, ...change };
  const query = new URLSearchParams();
  if (next.status !== DEFAULT_PARAMS.status) query.set('status', next.status);
  if (next.sort !== DEFAULT_PARAMS.sort) query.set('sort', next.sort);
  if (next.category !== null) query.set('category', next.category);
  if (next.q !== '') query.set('q', next.q);
  const search = query.toString();
  return search ? `${basePath}?${search}` : basePath;
}
