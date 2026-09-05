import { describe, expect, it } from 'vitest';
import { externalCardHost, isCardHref, isOwnPostHref, normalizeCardHref } from './link-card-href';

// docs/link-card-requirements.md §14.2 and §14.5.1. These predicates are asked from both sides —
// the resolve stage decides whether a stored reference becomes a card, the editor decides whether a
// URL can become one — so a disagreement between them is a card the author makes and the reader
// never sees. That is why they live in one file and why this measures them directly rather than
// through either caller.
describe('externalCardHost', () => {
  it('accepts http(s) and reports the host without `www.`', () => {
    expect(externalCardHost('https://example.com/a')).toBe('example.com');
    expect(externalCardHost('http://www.example.com')).toBe('example.com');
    // Only a leading one, and only on the host: a path or a subdomain that merely contains the
    // letters is untouched.
    expect(externalCardHost('https://wwwx.example.com/www.a')).toBe('wwwx.example.com');
  });

  it('refuses every other scheme (§4.4)', () => {
    // This stage runs after sanitize, so what it accepts becomes an `<a href>` unchecked. Each of
    // these parses as a URL — the scheme test is the only thing standing there.
    for (const href of ['javascript:alert(1)', 'data:text/html,x', 'mailto:a@b.example', 'file:/x'])
      expect(externalCardHost(href), href).toBeNull();
  });

  it('refuses a URL carrying credentials', () => {
    // It parses, and it would be sent to the target by the preview fetch and then published inside
    // an `<a href>`. The resolve stage drops such a card rather than linking it, the same treatment
    // `javascript:` gets.
    expect(externalCardHost('https://user:pass@example.com/a')).toBeNull();
    expect(externalCardHost('https://user@example.com/a')).toBeNull();
    expect(isCardHref('https://user:pass@example.com/a')).toBe(false);
  });

  it('refuses anything with no scheme at all', () => {
    // Including the protocol-relative form, which is the one that looks same-origin and is not.
    for (const href of ['//evil.example', '/posts/abc123', '#heading', ''])
      expect(externalCardHost(href), href).toBeNull();
  });
});

describe('isCardHref', () => {
  it('accepts the two shapes and nothing else', () => {
    expect(isCardHref('/posts/abc123')).toBe(true);
    expect(isCardHref('https://example.com')).toBe(true);
    expect(isCardHref('/posts/..')).toBe(false);
    expect(isCardHref('/admin/posts/1')).toBe(false);
    expect(isCardHref('javascript:alert(1)')).toBe(false);
  });
});

describe('normalizeCardHref', () => {
  const ORIGIN = 'https://blog.example';

  it('turns this blog’s own published URL into the internal reference (14.5.1)', () => {
    // The case the author actually hits: copying the address bar from their own live post. As an
    // external card it would be a stored snapshot of a row this server can read live — and taking
    // that snapshot would mean the server fetching its own public URL back through the Funnel.
    expect(normalizeCardHref('https://blog.example/posts/abc123', ORIGIN)).toBe('/posts/abc123');
    // A trailing slash and a percent-encoded slug reach the same reference: the editor's lookup
    // compares slugs exactly, so a reference that differs by either would resolve to nothing.
    expect(normalizeCardHref('https://blog.example/posts/abc123/', ORIGIN)).toBe('/posts/abc123');
    expect(normalizeCardHref('https://blog.example/posts/hello%2Dworld', ORIGIN)).toBe(
      '/posts/hello-world',
    );
  });

  it('refuses an own-origin URL that names no post', () => {
    // It cannot be an internal card (there is no post) and must not be an external one (the
    // preview route will not fetch this host), so there is no card to make.
    expect(normalizeCardHref('https://blog.example/about', ORIGIN)).toBeNull();
    expect(normalizeCardHref('https://blog.example/', ORIGIN)).toBeNull();
    expect(normalizeCardHref('https://blog.example/posts/', ORIGIN)).toBeNull();
  });

  it('passes an external URL through unchanged but for what URL() normalises', () => {
    expect(normalizeCardHref('https://example.com/a?b=1#c', ORIGIN)).toBe(
      'https://example.com/a?b=1#c',
    );
    // Whitespace an author picks up when pasting is not a different reference.
    expect(normalizeCardHref('  https://example.com/a  ', ORIGIN)).toBe('https://example.com/a');
  });

  it('accepts a reference that is already internal', () => {
    expect(normalizeCardHref('/posts/abc123', ORIGIN)).toBe('/posts/abc123');
  });

  it('refuses a malformed percent-escape rather than throwing', () => {
    // `new URL()` leaves `%zz` in the pathname and `decodeURIComponent` throws on it. Unguarded,
    // that throw travels to `resolveCard` inside rehypeLinkCard's `Promise.all` and takes the whole
    // published page down — one bad reference in one body, the entire post 500s.
    expect(() => normalizeCardHref('https://blog.example/posts/%zz', ORIGIN)).not.toThrow();
    expect(normalizeCardHref('https://blog.example/posts/%zz', ORIGIN)).toBeNull();
    expect(normalizeCardHref('https://blog.example/posts/a%E0%A4%A', ORIGIN)).toBeNull();
  });

  it('returns null where there is no card to make', () => {
    for (const raw of [
      '',
      '   ',
      'ただの検索語',
      'mailto:a@b.example',
      '#heading',
      '//evil.example',
    ])
      expect(normalizeCardHref(raw, ORIGIN), raw).toBeNull();
  });
});

// docs/link-card-requirements.md §18. The self-reference guard is a predicate the editor's four
// doors each ask for themselves, so this is where the rule itself is measured.
describe('isOwnPostHref', () => {
  it('recognizes the post being edited', () => {
    expect(isOwnPostHref('/posts/abc123', 'abc123')).toBe(true);
  });

  it('lets every other post through', () => {
    expect(isOwnPostHref('/posts/abc124', 'abc123')).toBe(false);
    // A prefix is not a slug: nothing about `/posts/abc1234` is this post.
    expect(isOwnPostHref('/posts/abc1234', 'abc123')).toBe(false);
    expect(isOwnPostHref('https://example.com/a', 'abc123')).toBe(false);
  });

  it('answers no when the post has no slug yet', () => {
    // A brand-new post before autosave has created its row. There is no address to point at, so
    // there is nothing to refuse — and `/posts/` must not become the reference that matches.
    expect(isOwnPostHref('/posts/abc123', '')).toBe(false);
    expect(isOwnPostHref('/posts/', '')).toBe(false);
  });

  it('is asked about a normalized reference, which is what every caller has', () => {
    // The published URL of the post being edited arrives at the guards as the internal reference
    // (§14.5.1), which is the form this predicate reads. The two together are the paste path.
    const own = normalizeCardHref('https://blog.example/posts/abc123', 'https://blog.example');
    expect(own).toBe('/posts/abc123');
    expect(isOwnPostHref(own ?? '', 'abc123')).toBe(true);
  });
});
