import type { Post } from '@/lib/types';
import { calculateTotalPages } from '@/lib/scribble-list';

// The post lists' page size (docs/home-requirements.md §4): the home page, /categories/<id> and
// /tags/<slug>. The scribble list's size, so the two kinds of list turn their pages alike; even, so
// the two-column grid ends on a full row.
export const POSTS_PER_PAGE = 20;

export type PostListPage = { posts: Post[]; totalPages: number };

// One page of an already-ordered list. A page past the end comes back empty with the real
// `totalPages`, so the caller can answer 404 rather than draw an empty page.
export function postListPage(
  posts: readonly Post[],
  page: number,
  perPage: number = POSTS_PER_PAGE,
): PostListPage {
  const start = (page - 1) * perPage;
  return {
    posts: posts.slice(start, start + perPage),
    totalPages: calculateTotalPages(posts.length, perPage),
  };
}

// The pinned post out of the home list (docs/home-requirements.md §3): drawn once, above the list,
// not again inside it. `pinnedId` naming a post that is not in `posts` — unpublished since, or by a
// suspended or withdrawing author, or deleted — pins nothing, which is how the slot disappears without a fallback.
export function splitPinned(
  posts: readonly Post[],
  pinnedId: number | null,
): { pinned: Post | null; rest: Post[] } {
  const pinned = pinnedId === null ? undefined : posts.find((post) => post.id === pinnedId);
  if (pinned === undefined) return { pinned: null, rest: [...posts] };
  return { pinned, rest: posts.filter((post) => post !== pinned) };
}

// Page 1 is the bare path, so a list has one URL for its first page.
export function postListPageHref(basePath: string, page: number): string {
  return page > 1 ? `${basePath}?page=${page}` : basePath;
}

// The tab title of a later page, as the scribble list's (lib/scribble-list.ts).
export function pagedTitle(title: string, page: number): string {
  return page > 1 ? `${title} (${page} ページ目)` : title;
}
