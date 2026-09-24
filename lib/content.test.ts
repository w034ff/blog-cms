import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  categoryLabel,
  isCategoryId,
  normalizeCategory,
  hasTagSymbols,
  parseTags,
  tagSearchKey,
  tagSlug,
  tagSlugProblem,
} from '@/lib/content';

describe('categories', () => {
  it('has distinct ids and labels, none of them the empty "not chosen"', () => {
    const ids = CATEGORIES.map((category) => category.id);
    const labels = CATEGORIES.map((category) => category.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
    expect(isCategoryId('')).toBe(false);
  });

  it.each(CATEGORIES.map(({ id, label }) => [id, label]))('labels %s as %s', (id, label) => {
    expect(isCategoryId(id)).toBe(true);
    expect(normalizeCategory(id)).toBe(id);
    if (isCategoryId(id)) expect(categoryLabel(id)).toBe(label);
  });

  // The free-text era's values, the blank of a post with none chosen, and things that are not
  // strings. Read as not chosen rather than as some category, so publish asks the author (§12.32).
  it.each([['uncategorized'], ['tech-notes'], [''], [undefined], [null], [1]])(
    'reads %s as not chosen',
    (value) => {
      expect(isCategoryId(value)).toBe(false);
      expect(normalizeCategory(value)).toBe('');
    },
  );

  it('labels not chosen as 未設定', () => {
    expect(categoryLabel('')).toBe('未設定');
  });
});

describe('tagSlug', () => {
  it.each([
    ['NextJS', 'nextjs'],
    ['  ｒｅａｃｔ  ', 'react'],
    ['設計', '設計'],
    ['csharp', 'csharp'],
    ['', ''],
  ])('%j → %j', (name, slug) => {
    expect(tagSlug(name)).toBe(slug);
  });

  // Refused, not stripped: stripped, `C#` would be the tag `c`.
  it.each([
    ['Next.js'],
    ['next-js'],
    ['C#'],
    ['C++'],
    ['react server'],
    ['a_b'],
    ['ｃ＃'],
    ['設計　メモ'],
  ])('refuses %j', (name) => {
    expect(hasTagSymbols(name)).toBe(true);
    expect(tagSlug(name)).toBe('');
  });
});

describe('tagSlugProblem', () => {
  it('allows 18 characters and refuses 19, counted as characters', () => {
    expect(tagSlugProblem('a'.repeat(18))).toBeNull();
    expect(tagSlugProblem('設'.repeat(18))).toBeNull();
    expect(tagSlugProblem('a'.repeat(19))).toBe('タグは 18 文字まで入力できます。');
    expect(tagSlug('a'.repeat(19))).toBe('');
  });
});

describe('tagSearchKey', () => {
  it('drops the symbols a slug cannot carry, so the tag they were reaching for is found', () => {
    expect(tagSearchKey('Next.js')).toBe('nextjs');
    expect(tagSearchKey(' React Server ')).toBe('reactserver');
  });
});

describe('parseTags', () => {
  it('splits, trims and drops empties and repeats', () => {
    expect(parseTags(' a, b,,a , c ')).toEqual(['a', 'b', 'c']);
    expect(parseTags('')).toEqual([]);
  });
});
