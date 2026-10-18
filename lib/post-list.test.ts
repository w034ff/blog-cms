import { describe, expect, it } from 'vitest';
import type { Post } from '@/lib/types';
import {
  pagedTitle,
  POSTS_PER_PAGE,
  postListPage,
  postListPageHref,
  splitPinned,
} from '@/lib/post-list';

function post(id: number): Post {
  return {
    id,
    slug: `s${id}`,
    title: `Post ${id}`,
    date: '2026-01-01',
    category: 'tech',
    tags: [],
    tagList: [],
    draft: false,
    body: '',
    thumbnail: '',
    unlisted: false,
    updatedAt: '2026-01-01',
    kind: 'post',
  };
}

const posts = (count: number) => Array.from({ length: count }, (_, i) => post(i + 1));

// docs/home-requirements.md §4.
describe('postListPage', () => {
  it('cuts 20 to a page and counts the pages', () => {
    const all = posts(41);
    expect(POSTS_PER_PAGE).toBe(20);
    expect(postListPage(all, 1).posts.map((p) => p.id)).toEqual(all.slice(0, 20).map((p) => p.id));
    expect(postListPage(all, 3).posts.map((p) => p.id)).toEqual([41]);
    expect(postListPage(all, 1).totalPages).toBe(3);
  });

  it('answers a page past the end with nothing on it, for the caller to 404', () => {
    expect(postListPage(posts(20), 2)).toEqual({ posts: [], totalPages: 1 });
  });

  it('counts an empty list as one page, so page 1 draws its empty state', () => {
    expect(postListPage([], 1)).toEqual({ posts: [], totalPages: 1 });
  });
});

// docs/home-requirements.md §3.
describe('splitPinned', () => {
  it('takes the pinned post out of the list', () => {
    const { pinned, rest } = splitPinned(posts(3), 2);
    expect(pinned?.id).toBe(2);
    expect(rest.map((p) => p.id)).toEqual([1, 3]);
  });

  it('pins nothing when the id is not a listed post, so the slot has no fallback', () => {
    expect(splitPinned(posts(3), 99)).toEqual({ pinned: null, rest: posts(3) });
    expect(splitPinned(posts(3), null)).toEqual({ pinned: null, rest: posts(3) });
  });
});

describe('postListPageHref and pagedTitle', () => {
  it('gives page 1 the bare path and title', () => {
    expect(postListPageHref('/categories/tech', 1)).toBe('/categories/tech');
    expect(postListPageHref('/categories/tech', 2)).toBe('/categories/tech?page=2');
    expect(pagedTitle('技術記事', 1)).toBe('技術記事');
    expect(pagedTitle('技術記事', 2)).toBe('技術記事 (2 ページ目)');
  });
});
