import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { posts, tags } from '@/lib/db/schema';
import { getSearchablePosts } from '@/lib/posts';
import {
  buildSnippet,
  clearVisibleTextCache,
  extractVisibleText,
  getVisibleTexts,
  parseSearchTerms,
  searchPosts,
  splitMarks,
  SEARCH_MAX_CHARS,
  type CacheEntry,
} from './search';
import type { DraftContent, Post } from '@/lib/types';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

beforeEach(() => {
  db.delete(posts).run();
  db.delete(tags).run();
  clearVisibleTextCache();
});

type SeedOptions = {
  slug?: string;
  title?: string;
  date?: string;
  category?: string;
  tags?: string[];
  draft?: boolean;
  body?: string;
  draftContent?: DraftContent | null;
  unlisted?: boolean;
  kind?: 'post' | 'scribble';
};

function seed(options: SeedOptions = {}): number {
  return db
    .insert(posts)
    .values({
      slug: options.slug ?? 'slug',
      title: options.title ?? 'Title',
      date: options.date ?? '2026-10-15',
      description: '',
      category: options.category ?? 'tech',
      tags: options.tags ?? [],
      draft: options.draft ?? false,
      body: options.body ?? '',
      draftContent: options.draftContent ?? null,
      unlisted: options.unlisted ?? false,
      kind: options.kind ?? 'post',
    })
    .returning({ id: posts.id })
    .get().id;
}

function createDummyPost(overrides: Partial<Post> = {}): Post {
  return {
    id: 1,
    slug: 'test-post',
    title: 'Test Post',
    date: '2026-10-15',
    category: 'tech',
    tags: [],
    tagList: [],
    draft: false,
    body: 'Test body content',
    thumbnail: '',
    unlisted: false,
    updatedAt: '2026-10-15',
    kind: 'post',
    ...overrides,
  };
}

describe('search - criteria 1: only published posts and scribbles (docs/search-requirements.md §6 id=1)', () => {
  it('returns only published listed posts and scribbles, excluding drafts and unlisted', async () => {
    seed({ slug: 'post-1', title: 'Public Post', kind: 'post' });
    seed({ slug: 'scribble-1', title: 'Public Scribble', kind: 'scribble' });
    seed({ slug: 'draft-post', title: 'Draft Post', draft: true, kind: 'post' });
    seed({ slug: 'draft-scribble', title: 'Draft Scribble', draft: true, kind: 'scribble' });
    seed({ slug: 'unlisted-post', title: 'Unlisted Post', unlisted: true, kind: 'post' });
    seed({
      slug: 'unlisted-scribble',
      title: 'Unlisted Scribble',
      unlisted: true,
      kind: 'scribble',
    });

    const results = await getSearchablePosts();
    const slugs = results.map((r) => r.slug);
    expect(slugs).toContain('post-1');
    expect(slugs).toContain('scribble-1');
    expect(slugs).not.toContain('draft-post');
    expect(slugs).not.toContain('draft-scribble');
    expect(slugs).not.toContain('unlisted-post');
    expect(slugs).not.toContain('unlisted-scribble');
  });

  it('searches only the live body and never unpublished draft_content edits', async () => {
    seed({
      slug: 'live-post',
      title: 'Live Title',
      body: 'Live public body with apple',
      draftContent: {
        title: 'Draft Title with banana',
        category: 'tech',
        tags: [],
        body: 'Draft body with cherry',
        thumbnail: '',
      },
    });

    const searchable = await getSearchablePosts();
    expect(searchable).toHaveLength(1);
    expect(searchable[0].body).toBe('Live public body with apple');
    expect(searchable[0].title).toBe('Live Title');

    // apple matches in live body
    const searchApple = searchPosts(searchable, 'apple');
    expect(searchApple).toHaveLength(1);

    // cherry only exists in unpublished draft_content, so it must not be found
    const searchCherry = searchPosts(searchable, 'cherry');
    expect(searchCherry).toHaveLength(0);

    // banana only exists in unpublished draft_content, so it must not be found
    const searchBanana = searchPosts(searchable, 'banana');
    expect(searchBanana).toHaveLength(0);
  });
});

describe('search - criteria 2: visible text extraction from markdown (docs/search-requirements.md §6 id=2)', () => {
  it('includes visible content: links text, inline code, code blocks, tables, footnotes', () => {
    const markdown = [
      '# Heading Title',
      '',
      'A paragraph with a [link label](https://hidden.example.com) and `inlineCodeFunction`.',
      '',
      '```typescript',
      'const databaseSecretCode = 42;',
      '```',
      '',
      '| Column One | Column Two |',
      '| --- | --- |',
      '| TableCellAlpha | TableCellBeta |',
      '',
      'Prose with footnote[^1].',
      '',
      '[^1]: FootnoteNoteContent text.',
    ].join('\n');

    const visible = extractVisibleText(markdown);

    // Included visible text
    expect(visible).toContain('Heading Title');
    expect(visible).toContain('link label');
    expect(visible).toContain('inlineCodeFunction');
    expect(visible).toContain('const databaseSecretCode = 42;');
    expect(visible).toContain('TableCellAlpha');
    expect(visible).toContain('TableCellBeta');
    expect(visible).toContain('FootnoteNoteContent');

    // Excluded from visible text
    expect(visible).not.toContain('https://hidden.example.com');
  });

  it('excludes markdown syntax, URLs, image alt texts, raw HTML, and footnote reference marks', () => {
    const markdown = [
      '![SecretAltText](https://images.example.com/secret-photo.jpg)',
      '',
      '<div class="raw-html-component">RawHtmlPayload</div>',
      '<span class="accent-emphasis">InlineRawSpan</span>',
      '',
      'Reference marker test[^99].',
      '',
      '[^99]: Definition text.',
    ].join('\n');

    const visible = extractVisibleText(markdown);

    expect(visible).not.toContain('SecretAltText');
    expect(visible).not.toContain('https://images.example.com/secret-photo.jpg');
    expect(visible).not.toContain('raw-html-component');
    expect(visible).not.toContain('RawHtmlPayload');
    expect(visible).not.toContain('class="accent-emphasis"');
    expect(visible).not.toContain('[^99]');
  });

  it('joins blocks with single newlines and prevents cross-block matching', () => {
    const markdown = ['First block ending with alpha', '', 'beta starting second block'].join('\n');

    const visible = extractVisibleText(markdown);
    expect(visible).toBe('First block ending with alpha\nbeta starting second block');

    const post = createDummyPost({ body: markdown });
    // 'alphabeta' spans across the boundary and must NOT match
    const result = searchPosts([post], 'alphabeta');
    expect(result).toHaveLength(0);
  });
});

describe('search - criteria 3: normalization and AND search (docs/search-requirements.md §6 id=3)', () => {
  it('ignores full-width vs half-width, case, and full-width spaces', () => {
    const post = createDummyPost({
      title: 'Ｒeact 19 Released',
      body: 'Fullwidth ＴypeＳcript and １２３ test',
    });

    // Query in half-width lowercase
    const r1 = searchPosts([post], 'react');
    expect(r1).toHaveLength(1);

    // Query in full-width uppercase
    const r2 = searchPosts([post], 'ＴＹＰＥＳＣＲＩＰＴ');
    expect(r2).toHaveLength(1);

    // Half-width digits matching full-width digits
    const r3 = searchPosts([post], '123');
    expect(r3).toHaveLength(1);

    // Full-width space between multiple terms
    const r4 = searchPosts([post], 'react　typescript');
    expect(r4).toHaveLength(1);
  });

  it('requires all terms to match (AND) regardless of term order', () => {
    const post = createDummyPost({
      title: 'Title with alpha',
      body: 'Body with beta and gamma',
    });

    // All terms present in any order
    expect(searchPosts([post], 'alpha beta gamma')).toHaveLength(1);
    expect(searchPosts([post], 'gamma alpha beta')).toHaveLength(1);

    // Missing one term
    expect(searchPosts([post], 'alpha beta delta')).toHaveLength(0);
  });

  it('does NOT conflate two-character half-width kana with voiced marks (ｶﾞ) with single-character ガ', () => {
    const post1 = createDummyPost({ id: 1, title: 'ガンダム' });
    const post2 = createDummyPost({ id: 2, title: 'ｶﾞﾝﾀﾞﾑ' });

    // Searching for 'ガ' matches post1, not post2
    const res1 = searchPosts([post1, post2], 'ガ');
    expect(res1.map((r) => r.post.id)).toEqual([1]);
  });
});

describe('search - criteria 4: result ordering (docs/search-requirements.md §6 id=4)', () => {
  it('orders title-all-match before body-match, then date desc, then id desc', () => {
    const postTitleMatchOld = createDummyPost({
      id: 1,
      title: 'Next.js and React Deep Dive',
      body: 'Overview content',
      date: '2026-01-01',
    });

    const postTitleMatchNew = createDummyPost({
      id: 2,
      title: 'Next.js and React Guide',
      body: 'Guide content',
      date: '2026-06-01',
    });

    const postBodyMatchNew = createDummyPost({
      id: 3,
      title: 'Modern Web Development',
      body: 'Discussing Next.js and React frameworks',
      date: '2026-07-01',
    });

    const postBodyMatchOldTieIdHigher = createDummyPost({
      id: 5,
      title: 'Another Article',
      body: 'Mentions Next.js and React',
      date: '2026-02-01',
    });

    const postBodyMatchOldTieIdLower = createDummyPost({
      id: 4,
      title: 'Yet Another Article',
      body: 'Also mentions Next.js and React',
      date: '2026-02-01',
    });

    const postsList = [
      postBodyMatchNew,
      postTitleMatchOld,
      postBodyMatchOldTieIdLower,
      postBodyMatchOldTieIdHigher,
      postTitleMatchNew,
    ];

    const results = searchPosts(postsList, 'Next.js React');
    expect(results.map((r) => r.post.id)).toEqual([
      2, // Title matches both, newer date (2026-06-01)
      1, // Title matches both, older date (2026-01-01)
      3, // Body match only, date 2026-07-01
      5, // Body match only, date 2026-02-01, id 5 > id 4
      4, // Body match only, date 2026-02-01, id 4 < id 5
    ]);
  });
});

describe('search - criteria 5: snippet extraction and exact mark placement (docs/search-requirements.md §6 id=5)', () => {
  it('extracts snippet around earliest matching term with ellipsis on cut edges', () => {
    // 50 characters before target, keyword, 150 characters after target
    const prefix = '0123456789'.repeat(5); // 50 chars
    const keyword = 'TARGETKEYWORD';
    const suffix = 'abcdefghij'.repeat(15); // 150 chars
    const body = `${prefix}${keyword}${suffix}`;

    const snippet = buildSnippet(body, ['targetkeyword'], body);

    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain(keyword);
  });

  it('falls back to excerptFromBody when match is only in title', () => {
    const body = 'This is the opening paragraph of the post with no match.';
    const snippet = buildSnippet(body, ['titlenothere'], body);
    expect(snippet).toBe(body);
  });

  it('places marks at exact original characters without altering full-width or casing', () => {
    const text = 'プレビュー： ＦULLWIDTH and lowercase';
    const segments = splitMarks(text, ['fullwidth']);

    expect(segments).toEqual([
      { text: 'プレビュー： ', isMark: false },
      { text: 'ＦULLWIDTH', isMark: true },
      { text: ' and lowercase', isMark: false },
    ]);
  });

  it('joins line breaks inside snippet according to joinLine rules without leaving stray spaces after Japanese', () => {
    const body = 'これは一段落目です。\n二段落目にキーワードがあります。';
    const snippet = buildSnippet(body, ['キーワード'], body);
    expect(snippet).toBe('これは一段落目です。二段落目にキーワードがあります。');
    expect(snippet).not.toContain('\n');
    expect(snippet).not.toContain('。 ');
  });
});

describe('search - criteria 6: safe text rendering without HTML interpretation (docs/search-requirements.md §6 id=6)', () => {
  it('returns raw text segments containing HTML characters without parsing tags', () => {
    const text = '<script>alert("xss")</script> and <b>Bold</b>';
    const segments = splitMarks(text, ['alert', 'bold']);

    expect(segments).toEqual([
      { text: '<script>', isMark: false },
      { text: 'alert', isMark: true },
      { text: '("xss")</script> and <b>', isMark: false },
      { text: 'Bold', isMark: true },
      { text: '</b>', isMark: false },
    ]);
  });
});

describe('search - criteria 7: empty queries and term/char limits (docs/search-requirements.md §6 id=7)', () => {
  it('returns empty array for empty or whitespace-only queries without running search', () => {
    const post = createDummyPost({ body: 'some content' });
    expect(searchPosts([post], '')).toEqual([]);
    expect(searchPosts([post], '   ')).toEqual([]);
    expect(searchPosts([post], '　　')).toEqual([]);
    expect(parseSearchTerms('')).toEqual([]);
    expect(parseSearchTerms('   ')).toEqual([]);
  });

  it('truncates query exceeding SEARCH_MAX_CHARS (100 characters)', () => {
    const longQuery = 'a'.repeat(SEARCH_MAX_CHARS + 20);
    const terms = parseSearchTerms(longQuery);
    expect(terms).toHaveLength(1);
    expect(terms[0]).toBe('a'.repeat(SEARCH_MAX_CHARS));
  });

  it('discards terms beyond SEARCH_MAX_TERMS (5 terms)', () => {
    const query = 'one two three four five six seven';
    const terms = parseSearchTerms(query);
    expect(terms).toEqual(['one', 'two', 'three', 'four', 'five']);
  });
});

describe('search - criteria 11: caching visible text by body equality (docs/search-requirements.md §6 id=11)', () => {
  it('caches by body, re-extracts and re-normalizes when body changes, and does neither on cache hit', () => {
    const extractor = vi.fn((body: string) => `Extracted: ${body}`);
    const normalizer = vi.fn((text: string) => text.toLowerCase());
    const cache = new Map<number, CacheEntry>();

    const post1 = { id: 10, body: 'Initial body 1' };
    const post2 = { id: 20, body: 'Initial body 2' };

    // 1. First run: extracts and normalizes both
    getVisibleTexts([post1, post2], { extractor, normalizer, cache });
    expect(extractor).toHaveBeenCalledTimes(2);
    expect(normalizer).toHaveBeenCalledTimes(2);

    // 2. Second run with same bodies: neither extractor nor normalizer called (cache hit)
    getVisibleTexts([post1, post2], { extractor, normalizer, cache });
    expect(extractor).toHaveBeenCalledTimes(2);
    expect(normalizer).toHaveBeenCalledTimes(2);

    // 3. Third run: post1 body changed -> extractor and normalizer called for post1 only
    const post1Modified = { id: 10, body: 'Updated body 1' };
    getVisibleTexts([post1Modified, post2], { extractor, normalizer, cache });
    expect(extractor).toHaveBeenCalledTimes(3);
    expect(normalizer).toHaveBeenCalledTimes(3);

    // 4. Fourth run: post2 deleted from list -> cache entry for post2 is pruned
    getVisibleTexts([post1Modified], { extractor, normalizer, cache });
    expect(cache.has(20)).toBe(false);
    expect(cache.has(10)).toBe(true);

    // 5. Fifth run: post2 returns -> extractor and normalizer must be called because it was pruned
    getVisibleTexts([post1Modified, post2], { extractor, normalizer, cache });
    expect(extractor).toHaveBeenCalledTimes(4);
    expect(normalizer).toHaveBeenCalledTimes(4);
  });
});
