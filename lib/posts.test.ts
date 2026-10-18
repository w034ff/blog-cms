import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { posts, tags, users } from '@/lib/db/schema';
import { db } from '@/lib/db';
import {
  getAllCategories,
  getAllPosts,
  getAllTags,
  getPostBySlug,
  getDraftBySlug,
  getPostForEdit,
  getPostsByCategory,
  getPostsByTag,
  getSearchablePosts,
  getScribbleBySlug,
  getScribbleDraftBySlug,
  getScribbles,
  countScribbles,
  listAllPosts,
  listAllScribbles,
} from '@/lib/posts';
import type { PostKind } from '@/lib/content';
import type { DraftContent } from '@/lib/types';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

beforeEach(() => {
  db.delete(posts).run();
  db.delete(tags).run();
  db.delete(users).run();
});

// Posts hold dictionary slugs and a slug the dictionary lacks is dropped on read, so every tag a
// seeded row carries is admitted first, named after itself — except where a test says otherwise.
function admit(slugs: readonly string[]): void {
  for (const slug of slugs) {
    db.insert(tags).values({ slug, name: slug }).onConflictDoNothing().run();
  }
}

type SeedOptions = {
  slug?: string | null;
  title?: string;
  date?: string;
  category?: string;
  tags?: string[];
  draft?: boolean;
  body?: string;
  draftContent?: DraftContent | null;
  unlisted?: boolean;
  kind?: PostKind;
  authorId?: number | null;
};

function seed(options: SeedOptions = {}): number {
  admit([...(options.tags ?? []), ...(options.draftContent?.tags ?? [])]);
  return db
    .insert(posts)
    .values({
      slug: options.slug ?? null,
      title: options.title ?? 'Title',
      date: options.date ?? '2026-01-01',
      description: '',
      category: options.category ?? 'tech',
      tags: options.tags ?? [],
      draft: options.draft ?? false,
      body: options.body ?? '',
      draftContent: options.draftContent ?? null,
      unlisted: options.unlisted ?? false,
      kind: options.kind ?? 'post',
      authorId: options.authorId ?? null,
    })
    .returning({ id: posts.id })
    .get().id;
}

// The live columns of the rows seeded below, in the shape the working copy is stored in. A copy of
// this is a published post's own content parked in draft_content, which is what the race produces.
const LIVE_CONTENT: DraftContent = {
  title: 'Live',
  category: 'blog',
  tags: ['x'],
  thumbnail: '',
  body: 'live body',
};

describe('getAllPosts', () => {
  it('returns only published posts, newest first', async () => {
    seed({ slug: 'old', date: '2026-01-01' });
    seed({ slug: 'new', date: '2026-03-03' });
    seed({ slug: 'mid', date: '2026-02-02' });
    seed({ slug: 'draft', date: '2026-04-04', draft: true });

    const result = await getAllPosts();
    expect(result.map((p) => p.slug)).toEqual(['new', 'mid', 'old']);
  });

  it('excludes unlisted posts', async () => {
    seed({ slug: 'public', date: '2026-01-01' });
    seed({ slug: 'hidden', date: '2026-02-02', unlisted: true });
    const result = await getAllPosts();
    expect(result.map((p) => p.slug)).toEqual(['public']);
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

  it('returns an unlisted post by its direct slug (excluded from listings only)', async () => {
    seed({ slug: 'secret', title: 'Secret', unlisted: true });
    expect((await getPostBySlug('secret'))?.title).toBe('Secret');
  });
});

describe('getDraftBySlug', () => {
  it('returns a draft', async () => {
    seed({ slug: 'wip', title: 'WIP', draft: true });
    expect((await getDraftBySlug('wip'))?.title).toBe('WIP');
  });

  // The pair is what makes the preview gate expressible: one function answers for published
  // posts, the other only for drafts, and neither can stand in for the other.
  it('returns null for a published post', async () => {
    seed({ slug: 'live', draft: false });
    expect(await getDraftBySlug('live')).toBeNull();
  });

  it('returns null for an unlisted post (published, not a draft)', async () => {
    seed({ slug: 'secret', unlisted: true });
    expect(await getDraftBySlug('secret')).toBeNull();
  });

  it('returns null for a missing slug', async () => {
    expect(await getDraftBySlug('nope')).toBeNull();
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

  it('includes unlisted posts', async () => {
    seed({ slug: 'a', unlisted: true });
    const result = await listAllPosts();
    expect(result).toHaveLength(1);
    expect(result[0].unlisted).toBe(true);
  });

  // The badge's source. A published row with a working copy is carrying edits readers cannot see;
  // one without is current. Nothing else distinguishes the two rows.
  it('flags a published post that is carrying unpublished edits', async () => {
    const working: DraftContent = {
      title: 'Newer',
      category: 'blog',
      tags: [],
      thumbnail: '',
      body: 'newer body',
    };
    seed({ slug: 'pending', date: '2026-02-02', draftContent: working });
    seed({ slug: 'current', date: '2026-01-01' });
    const [pending, current] = await listAllPosts();
    expect(pending.hasPendingEdits).toBe(true);
    expect(current.hasPendingEdits).toBe(false);
  });

  // The publish/autosave race: `commitPost` clears draft_content, and an autosave already in
  // flight writes it straight back. Both carry the same form content, so the row that lands holds
  // a working copy identical to what was just published — a badge with nothing behind it, which
  // the author could only clear by publishing again.
  it('does not flag a working copy identical to the live columns', async () => {
    seed({
      slug: 'raced',
      title: 'Live',
      category: 'blog',
      tags: ['x'],
      body: 'live body',
      draftContent: { ...LIVE_CONTENT },
    });
    const [raced] = await listAllPosts();
    expect(raced.draft).toBe(false);
    expect(raced.hasPendingEdits).toBe(false);
  });

  // One row per DraftContent field: the badge has to answer for all of them, and a field left out
  // of the comparison would make the post silently publishable-looking while carrying an edit.
  const fieldEdits: [string, Partial<DraftContent>][] = [
    ['title', { title: 'Renamed' }],
    ['category', { category: 'tech' }],
    ['body', { body: 'new body' }],
    ['thumbnail', { thumbnail: '/uploads/a.png' }],
    ['tags (changed)', { tags: ['y'] }],
    ['tags (added)', { tags: ['x', 'y'] }],
    ['tags (removed)', { tags: [] }],
    ['tags (reordered)', { tags: ['y', 'x'] }],
  ];
  for (const [field, edit] of fieldEdits) {
    it(`flags a working copy that differs in ${field}`, async () => {
      seed({
        slug: 'edited',
        title: 'Live',
        category: 'blog',
        tags: ['x'],
        body: 'live body',
        draftContent: { ...LIVE_CONTENT, ...edit },
      });
      const [edited] = await listAllPosts();
      expect(edited.hasPendingEdits).toBe(true);
    });
  }

  // A working copy stashed before a field existed reads back undefined (see getPostForEdit below).
  // Normalized before the comparison, it matches the live columns — unnormalized, `undefined !== ''`
  // would have badged every such row as carrying edits it does not have.
  it('does not flag a working copy that merely predates a field', async () => {
    const legacy = {
      title: 'Live',
      category: 'blog',
      tags: ['x'],
      body: 'live body',
    } as DraftContent;
    seed({
      slug: 'legacy',
      title: 'Live',
      category: 'blog',
      tags: ['x'],
      body: 'live body',
      draftContent: legacy,
    });
    const [row] = await listAllPosts();
    expect(row.hasPendingEdits).toBe(false);
  });

  // The reverse of the case above: a working copy stashed before 2026-09-21 carries keys the type
  // no longer has — the description field (docs/cms-features.md「説明文の自動抽出」) and 限定公開
  // (「非公開限定URL投稿」). They must be ignored, not read as an edit.
  it('does not flag a working copy that carries retired keys', async () => {
    const stale = {
      title: 'Live',
      description: 'old summary',
      category: 'blog',
      tags: ['x'],
      body: 'live body',
      thumbnail: '',
      unlisted: true,
    } as unknown as DraftContent;
    seed({
      slug: 'stale',
      title: 'Live',
      category: 'blog',
      tags: ['x'],
      body: 'live body',
      draftContent: stale,
    });
    const [row] = await listAllPosts();
    expect(row.hasPendingEdits).toBe(false);
  });

  it('joins author info from users table and returns author: null when authorId is null', async () => {
    db.insert(users)
      .values({
        id: 10,
        username: 'alice',
        displayName: 'Alice Cooper',
        role: 'author',
      })
      .run();
    seed({ slug: 'with-author', authorId: 10, date: '2026-03-02' });
    seed({ slug: 'no-author', authorId: null, date: '2026-03-01' });

    const rows = await listAllPosts();
    expect(rows).toHaveLength(2);
    expect(rows[0].slug).toBe('with-author');
    expect(rows[0].authorId).toBe(10);
    expect(rows[0].author).toEqual({ displayName: 'Alice Cooper', username: 'alice' });
    expect(rows[1].slug).toBe('no-author');
    expect(rows[1].authorId).toBeNull();
    expect(rows[1].author).toBeNull();
  });

  it('filters by authorId while preserving author info', async () => {
    db.insert(users)
      .values({
        id: 11,
        username: 'bob',
        displayName: 'Bob Dylan',
        role: 'author',
      })
      .run();
    db.insert(users)
      .values({
        id: 12,
        username: 'charlie',
        displayName: 'Charlie Parker',
        role: 'author',
      })
      .run();
    seed({ slug: 'bob-post', authorId: 11, date: '2026-03-01' });
    seed({ slug: 'charlie-post', authorId: 12, date: '2026-03-02' });

    const bobRows = await listAllPosts(11);
    expect(bobRows).toHaveLength(1);
    expect(bobRows[0].slug).toBe('bob-post');
    expect(bobRows[0].author).toEqual({ displayName: 'Bob Dylan', username: 'bob' });
  });
});

describe('getPostForEdit', () => {
  it('returns the pending working copy when present', async () => {
    const pending: DraftContent = {
      title: 'Pending',
      category: 'blog',
      tags: ['x'],
      thumbnail: '',
      body: 'pending body',
    };
    const id = seed({ slug: 'p', draft: false, draftContent: pending });
    expect((await getPostForEdit(id))?.draftContent?.title).toBe('Pending');
  });

  it('fills in a field a working copy predates', async () => {
    // `draft_content` is JSON and its type is an assertion, not a check: every row stashed before
    // `thumbnail` existed is missing the key, and the editor read `undefined` as "an image was
    // chosen" — the field showed 「なし」 next to a label saying the opposite, and the body fallback
    // never ran. Cast because the whole point is a stored value that does not match the type.
    const legacy = {
      title: 'Pending',
      category: 'blog',
      tags: ['x'],
      body: 'pending body',
    } as DraftContent;
    const id = seed({ slug: 'p', draft: false, draftContent: legacy });
    expect((await getPostForEdit(id))?.draftContent?.thumbnail).toBe('');
  });

  it('returns null draftContent when there are no pending edits', async () => {
    const id = seed({ slug: 'p' });
    expect((await getPostForEdit(id))?.draftContent).toBeNull();
  });

  // The editor reads the same derived flag the admin list does, rather than deriving its own from
  // draftContent — the two screens disagreeing about one post is the failure this closes.
  it('reports hasPendingEdits from the content, not from the column', async () => {
    const raced = seed({
      slug: 'r',
      title: 'Live',
      category: 'blog',
      tags: ['x'],
      body: 'live body',
      draftContent: { ...LIVE_CONTENT },
    });
    const edited = seed({
      slug: 'e',
      title: 'Live',
      category: 'blog',
      tags: ['x'],
      body: 'live body',
      draftContent: { ...LIVE_CONTENT, body: 'new body' },
    });
    expect((await getPostForEdit(raced))?.hasPendingEdits).toBe(false);
    expect((await getPostForEdit(edited))?.hasPendingEdits).toBe(true);
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
    seed({ slug: 'b', category: 'blog' });
    seed({ slug: 'c', category: 'tech', draft: true });
    const result = await getPostsByCategory('tech');
    expect(result.map((p) => p.slug)).toEqual(['a']);
  });

  it('excludes unlisted posts from the tag and category listings', async () => {
    seed({ slug: 'a', category: 'tech', tags: ['ts'] });
    seed({ slug: 'hidden', category: 'tech', tags: ['ts'], unlisted: true });
    expect((await getPostsByCategory('tech')).map((p) => p.slug)).toEqual(['a']);
    expect((await getPostsByTag('ts')).map((p) => p.slug)).toEqual(['a']);
  });
});

describe('getAllTags / getAllCategories', () => {
  it('reads tags by their dictionary names and drops a slug the dictionary lacks', async () => {
    seed({ slug: 'a', tags: ['nextjs', 'gone'] });
    db.update(tags).set({ name: 'Next.js' }).where(eq(tags.slug, 'nextjs')).run();
    db.delete(tags).where(eq(tags.slug, 'gone')).run();
    const [post] = await getAllPosts();
    expect(post.tags).toEqual(['nextjs']);
    expect(post.tagList).toEqual([{ slug: 'nextjs', name: 'Next.js' }]);
    expect(await getAllTags()).toEqual([{ slug: 'nextjs', name: 'Next.js', count: 1 }]);
  });

  it('counts tags across published posts, sorted by count then name', async () => {
    seed({ slug: 'a', tags: ['ts', 'db'] });
    seed({ slug: 'b', tags: ['ts'] });
    seed({ slug: 'c', tags: ['secret'], draft: true });
    expect(await getAllTags()).toEqual([
      { slug: 'ts', name: 'ts', count: 2 },
      { slug: 'db', name: 'db', count: 1 },
    ]);
  });

  it('counts categories across published posts only, in the list order', async () => {
    seed({ slug: 'a', category: 'blog' });
    seed({ slug: 'b', category: 'blog' });
    seed({ slug: 'c', category: 'tech' });
    seed({ slug: 'd', category: 'tech', draft: true });
    expect(await getAllCategories()).toEqual([
      { category: 'tech', count: 1 },
      { category: 'blog', count: 2 },
    ]);
  });

  it('leaves out a category with no published post', async () => {
    seed({ slug: 'a', category: 'blog' });
    seed({ slug: 'b', category: 'tech', draft: true });
    expect(await getAllCategories()).toEqual([{ category: 'blog', count: 1 }]);
  });

  // A value the migration did not reach (drizzle/0008) must not print raw or link to a category
  // page that 404s. It reads as not chosen (§12.32), and a published post in that state is left
  // out of every category's count.
  it('reads a category off the list as not chosen', async () => {
    seed({ slug: 'a', category: 'tech-notes' });
    expect((await getAllPosts())[0].category).toBe('');
    expect(await getAllCategories()).toEqual([]);
  });
});

// docs/scribble-requirements.md §4 and §8 row 2: every read is scoped to one kind, so a published
// scribble never reaches the blog's surfaces and a post never reaches the scribble timeline.
describe('kinds', () => {
  function seedBoth(): void {
    seed({ slug: 'p', title: 'Post', tags: ['shared'], category: 'tech' });
    seed({ slug: 's', title: 'Scribble', tags: ['shared'], category: '', kind: 'scribble' });
    seed({ slug: 'pd', title: 'Post draft', draft: true });
    seed({ slug: 'sd', title: 'Scribble draft', draft: true, kind: 'scribble' });
  }

  it('keeps scribbles out of every read the blog makes', async () => {
    seedBoth();
    expect((await getAllPosts()).map((post) => post.slug)).toEqual(['p']);
    expect((await getPostsByTag('shared')).map((post) => post.slug)).toEqual(['p']);
    expect((await getPostsByCategory('tech')).map((post) => post.slug)).toEqual(['p']);
    expect((await getAllTags()).map((tag) => [tag.slug, tag.count])).toEqual([['shared', 1]]);
    expect(await getAllCategories()).toEqual([{ category: 'tech', count: 1 }]);
    expect((await listAllPosts()).map((post) => post.slug).sort()).toEqual(['p', 'pd']);
  });

  // §8 row 10: a link card asks getPostBySlug, so a scribble answers as an unknown slug does.
  it('answers a scribble slug on the post side as an unknown one', async () => {
    seedBoth();
    expect(await getPostBySlug('s')).toBeNull();
    expect(await getDraftBySlug('sd')).toBeNull();
    expect(await getPostBySlug('p')).not.toBeNull();
  });

  it('reads only scribbles on the scribble side', async () => {
    seedBoth();
    expect((await getScribbles()).map((post) => post.slug)).toEqual(['s']);
    expect(await countScribbles()).toBe(1);
    expect((await listAllScribbles()).map((post) => post.slug).sort()).toEqual(['s', 'sd']);
    expect(await getScribbleBySlug('p')).toBeNull();
    expect(await getScribbleBySlug('sd')).toBeNull();
    expect((await getScribbleBySlug('s'))?.kind).toBe('scribble');
    expect(await getScribbleDraftBySlug('pd')).toBeNull();
    expect((await getScribbleDraftBySlug('sd'))?.title).toBe('Scribble draft');
  });

  it('leaves an unlisted scribble off the timeline', async () => {
    seed({ slug: 'u', kind: 'scribble', unlisted: true });
    expect(await getScribbles()).toEqual([]);
    expect(await countScribbles()).toBe(0);
  });

  it('pages the timeline newest first without repeating a row on a tie', async () => {
    seed({ slug: 'a', kind: 'scribble', date: '2026-10-01' });
    seed({ slug: 'b', kind: 'scribble', date: '2026-10-03' });
    seed({ slug: 'c', kind: 'scribble', date: '2026-10-03' });
    const first = await getScribbles({ limit: 2 });
    const second = await getScribbles({ limit: 2, offset: 2 });
    expect([...first, ...second].map((post) => post.slug)).toEqual(['c', 'b', 'a']);
  });
});

// docs/multi-author-requirements.md §7 row 9.
describe('suspended authors on public surfaces (lib/posts)', () => {
  function seedUser(id: number, username: string, suspendedAt: string | null = null): void {
    db.insert(users)
      .values({
        id,
        username,
        passwordHash: 'dummy',
        role: 'author',
        suspendedAt,
      })
      .run();
  }

  it('excludes posts by suspended authors from all public reads and restores them when unsuspended', async () => {
    seedUser(1, 'active', null);
    seedUser(2, 'suspended', '2026-10-17T12:00:00.000Z');

    seed({
      slug: 'active-post',
      title: 'Active Post',
      category: 'tech',
      tags: ['active-tag'],
      authorId: 1,
    });
    seed({
      slug: 'suspended-post',
      title: 'Suspended Post',
      category: 'blog',
      tags: ['suspended-tag'],
      authorId: 2,
    });
    seed({
      slug: 'orphan-post',
      title: 'Orphan Post',
      category: 'tech',
      tags: ['orphan-tag'],
      authorId: null,
    });

    seed({
      slug: 'active-scribble',
      title: 'Active Scribble',
      kind: 'scribble',
      authorId: 1,
    });
    seed({
      slug: 'suspended-scribble',
      title: 'Suspended Scribble',
      kind: 'scribble',
      authorId: 2,
    });
    seed({
      slug: 'orphan-scribble',
      title: 'Orphan Scribble',
      kind: 'scribble',
      authorId: null,
    });

    // 1. getAllPosts
    expect((await getAllPosts()).map((p) => p.slug)).toEqual(['orphan-post', 'active-post']);

    // 2. getSearchablePosts
    expect((await getSearchablePosts()).map((p) => p.slug)).toEqual([
      'orphan-scribble',
      'active-scribble',
      'orphan-post',
      'active-post',
    ]);

    // 3. getPostBySlug
    expect(await getPostBySlug('active-post')).not.toBeNull();
    expect(await getPostBySlug('orphan-post')).not.toBeNull();
    expect(await getPostBySlug('suspended-post')).toBeNull();

    // 4. getScribbles
    expect((await getScribbles()).map((p) => p.slug)).toEqual([
      'orphan-scribble',
      'active-scribble',
    ]);

    // 5. countScribbles
    expect(await countScribbles()).toBe(2);

    // 6. getScribbleBySlug
    expect(await getScribbleBySlug('active-scribble')).not.toBeNull();
    expect(await getScribbleBySlug('orphan-scribble')).not.toBeNull();
    expect(await getScribbleBySlug('suspended-scribble')).toBeNull();

    // 7. getAllTags
    const tagSlugs = (await getAllTags()).map((t) => t.slug);
    expect(tagSlugs).toContain('active-tag');
    expect(tagSlugs).toContain('orphan-tag');
    expect(tagSlugs).not.toContain('suspended-tag');

    // 8. getAllCategories
    const categories = await getAllCategories();
    expect(categories.find((c) => c.category === 'tech')?.count).toBe(2);
    expect(categories.find((c) => c.category === 'blog')).toBeUndefined();

    // Un-suspend author 2 and verify everything is restored
    db.update(users).set({ suspendedAt: null }).where(eq(users.id, 2)).run();

    expect((await getAllPosts()).map((p) => p.slug)).toEqual([
      'orphan-post',
      'suspended-post',
      'active-post',
    ]);
    expect((await getSearchablePosts()).map((p) => p.slug)).toEqual([
      'orphan-scribble',
      'suspended-scribble',
      'active-scribble',
      'orphan-post',
      'suspended-post',
      'active-post',
    ]);
    expect(await getPostBySlug('suspended-post')).not.toBeNull();
    expect((await getScribbles()).map((p) => p.slug)).toEqual([
      'orphan-scribble',
      'suspended-scribble',
      'active-scribble',
    ]);
    expect(await countScribbles()).toBe(3);
    expect(await getScribbleBySlug('suspended-scribble')).not.toBeNull();
    expect((await getAllTags()).map((t) => t.slug)).toContain('suspended-tag');
    expect((await getAllCategories()).find((c) => c.category === 'blog')?.count).toBe(1);
  });
});
