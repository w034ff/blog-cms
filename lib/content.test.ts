import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  DEFAULT_CATEGORY,
  categoryLabel,
  isCategoryId,
  normalizeCategory,
  parseTags,
  tagSlug,
} from '@/lib/content';

describe('categories', () => {
  it('has distinct ids and labels, and the default is one of them', () => {
    const ids = CATEGORIES.map((category) => category.id);
    const labels = CATEGORIES.map((category) => category.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
    expect(isCategoryId(DEFAULT_CATEGORY)).toBe(true);
  });

  it.each(CATEGORIES.map(({ id, label }) => [id, label]))('labels %s as %s', (id, label) => {
    expect(isCategoryId(id)).toBe(true);
    expect(normalizeCategory(id)).toBe(id);
    if (isCategoryId(id)) expect(categoryLabel(id)).toBe(label);
  });

  // The free-text era's values, the blank a lost field sends, and things that are not strings.
  it.each([['uncategorized'], ['tech-notes'], [''], [undefined], [null], [1]])(
    'reads %s as the default',
    (value) => {
      expect(isCategoryId(value)).toBe(false);
      expect(normalizeCategory(value)).toBe(DEFAULT_CATEGORY);
    },
  );
});

describe('tagSlug', () => {
  it.each([
    ['Next.js', 'next.js'],
    ['React Server Components', 'react-server-components'],
    ['  ｒｅａｃｔ  ', 'react'],
    ['C#', 'c'],
    ['a, b / c?d%e', 'a-b-cde'],
    ['設計', '設計'],
    ['- a -', 'a'],
    ['', ''],
    ['..', ''],
  ])('%j → %j', (name, slug) => {
    expect(tagSlug(name)).toBe(slug);
  });
});

describe('parseTags', () => {
  it('splits, trims and drops empties and repeats', () => {
    expect(parseTags(' a, b,,a , c ')).toEqual(['a', 'b', 'c']);
    expect(parseTags('')).toEqual([]);
  });
});
