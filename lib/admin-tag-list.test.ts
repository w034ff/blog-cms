import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TAG_PARAMS,
  countByUse,
  matchesUse,
  parseTagListParams,
  sortTags,
  tagListHref,
} from '@/lib/admin-tag-list';
import type { DictionaryTag } from '@/lib/types';

const tag = (slug: string): DictionaryTag => ({ slug, name: slug, aliases: [] });
const tags = [tag('react'), tag('go'), tag('bash'), tag('css')];
const usage = { react: 3, go: 1, css: 1 };

describe('parseTagListParams', () => {
  it('reads the tab and the sort', () => {
    expect(parseTagListParams({ use: 'unused', sort: 'least' })).toEqual({
      use: 'unused',
      sort: 'least',
    });
  });
  it('falls back to the defaults for anything off the lists', () => {
    expect(parseTagListParams({ use: 'x', sort: ['most', 'least'] })).toEqual({
      use: 'all',
      sort: 'most',
    });
    expect(parseTagListParams({})).toEqual(DEFAULT_TAG_PARAMS);
  });
});

describe('matchesUse and countByUse', () => {
  it('splits the dictionary by whether a post carries the tag', () => {
    expect(matchesUse(0, 'unused')).toBe(true);
    expect(matchesUse(2, 'unused')).toBe(false);
    expect(matchesUse(2, 'used')).toBe(true);
    expect(matchesUse(0, 'all')).toBe(true);
    expect(countByUse(tags, usage)).toEqual({ all: 4, used: 3, unused: 1 });
  });
});

describe('sortTags', () => {
  const slugs = (list: DictionaryTag[]) => list.map((t) => t.slug);
  it('orders by identifier, or by count with the identifier breaking ties', () => {
    expect(slugs(sortTags(tags, usage, 'slug'))).toEqual(['bash', 'css', 'go', 'react']);
    expect(slugs(sortTags(tags, usage, 'most'))).toEqual(['react', 'css', 'go', 'bash']);
    expect(slugs(sortTags(tags, usage, 'least'))).toEqual(['bash', 'css', 'go', 'react']);
  });
});

describe('tagListHref', () => {
  it('leaves the defaults out', () => {
    expect(tagListHref(DEFAULT_TAG_PARAMS, {})).toBe('/admin/tags');
    expect(tagListHref(DEFAULT_TAG_PARAMS, { use: 'unused' })).toBe('/admin/tags?use=unused');
    expect(tagListHref({ use: 'used', sort: 'most' }, { use: 'all' })).toBe(
      '/admin/tags?sort=most',
    );
  });
});
