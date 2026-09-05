import { describe, expect, it } from 'vitest';
import { resolveInsertTarget } from './insert-target';

// docs/embed-requirements.md §24, docs/link-card-requirements.md §5.2-2/§5.2-3. One decision shared
// by the link card's picker and the insert dialog — measured directly here rather than through
// either caller, the same reason lib/embed-provider.test.ts and lib/link-card-href.test.ts exist.
const ORIGIN = 'https://blog.example';
const OWN_SLUG = 'abc123';
const YOUTUBE_ID = 'hDPybQwAuVo';
const FIGMA_KEY = '7or4V8Tl8YbEFRmMSF3pXe';

describe('resolveInsertTarget', () => {
  it('resolves a provider-claimed URL to an embed', () => {
    expect(
      resolveInsertTarget(`https://www.youtube.com/watch?v=${YOUTUBE_ID}`, OWN_SLUG, ORIGIN),
    ).toEqual({ kind: 'embed', href: `https://www.youtube.com/watch?v=${YOUTUBE_ID}` });
  });

  it('refuses a fixable-URL provider shape with no card fallback (Figma /proto/)', () => {
    // §24.1's 「勧めない」 class: Figma names what would work instead, and a card is a worse answer
    // than the fix — so this must NOT fall through to `normalizeCardHref`.
    const url = `https://www.figma.com/proto/${FIGMA_KEY}/a-file`;
    const target = resolveInsertTarget(url, OWN_SLUG, ORIGIN);
    expect(target.kind).toBe('embed-refused');
    if (target.kind === 'embed-refused') {
      expect(target.message).toBe('埋め込めるのは /design/ か /file/ の URL です。');
    }
  });

  it('falls through to a card for a provider refusal that keeps the card (Docswell video)', () => {
    // §24.1's 「残す」 class: the card really is the next move, so this resolves as an ordinary
    // external card rather than stopping at `embed-refused`.
    const url = 'https://www.docswell.com/s/someone/vLK7J5V-a-video';
    expect(resolveInsertTarget(url, OWN_SLUG, ORIGIN)).toEqual({ kind: 'card', href: url });
  });

  it('falls through to a card for CodeSandbox devbox refusals too', () => {
    const url = 'https://codesandbox.io/p/devbox/eager-proskuriakova-2lcdqm';
    expect(resolveInsertTarget(url, OWN_SLUG, ORIGIN)).toEqual({ kind: 'card', href: url });
  });

  it('resolves a non-provider external URL to a card', () => {
    expect(resolveInsertTarget('https://example.com/an-article', OWN_SLUG, ORIGIN)).toEqual({
      kind: 'card',
      href: 'https://example.com/an-article',
    });
  });

  it('resolves this blog’s own post URL to the internal card reference', () => {
    expect(resolveInsertTarget(`${ORIGIN}/posts/other-post`, OWN_SLUG, ORIGIN)).toEqual({
      kind: 'card',
      href: '/posts/other-post',
    });
  });

  it('refuses a URL naming the post being edited', () => {
    expect(resolveInsertTarget(`${ORIGIN}/posts/${OWN_SLUG}`, OWN_SLUG, ORIGIN)).toEqual({
      kind: 'card-refused-self',
    });
    expect(resolveInsertTarget(`/posts/${OWN_SLUG}`, OWN_SLUG, ORIGIN)).toEqual({
      kind: 'card-refused-self',
    });
  });

  it('answers none for a query with no URL shape, an own-origin non-post URL, or an empty string', () => {
    for (const value of ['ただの検索語', `${ORIGIN}/about`, '', '   '])
      expect(resolveInsertTarget(value, OWN_SLUG, ORIGIN), value).toEqual({ kind: 'none' });
  });
});
