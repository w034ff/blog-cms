import { describe, expect, it } from 'vitest';
import { sharedOpenGraph } from '@/app/shared-metadata';
import {
  calculateTotalPages,
  parsePageNumber,
  scribbleDetailMetadata,
  scribbleListMetadata,
  SCRIBBLE_LIST_DESCRIPTION,
  SCRIBBLES_PER_PAGE,
} from '@/lib/scribble-list';
import type { Post } from '@/lib/types';

const TEST_POST: Post = {
  id: 1,
  slug: 'test-scribble-slug-1',
  title: 'テストの走り書き',
  date: '2026-10-15T09:00:00.000Z',
  category: '',
  tags: [],
  tagList: [],
  draft: false,
  body: 'これはテストの走り書き本文です。',
  thumbnail: '',
  unlisted: false,
  updatedAt: '2026-10-15T09:00:00.000Z',
  kind: 'scribble',
};

describe('parsePageNumber', () => {
  it('returns 1 for missing or non-string inputs', () => {
    expect(parsePageNumber(undefined)).toBe(1);
    expect(parsePageNumber(null)).toBe(1);
    expect(parsePageNumber({})).toBe(1);
    expect(parsePageNumber(123)).toBe(1);
  });

  it('returns 1 for empty or non-numeric strings', () => {
    expect(parsePageNumber('')).toBe(1);
    expect(parsePageNumber('   ')).toBe(1);
    expect(parsePageNumber('abc')).toBe(1);
    expect(parsePageNumber('NaN')).toBe(1);
  });

  it('returns 1 for values less than 1', () => {
    expect(parsePageNumber('0')).toBe(1);
    expect(parsePageNumber('-1')).toBe(1);
    expect(parsePageNumber('-100')).toBe(1);
  });

  it('returns 1 for decimal / fractional numbers', () => {
    expect(parsePageNumber('1.5')).toBe(1);
    expect(parsePageNumber('2.0')).toBe(1);
    expect(parsePageNumber('0.9')).toBe(1);
  });

  it('unwraps array query params', () => {
    expect(parsePageNumber(['3'])).toBe(3);
    expect(parsePageNumber(['invalid'])).toBe(1);
    expect(parsePageNumber([])).toBe(1);
  });

  it('parses valid positive integer strings', () => {
    expect(parsePageNumber('1')).toBe(1);
    expect(parsePageNumber('2')).toBe(2);
    expect(parsePageNumber('42')).toBe(42);
  });
});

describe('calculateTotalPages', () => {
  it('returns at least 1 for 0 or negative items', () => {
    expect(calculateTotalPages(0)).toBe(1);
    expect(calculateTotalPages(-5)).toBe(1);
  });

  it('calculates total pages correctly according to page size', () => {
    expect(calculateTotalPages(1, SCRIBBLES_PER_PAGE)).toBe(1);
    expect(calculateTotalPages(SCRIBBLES_PER_PAGE, SCRIBBLES_PER_PAGE)).toBe(1);
    expect(calculateTotalPages(SCRIBBLES_PER_PAGE + 1, SCRIBBLES_PER_PAGE)).toBe(2);
    expect(calculateTotalPages(SCRIBBLES_PER_PAGE * 2, SCRIBBLES_PER_PAGE)).toBe(2);
    expect(calculateTotalPages(SCRIBBLES_PER_PAGE * 2 + 1, SCRIBBLES_PER_PAGE)).toBe(3);
  });
});

describe('metadata robots noindex', () => {
  it('scribbleListMetadata always includes robots: { index: false }', () => {
    const meta = scribbleListMetadata();
    expect(meta.robots).toEqual({ index: false });
    expect(meta.title).toBe('走り書き');
    expect(meta.description).toBe(SCRIBBLE_LIST_DESCRIPTION);

    const page2Meta = scribbleListMetadata(2);
    expect(page2Meta.robots).toEqual({ index: false });
  });

  it('scribbleDetailMetadata for published post includes robots: { index: false } without images', () => {
    const meta = scribbleDetailMetadata(TEST_POST, false);
    expect(meta.robots).toEqual({ index: false });
    expect(meta.title).toBe(TEST_POST.title);
    expect(meta.openGraph).toMatchObject({
      type: 'article',
      title: TEST_POST.title,
      url: `/scribbles/${TEST_POST.slug}`,
    });
    // Scribble og:image does not add post images so site default /og.png stands in
    expect(meta.openGraph?.images).toEqual(sharedOpenGraph.images);
  });

  it('scribbleDetailMetadata for preview includes robots: { index: false, follow: false } and [下書き] title', () => {
    const meta = scribbleDetailMetadata(TEST_POST, true);
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.title).toBe(`[下書き] ${TEST_POST.title}`);
  });
});
