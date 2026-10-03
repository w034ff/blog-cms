import { describe, expect, it } from 'vitest';
import matter from 'gray-matter';
import { markdownFilename, postToMarkdown } from './post-markdown';
import type { Post } from './types';

const published: Post = {
  id: 7,
  slug: 'abc',
  title: 'Tesseract: 日本語の "OCR"',
  date: '2026-09-29',
  category: 'tech',
  tags: ['ocr', 'tesseract'],
  tagList: [],
  draft: false,
  body: '## 見出し\n\n本文。\n',
  thumbnail: '',
  unlisted: false,
  updatedAt: '2026-09-30T00:00:00.000Z',
};

describe('postToMarkdown', () => {
  // What scripts/migrate-content.mts reads back: the same fields, and the body untouched.
  it('round-trips through gray-matter as content/posts/*.mdx does', () => {
    const parsed = matter(postToMarkdown(published));
    expect(parsed.data).toEqual({
      title: 'Tesseract: 日本語の "OCR"',
      date: '2026-09-29',
      tags: ['ocr', 'tesseract'],
      category: 'tech',
    });
    expect(typeof parsed.data.date).toBe('string');
    expect(parsed.content.trim()).toBe(published.body.trim());
  });

  it('leaves out what a draft does not have yet, and marks it a draft', () => {
    const draft: Post = { ...published, date: '', category: '', tags: [], draft: true };
    expect(matter(postToMarkdown(draft)).data).toEqual({
      title: 'Tesseract: 日本語の "OCR"',
      draft: true,
    });
  });

  it('keeps a chosen thumbnail', () => {
    const data = matter(postToMarkdown({ ...published, thumbnail: '/uploads/a.png' })).data;
    expect(data.thumbnail).toBe('/uploads/a.png');
  });
});

describe('markdownFilename', () => {
  it('replaces characters a filesystem refuses', () => {
    expect(markdownFilename({ id: 7, title: 'a/b:c*?"<>|d' })).toBe('a_b_c______d.md');
  });

  it('falls back to the id when the title is empty', () => {
    expect(markdownFilename({ id: 7, title: '  ' })).toBe('post-7.md');
  });
});
