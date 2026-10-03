import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMS,
  countByStatus,
  listHref,
  narrow,
  parseListParams,
  sortPosts,
} from './admin-post-list';
import type { AdminPost } from './posts';

function post(overrides: Partial<AdminPost>): AdminPost {
  return {
    id: 1,
    slug: 's',
    title: 'Title',
    date: '2026-09-01T00:00:00.000Z',
    category: 'tech',
    tags: [],
    tagList: [],
    draft: false,
    body: '',
    thumbnail: '',
    unlisted: false,
    updatedAt: '2026-09-01T00:00:00.000Z',
    editedAt: '2026-09-01T00:00:00.000Z',
    hasPendingEdits: false,
    ...overrides,
  };
}

const published = post({ id: 1, title: 'Published', editedAt: '2026-09-03T00:00:00.000Z' });
const pending = post({
  id: 2,
  title: 'Pending edits',
  category: 'blog',
  date: '2026-08-01T00:00:00.000Z',
  hasPendingEdits: true,
  editedAt: '2026-09-05T00:00:00.000Z',
});
const draft = post({
  id: 3,
  title: 'Draft',
  date: '',
  draft: true,
  category: '',
  editedAt: '2026-09-04T00:00:00.000Z',
});
const all = [published, pending, draft];

describe('parseListParams', () => {
  it('reads every parameter', () => {
    expect(
      parseListParams({ status: 'working', sort: 'published', category: 'blog', q: ' ocr ' }),
    ).toEqual({ status: 'working', sort: 'published', category: 'blog', q: 'ocr' });
  });

  it('falls back to the defaults for anything off the lists', () => {
    expect(parseListParams({ status: 'x', sort: ['y'], category: 'none' })).toEqual(DEFAULT_PARAMS);
  });
});

describe('status tabs', () => {
  // 作業中 is both kinds of unpublished work; a published post with pending edits counts in 公開中 too.
  it('counts 作業中 as drafts plus pending edits, overlapping 公開中', () => {
    expect(countByStatus(all)).toEqual({ all: 3, published: 2, working: 2 });
  });

  it('counts what category and search leave, so a tab shows its number', () => {
    expect(countByStatus(narrow(all, { ...DEFAULT_PARAMS, category: 'blog' }))).toEqual({
      all: 1,
      published: 1,
      working: 1,
    });
    expect(narrow(all, { ...DEFAULT_PARAMS, q: 'pending' }).map((p) => p.id)).toEqual([2]);
  });
});

describe('sortPosts', () => {
  it('orders by last edit by default', () => {
    expect(sortPosts(all, 'edited').map((p) => p.id)).toEqual([2, 3, 1]);
  });

  it('orders by publish date, with never-published posts last', () => {
    expect(sortPosts(all, 'published').map((p) => p.id)).toEqual([1, 2, 3]);
  });
});

describe('listHref', () => {
  it('keeps the plain /admin for the defaults', () => {
    expect(listHref(DEFAULT_PARAMS, {})).toBe('/admin');
  });

  it('carries the other parameters across a change', () => {
    const params = { ...DEFAULT_PARAMS, category: 'blog' as const, q: 'a b' };
    expect(listHref(params, { status: 'working' })).toBe(
      '/admin?status=working&category=blog&q=a+b',
    );
  });
});
