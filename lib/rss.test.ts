import { describe, expect, it } from 'vitest';
import { buildRssFeed, wrapCdata } from '@/lib/rss';
import { DEFAULT_SITE_DESCRIPTION, DEFAULT_SITE_NAME } from '@/app/shared-metadata';

const SITE = { name: DEFAULT_SITE_NAME, description: DEFAULT_SITE_DESCRIPTION };
import type { Post } from '@/lib/types';

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: 1,
    slug: 'abc123',
    title: 'Title',
    date: '2026-09-04T00:00:00.000Z',
    category: 'tech',
    tags: [],
    tagList: [],
    draft: false,
    body: '',
    thumbnail: '',
    unlisted: false,
    updatedAt: '2026-09-04T00:00:00.000Z',
    kind: 'post',
    ...overrides,
  };
}

describe('wrapCdata', () => {
  it('closes and reopens the section around a literal ]]>', () => {
    expect(wrapCdata('before ]]> after')).toBe('<![CDATA[before ]]]]><![CDATA[> after]]>');
  });

  it('passes a value with no ]]> through as a single section', () => {
    expect(wrapCdata('plain text')).toBe('<![CDATA[plain text]]>');
  });
});

describe('buildRssFeed', () => {
  it('does not corrupt the XML when title/description contain ]]>', () => {
    const xml = buildRssFeed(SITE, [post({ title: 'a ]]> b', body: 'c ]]> d' })]);
    expect(xml).toContain('<title><![CDATA[a ]]]]><![CDATA[> b]]></title>');
    expect(xml).toContain('<description><![CDATA[c ]]]]><![CDATA[> d]]></description>');
  });

  it('builds a link/guid with no double slash (siteOrigin is a URL, not a bare string)', () => {
    // Regression: `siteOrigin` (lib/site.ts) is a `URL` object. Template-interpolating it
    // directly stringifies via `.toString()`, which for a bare origin includes a trailing
    // slash — `${siteOrigin}/posts/x` then reads "https://host//posts/x". Caught live in
    // production output; `.origin` is the fix.
    const xml = buildRssFeed(SITE, [post({ slug: 'abc123' })]);
    expect(xml).not.toMatch(/posts\/\//);
    expect(xml).toMatch(/<link>[^<]+\/posts\/abc123<\/link>/);
  });

  it('excludes a post whose slug is null', () => {
    const xml = buildRssFeed(SITE, [post({ slug: null })]);
    expect(xml).not.toContain('<item>');
  });

  it('excludes a post whose date is the never-published sentinel', () => {
    const xml = buildRssFeed(SITE, [post({ date: '' })]);
    expect(xml).not.toContain('<item>');
    expect(xml).not.toContain('Invalid Date');
  });

  it('caps the default output at the first 20 items, in the order given', () => {
    // buildRssFeed doesn't sort — it takes posts in whatever order getAllPosts() (date desc)
    // handed it, and just slices. Assert the actual slug sequence, not just a count and two
    // spot-checks, so a slice-direction or off-by-one regression can't pass silently.
    const posts = Array.from({ length: 25 }, (_, i) => post({ id: i, slug: `s${i}` }));
    const xml = buildRssFeed(SITE, posts);
    const links = [...xml.matchAll(/<link>[^<]*\/posts\/(s\d+)<\/link>/g)].map((m) => m[1]);
    expect(links).toEqual(Array.from({ length: 20 }, (_, i) => `s${i}`));
  });

  it('includes every eligible post when limit is null (?all=1)', () => {
    const posts = Array.from({ length: 25 }, (_, i) => post({ id: i, slug: `s${i}` }));
    const xml = buildRssFeed(SITE, posts, { limit: null });
    expect(xml.match(/<item>/g)).toHaveLength(25);
  });

  it('honors an explicit numeric limit', () => {
    const posts = Array.from({ length: 25 }, (_, i) => post({ id: i, slug: `s${i}` }));
    const xml = buildRssFeed(SITE, posts, { limit: 5 });
    expect(xml.match(/<item>/g)).toHaveLength(5);
  });

  // Unlisted-post exclusion is not this function's concern — buildRssFeed renders whatever
  // Post[] it's handed, and getAllPosts() (lib/posts.test.ts, "excludes unlisted posts")
  // already guarantees an unlisted post never reaches here.
});
