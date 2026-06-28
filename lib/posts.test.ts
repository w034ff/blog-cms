import { beforeEach, describe, expect, it, vi } from 'vitest';
import { posts } from '@/lib/db/schema';
import { db } from '@/lib/db';
import {
  getAllCategories,
  getAllPosts,
  getAllTags,
  getPostBySlug,
  getPostForEdit,
  getPostsByCategory,
  getPostsByTag,
  listAllPosts,
} from '@/lib/posts';
import type { DraftContent } from '@/lib/types';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

beforeEach(() => {
  db.delete(posts).run();
});

type SeedOptions = {
  slug?: string | null;
  title?: string;
  date?: string;
  category?: string;
  tags?: string[];
  draft?: boolean;
  body?: string;
  draftContent?: DraftContent | null;
};

function seed(options: SeedOptions = {}): number {
  return db
    .insert(posts)
    .values({
      slug: options.slug ?? null,
      title: options.title ?? 'Title',
      date: options.date ?? '2026-01-01',
      description: '',
      category: options.category ?? 'uncategorized',
      tags: options.tags ?? [],
      draft: options.draft ?? false,
      body: options.body ?? '',
      draftContent: options.draftContent ?? null,
    })
    .returning({ id: posts.id })
    .get().id;
}

describe('getAllPosts', () => {
  it('returns only published posts, newest first', async () => {
    seed({ slug: 'old', date: '2026-01-01' });
    seed({ slug: 'new', date: '2026-03-03' });
    seed({ slug: 'mid', date: '2026-02-02' });
    seed({ slug: 'draft', date: '2026-04-04', draft: true });

    const result = await getAllPosts();
    expect(result.map((p) => p.slug)).toEqual(['new', 'mid', 'old']);
  });
});

describe('getPostBySlug', () => {
  it('returns a published post', async () => {
    seed({ slug: 'hello', title: 'Hello' });
    expect((await getPostBySlug('hello'))?.title).toBe('Hello');
  });

  it('returns null for a draft (drafts have no public page)', async () => {
    seed({ slug: 'wip', draft: true });
    expect(await getPostBySlug('wip')).toBeNull();
  });

  it('returns null for a missing slug', async () => {
    expect(await getPostBySlug('nope')).toBeNull();
  });
});

describe('listAllPosts (admin)', () => {
  it('includes drafts, newest first', async () => {
    seed({ slug: 'pub', date: '2026-01-01' });
    seed({ slug: null, date: '2026-02-02', draft: true });
    const result = await listAllPosts();
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe('2026-02-02');
  });
});

describe('getPostForEdit', () => {
  it('returns the pending working copy when present', async () => {
    const pending: DraftContent = {
      title: 'Pending',
      description: 'd',
      category: 'cat',
      tags: ['x'],
      body: 'pending body',
    };
    const id = seed({ slug: 'p', draft: false, draftContent: pending });
    expect((await getPostForEdit(id))?.draftContent?.title).toBe('Pending');
  });

  it('returns null draftContent when there are no pending edits', async () => {
    const id = seed({ slug: 'p' });
    expect((await getPostForEdit(id))?.draftContent).toBeNull();
  });

  it('returns null for a missing id', async () => {
    expect(await getPostForEdit(9999)).toBeNull();
  });
});

describe('getPostsByTag / getPostsByCategory', () => {
  it('returns only published posts carrying the tag', async () => {
    seed({ slug: 'a', tags: ['ts', 'db'] });
    seed({ slug: 'b', tags: ['ts'] });
    seed({ slug: 'c', tags: ['ts'], draft: true });
    const result = await getPostsByTag('ts');
    expect(result.map((p) => p.slug).sort()).toEqual(['a', 'b']);
  });

  it('returns only published posts in the category', async () => {
    seed({ slug: 'a', category: 'tech' });
    seed({ slug: 'b', category: 'life' });
    seed({ slug: 'c', category: 'tech', draft: true });
    const result = await getPostsByCategory('tech');
    expect(result.map((p) => p.slug)).toEqual(['a']);
  });
});

describe('getAllTags / getAllCategories', () => {
  it('counts tags across published posts, sorted by count then name', async () => {
    seed({ slug: 'a', tags: ['ts', 'db'] });
    seed({ slug: 'b', tags: ['ts'] });
    seed({ slug: 'c', tags: ['secret'], draft: true });
    expect(await getAllTags()).toEqual([
      { tag: 'ts', count: 2 },
      { tag: 'db', count: 1 },
    ]);
  });

  it('counts categories across published posts only', async () => {
    seed({ slug: 'a', category: 'tech' });
    seed({ slug: 'b', category: 'tech' });
    seed({ slug: 'c', category: 'life' });
    seed({ slug: 'd', category: 'hidden', draft: true });
    expect(await getAllCategories()).toEqual([
      { category: 'tech', count: 2 },
      { category: 'life', count: 1 },
    ]);
  });
});
