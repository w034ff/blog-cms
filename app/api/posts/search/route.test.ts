import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { posts, users } from '@/lib/db/schema';
import { OWN_POSTS_SCOPE, type PostSearchResult } from '@/lib/types';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

const currentSession = vi.hoisted(() => ({
  value: { userId: 8, username: 'author' } as { userId: number; username: string } | null,
}));
vi.mock('@/lib/dal', () => ({
  getOptionalSession: async () => currentSession.value,
}));

const { GET } = await import('./route');

function get(params: Record<string, string>): Promise<Response> {
  const url = new URL('http://localhost/api/posts/search');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return GET(new NextRequest(url));
}

function seedPost({
  slug,
  title,
  draft,
  authorId,
}: {
  slug: string;
  title: string;
  draft: boolean;
  authorId: number | null;
}): number {
  return db
    .insert(posts)
    .values({
      slug,
      title,
      date: draft ? '' : '2026-01-01',
      category: 'tech',
      tags: [],
      draft,
      body: 'Body',
      thumbnail: '',
      kind: 'post',
      authorId,
    })
    .returning({ id: posts.id })
    .get().id;
}

beforeEach(() => {
  db.delete(posts).run();
  db.delete(users).run();
  currentSession.value = { userId: 8, username: 'author' };

  db.insert(users)
    .values([
      { id: 1, username: 'admin', passwordHash: 'dummy', role: 'admin' },
      { id: 8, username: 'author', passwordHash: 'dummy', role: 'author' },
      { id: 99, username: 'other', passwordHash: 'dummy', role: 'author' },
    ])
    .run();
});

// docs/multi-author-requirements.md §7 row 7.
describe('GET /api/posts/search and draft ownership', () => {
  it('returns published posts and own drafts, but never another author’s draft', async () => {
    seedPost({ slug: 'own-draft', title: 'Own Draft Post', draft: true, authorId: 8 });
    seedPost({ slug: 'other-draft', title: 'Other Draft Post', draft: true, authorId: 99 });
    seedPost({ slug: 'published-post', title: 'Published Post', draft: false, authorId: 99 });

    // Search query
    const res = await get({ q: 'Post' });
    expect(res.status).toBe(200);
    const results = (await res.json()) as PostSearchResult[];
    const slugs = results.map((r) => r.slug);

    expect(slugs).toContain('own-draft');
    expect(slugs).toContain('published-post');
    expect(slugs).not.toContain('other-draft');

    // Slug lookup for own draft succeeds
    const ownLookup = await get({ slug: 'own-draft' });
    expect(ownLookup.status).toBe(200);
    expect(((await ownLookup.json()) as PostSearchResult).slug).toBe('own-draft');

    // Slug lookup for another's published post succeeds
    const pubLookup = await get({ slug: 'published-post' });
    expect(pubLookup.status).toBe(200);
    expect(((await pubLookup.json()) as PostSearchResult).slug).toBe('published-post');

    // Slug lookup for another's draft returns 404
    const otherDraftLookup = await get({ slug: 'other-draft' });
    expect(otherDraftLookup.status).toBe(404);
  });

  it('applies the same rule to admin accounts', async () => {
    currentSession.value = { userId: 1, username: 'admin' };

    seedPost({ slug: 'admin-draft', title: 'Admin Draft', draft: true, authorId: 1 });
    seedPost({ slug: 'author-draft', title: 'Author Draft', draft: true, authorId: 8 });
    seedPost({ slug: 'published-post', title: 'Published Post', draft: false, authorId: 8 });

    const res = await get({ q: '' });
    expect(res.status).toBe(200);
    const results = (await res.json()) as PostSearchResult[];
    const slugs = results.map((r) => r.slug);

    expect(slugs).toContain('admin-draft');
    expect(slugs).toContain('published-post');
    expect(slugs).not.toContain('author-draft');

    const otherDraftLookup = await get({ slug: 'author-draft' });
    expect(otherDraftLookup.status).toBe(404);
  });

  it('excludes published posts by suspended authors from search and slug lookup', async () => {
    seedPost({
      slug: 'active-author-post',
      title: 'Active Author Post',
      draft: false,
      authorId: 8,
    });
    seedPost({
      slug: 'suspended-author-post',
      title: 'Suspended Author Post',
      draft: false,
      authorId: 99,
    });
    seedPost({ slug: 'orphan-post', title: 'Orphan Post', draft: false, authorId: null });

    db.update(users).set({ suspendedAt: '2026-10-17T12:00:00.000Z' }).where(eq(users.id, 99)).run();

    const res = await get({ q: 'Post' });
    expect(res.status).toBe(200);
    const results = (await res.json()) as PostSearchResult[];
    const slugs = results.map((r) => r.slug);

    expect(slugs).toContain('active-author-post');
    expect(slugs).toContain('orphan-post');
    expect(slugs).not.toContain('suspended-author-post');

    const suspendedLookup = await get({ slug: 'suspended-author-post' });
    expect(suspendedLookup.status).toBe(404);

    const orphanLookup = await get({ slug: 'orphan-post' });
    expect(orphanLookup.status).toBe(200);

    // Un-suspend author and verify the post returns
    db.update(users).set({ suspendedAt: null }).where(eq(users.id, 99)).run();

    const restoredRes = await get({ q: 'Post' });
    const restoredResults = (await restoredRes.json()) as PostSearchResult[];
    expect(restoredResults.map((r) => r.slug)).toContain('suspended-author-post');

    const restoredLookup = await get({ slug: 'suspended-author-post' });
    expect(restoredLookup.status).toBe(200);
  });

  it('returns 401 when no session exists', async () => {
    currentSession.value = null;
    const res = await get({ q: 'test' });
    expect(res.status).toBe(401);
  });
});

// docs/embed-requirements.md §24.9: the insert dialog's 自分の記事 / 全記事 tabs.
describe('GET /api/posts/search with the own-posts scope', () => {
  it('narrows the search to the signed-in user’s posts, drafts included', async () => {
    seedPost({ slug: 'own-published', title: 'Own Published', draft: false, authorId: 8 });
    seedPost({ slug: 'own-draft', title: 'Own Draft', draft: true, authorId: 8 });
    seedPost({ slug: 'other-published', title: 'Other Published', draft: false, authorId: 99 });
    seedPost({ slug: 'orphan', title: 'Orphan', draft: false, authorId: null });

    const mine = (await (
      await get({ q: '', scope: OWN_POSTS_SCOPE })
    ).json()) as PostSearchResult[];
    expect(mine.map((r) => r.slug).sort()).toEqual(['own-draft', 'own-published']);

    const all = (await (await get({ q: '' })).json()) as PostSearchResult[];
    expect(all.map((r) => r.slug).sort()).toEqual([
      'orphan',
      'other-published',
      'own-draft',
      'own-published',
    ]);
  });

  it('filters before the result limit, so other authors’ posts cannot crowd out the user’s own', async () => {
    for (let i = 0; i < 30; i++) {
      seedPost({ slug: `other-${i}`, title: `Other ${i}`, draft: false, authorId: 99 });
    }
    seedPost({ slug: 'own-published', title: 'Own Published', draft: false, authorId: 8 });

    const mine = (await (
      await get({ q: '', scope: OWN_POSTS_SCOPE })
    ).json()) as PostSearchResult[];
    expect(mine.map((r) => r.slug)).toEqual(['own-published']);
  });

  it('leaves the slug lookup unscoped', async () => {
    seedPost({ slug: 'other-published', title: 'Other Published', draft: false, authorId: 99 });
    const res = await get({ slug: 'other-published', scope: OWN_POSTS_SCOPE });
    expect(res.status).toBe(200);
  });
});
