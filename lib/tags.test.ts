import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { postRevisions, posts, tags } from '@/lib/db/schema';
import { db } from '@/lib/db';
import {
  changeTagSlug,
  createTag,
  deleteTag,
  knownTagSlugs,
  listTags,
  renameTag,
  resolveTags,
  tagUsage,
} from '@/lib/tags';
import { TAG_SYMBOL_MESSAGE } from '@/lib/content';
import type { DraftContent } from '@/lib/types';

// docs/editor-requirements.md §12.33. Backed by the real migrations in an in-memory DB.
vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

beforeEach(() => {
  db.delete(postRevisions).run();
  db.delete(posts).run();
  db.delete(tags).run();
});

function content(tagSlugs: string[]): DraftContent {
  return { title: 'T', category: 'tech', tags: tagSlugs, thumbnail: '', body: 'b' };
}

function seedPost(live: string[], copy: string[] | null = null): number {
  return db
    .insert(posts)
    .values({
      slug: `s-${Math.random()}`,
      title: 'T',
      date: '2026-01-01',
      tags: live,
      draftContent: copy === null ? null : content(copy),
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    .returning({ id: posts.id })
    .get().id;
}

describe('createTag', () => {
  it('admits a name under its lowercased slug', () => {
    expect(createTag('  NextJS ')).toEqual({
      ok: true,
      tag: { slug: 'nextjs', name: 'nextjs' },
      created: true,
    });
  });

  // The reason the dictionary exists: a second spelling of a tag it has is that tag.
  it('hands back the tag a differently-cased name resolves to, without adding one', () => {
    createTag('nextjs');
    expect(createTag('NEXTJS')).toEqual({
      ok: true,
      tag: { slug: 'nextjs', name: 'nextjs' },
      created: false,
    });
    expect(listTags()).toHaveLength(1);
  });

  it.each([
    ['', 'タグ名を入力してください。'],
    ['   ', 'タグ名を入力してください。'],
    ['Next.js', TAG_SYMBOL_MESSAGE],
    ['React Server Components', TAG_SYMBOL_MESSAGE],
    ['C#', TAG_SYMBOL_MESSAGE],
    ['x'.repeat(41), 'タグ名は 40 文字までです。'],
  ])('refuses %j', (name, error) => {
    expect(createTag(name)).toEqual({ ok: false, error });
    expect(listTags()).toEqual([]);
  });
});

describe('renameTag', () => {
  it('changes the name and keeps the slug', () => {
    createTag('nextjs');
    expect(renameTag('nextjs', 'Next.js')).toEqual({
      ok: true,
      tag: { slug: 'nextjs', name: 'Next.js' },
      created: false,
    });
    expect(listTags()).toEqual([{ slug: 'nextjs', name: 'Next.js' }]);
  });

  it('refuses a name another tag already has', () => {
    createTag('React');
    createTag('Vue');
    expect(renameTag('vue', 'React')).toEqual({
      ok: false,
      error: '「React」という名前のタグは既にあります。',
    });
  });

  // Display names may carry symbols; what they may not do is read as another tag.
  it.each([['REACT'], ['Re.act']])(
    'refuses %j, which the editor would read as the tag react',
    (name) => {
      createTag('react');
      createTag('Vue');
      expect(renameTag('vue', name)).toEqual({
        ok: false,
        error: `「${name}」という名前のタグは既にあります。`,
      });
    },
  );

  it('allows a rename that only changes its own case', () => {
    createTag('nextjs');
    expect(renameTag('nextjs', 'NextJS').ok).toBe(true);
  });

  it('refuses a tag that is not there', () => {
    expect(renameTag('missing', 'x')).toEqual({ ok: false, error: 'タグが見つかりません。' });
  });
});

describe('deleteTag', () => {
  it('takes the tag off the live column, the working copy and the revisions', () => {
    createTag('a');
    createTag('b');
    const id = seedPost(['a', 'b'], ['b', 'a']);
    db.insert(postRevisions)
      .values({ postId: id, createdAt: 1, reason: 'publish', content: content(['a', 'b']) })
      .run();

    expect(deleteTag('a')).toBe(true);

    const row = db.select().from(posts).where(eq(posts.id, id)).get();
    expect(row?.tags).toEqual(['b']);
    expect(row?.draftContent?.tags).toEqual(['b']);
    const [revision] = db.select().from(postRevisions).all();
    expect(revision.content).toEqual(content(['b']));
    expect(listTags()).toEqual([{ slug: 'b', name: 'b' }]);
  });

  // Not an edit the author made: a changed `updatedAt` would print 更新 on the post, and a revision
  // would fill the history with versions nobody saved.
  it('leaves updatedAt and the revision count alone, and posts without the tag untouched', () => {
    createTag('a');
    const holder = seedPost(['a']);
    const other = seedPost(['z']);
    deleteTag('a');
    const rows = db.select().from(posts).all();
    expect(rows.map((row) => row.updatedAt)).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
    expect(rows.find((row) => row.id === other)?.tags).toEqual(['z']);
    expect(rows.find((row) => row.id === holder)?.draftContent).toBeNull();
    expect(db.select().from(postRevisions).all()).toEqual([]);
  });

  it('reports a tag that is not there', () => {
    expect(deleteTag('missing')).toBe(false);
  });
});

describe('changeTagSlug', () => {
  function revision(postId: number, tagSlugs: string[]): void {
    db.insert(postRevisions)
      .values({ postId, createdAt: 1, reason: 'publish', content: content(tagSlugs) })
      .run();
  }

  it('moves a tag to a new identifier in all three places, its untouched name with it', () => {
    createTag('nextj');
    const id = seedPost(['nextj', 'b'], ['b', 'nextj']);
    revision(id, ['nextj']);

    expect(changeTagSlug('nextj', 'NextJS')).toEqual({ ok: true, slug: 'nextjs', merged: false });

    const row = db.select().from(posts).where(eq(posts.id, id)).get();
    expect(row?.tags).toEqual(['nextjs', 'b']);
    expect(row?.draftContent?.tags).toEqual(['b', 'nextjs']);
    expect(db.select().from(postRevisions).get()?.content.tags).toEqual(['nextjs']);
    expect(listTags()).toEqual([{ slug: 'nextjs', name: 'nextjs' }]);
  });

  it('keeps a display name that was changed', () => {
    createTag('nextj');
    renameTag('nextj', 'Next.js');
    changeTagSlug('nextj', 'nextjs');
    expect(listTags()).toEqual([{ slug: 'nextjs', name: 'Next.js' }]);
  });

  // Two spellings that both made it into the dictionary become one.
  it('merges into an identifier that is already a tag, once per post', () => {
    createTag('next');
    createTag('nextjs');
    const both = seedPost(['next', 'nextjs'], ['nextjs', 'next']);
    const one = seedPost(['next']);
    revision(both, ['next', 'nextjs']);

    expect(changeTagSlug('next', 'nextjs')).toEqual({ ok: true, slug: 'nextjs', merged: true });

    const rows = db.select().from(posts).all();
    expect(rows.find((row) => row.id === both)?.tags).toEqual(['nextjs']);
    expect(rows.find((row) => row.id === both)?.draftContent?.tags).toEqual(['nextjs']);
    expect(rows.find((row) => row.id === one)?.tags).toEqual(['nextjs']);
    expect(db.select().from(postRevisions).get()?.content.tags).toEqual(['nextjs']);
    expect(listTags()).toEqual([{ slug: 'nextjs', name: 'nextjs' }]);
  });

  it('leaves updatedAt alone', () => {
    createTag('a');
    seedPost(['a']);
    changeTagSlug('a', 'b');
    expect(db.select().from(posts).get()?.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it.each([
    ['C#', TAG_SYMBOL_MESSAGE],
    ['a'.repeat(19), 'タグは 18 文字まで入力できます。'],
    ['A', '識別子が同じです。'],
  ])('refuses %j and changes nothing', (to, error) => {
    createTag('a');
    const id = seedPost(['a']);
    expect(changeTagSlug('a', to)).toEqual({ ok: false, error });
    expect(db.select().from(posts).where(eq(posts.id, id)).get()?.tags).toEqual(['a']);
  });

  it('refuses a tag that is not there', () => {
    expect(changeTagSlug('missing', 'x')).toEqual({ ok: false, error: 'タグが見つかりません。' });
  });
});

describe('knownTagSlugs / resolveTags / tagUsage', () => {
  it('keeps only dictionary slugs, once each, in order', () => {
    createTag('a');
    createTag('b');
    expect(knownTagSlugs(['b', 'x', 'a', 'b'])).toEqual(['b', 'a']);
    expect(resolveTags(['b', 'x', 'a'])).toEqual([
      { slug: 'b', name: 'b' },
      { slug: 'a', name: 'a' },
    ]);
  });

  it('counts a post once whether the live column, the working copy or both hold the tag', () => {
    seedPost(['a'], ['a', 'b']);
    seedPost([], ['b']);
    seedPost(['a']);
    expect(tagUsage()).toEqual(
      new Map([
        ['a', 2],
        ['b', 2],
      ]),
    );
  });
});
