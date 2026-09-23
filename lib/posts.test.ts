import { beforeEach, describe, expect, it, vi } from 'vitest';
import { posts } from '@/lib/db/schema';
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
  listAllPosts,
} from '@/lib/posts';
import { DEFAULT_CATEGORY } from '@/lib/content';
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
  unlisted?: boolean;
};

function seed(options: SeedOptions = {}): number {
  return db
    .insert(posts)
    .values({
      slug: options.slug ?? null,
      title: options.title ?? 'Title',
      date: options.date ?? '2026-01-01',
      description: '',
      category: options.category ?? DEFAULT_CATEGORY,
      tags: options.tags ?? [],
      draft: options.draft ?? false,
      body: options.body ?? '',
      draftContent: options.draftContent ?? null,
      unlisted: options.unlisted ?? false,
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
  it('counts tags across published posts, sorted by count then name', async () => {
    seed({ slug: 'a', tags: ['ts', 'db'] });
    seed({ slug: 'b', tags: ['ts'] });
    seed({ slug: 'c', tags: ['secret'], draft: true });
    expect(await getAllTags()).toEqual([
      { tag: 'ts', count: 2 },
      { tag: 'db', count: 1 },
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

  // A value the migration did not reach (drizzle/0008) still has to read as one of the ids, or it
  // would print raw and link to a category page that 404s.
  it('reads a category off the list as the default', async () => {
    seed({ slug: 'a', category: 'tech-notes' });
    expect((await getAllPosts())[0].category).toBe(DEFAULT_CATEGORY);
  });
});
