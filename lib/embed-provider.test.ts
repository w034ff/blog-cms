import { describe, expect, it } from 'vitest';
import { resolveEmbed } from './embed-provider';

// docs/embed-requirements.md §9. `resolveEmbed` is asked from both sides — the resolve stage decides
// whether a stored reference becomes an iframe, the editor decides whether a URL can become one —
// so a disagreement between them is an embed the author makes and the reader never sees. That is
// why it lives in one file and why this measures it directly rather than through either caller.
//
// Ids here are eleven characters because that is what the predicate requires; `hDPybQwAuVo` is the
// one measured in §9.2's table.
const ID = 'hDPybQwAuVo';
const SRC = `https://www.youtube-nocookie.com/embed/${ID}`;
// `src` takes the instance id the render stages mint per placement (§10.5). YouTube ignores it —
// these assertions pass one only because the signature requires it.
const ANY = 'probe';

describe('resolveEmbed / YouTube', () => {
  it('makes one src out of all five URL shapes (Y1)', () => {
    // §9.2 measured that YouTube itself normalizes these to the same `watch?v=`. Nothing here
    // follows a redirect to find that out — the id is read out of the string.
    for (const href of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
    ])
      expect(resolveEmbed(href)?.src(ANY), href).toBe(SRC);
  });

  it('refuses every host outside the allowlist (Y2)', () => {
    // nocookie is an output of the module, not an input to it, and music.youtube.com is unmeasured
    // — both are absent on purpose, so both fall through to the card's own judgement.
    for (const href of [
      `https://www.youtube-nocookie.com/embed/${ID}`,
      `https://music.youtube.com/watch?v=${ID}`,
      `https://example.com/watch?v=${ID}`,
      `https://notyoutube.com/watch?v=${ID}`,
    ])
      expect(resolveEmbed(href), href).toBeNull();
  });

  it('carries the start time across, in each form it accepts (Y3)', () => {
    expect(resolveEmbed(`https://youtu.be/${ID}?t=90`)?.src(ANY)).toBe(`${SRC}?start=90`);
    expect(resolveEmbed(`https://youtu.be/${ID}?t=90s`)?.src(ANY)).toBe(`${SRC}?start=90`);
    expect(resolveEmbed(`https://youtu.be/${ID}?t=1h2m3s`)?.src(ANY)).toBe(`${SRC}?start=3723`);
    expect(resolveEmbed(`https://youtu.be/${ID}?t=2m`)?.src(ANY)).toBe(`${SRC}?start=120`);
    expect(resolveEmbed(`https://www.youtube.com/watch?v=${ID}&start=45`)?.src(ANY)).toBe(
      `${SRC}?start=45`,
    );
  });

  it('plays from the start when `t` is not something it understands (Y3)', () => {
    // Not a guess to make: an uninterpreted string in the src is worse than the wrong moment.
    for (const t of ['abc', '', '-5', '1h2m3', '9'.repeat(12), 'NaN'])
      expect(resolveEmbed(`https://youtu.be/${ID}?t=${t}`)?.src(ANY), t).toBe(SRC);
  });

  it('refuses what names no single video (Y4)', () => {
    for (const href of [
      'https://www.youtube.com/playlist?list=PLabc',
      'https://www.youtube.com/watch?list=PLabc',
      'https://www.youtube.com/@handle',
      'https://www.youtube.com/channel/UCabc',
      'https://www.youtube.com/user/someone',
      'https://www.youtube.com/',
      'https://youtu.be/',
    ])
      expect(resolveEmbed(href), href).toBeNull();
  });

  it('embeds the video and drops the list when both are present (Y5)', () => {
    expect(resolveEmbed(`https://www.youtube.com/watch?v=${ID}&list=PLabc&index=2`)?.src(ANY)).toBe(
      SRC,
    );
  });

  it('refuses an id that is not an id', () => {
    // The value that reaches the src is verified against the parse rather than trusted from it: a
    // path segment YouTube would not accept has no business being written into an iframe.
    for (const bad of ['short', 'waytoolongforanid', '../../etc', 'has space', 'ドット'])
      expect(resolveEmbed(`https://youtu.be/${encodeURIComponent(bad)}`), bad).toBeNull();
  });

  it('refuses every other scheme, and anything that is not a URL (E2)', () => {
    // This resolves after rehype-sanitize, so nothing downstream checks what it returns.
    for (const href of [
      'javascript:alert(1)',
      'data:text/html,x',
      `//www.youtube.com/watch?v=${ID}`,
      `www.youtube.com/watch?v=${ID}`,
      '',
      '   ',
    ])
      expect(resolveEmbed(href), href).toBeNull();
  });

  it('refuses a URL carrying credentials', () => {
    // 「リンクに戻す」 puts this exact string back into an `<a href>`, where it is published.
    expect(resolveEmbed(`https://user:pass@www.youtube.com/watch?v=${ID}`)).toBeNull();
  });

  it('does not throw on a broken percent-escape (E3)', () => {
    // An exception here reaches rehypeEmbed and takes the whole page down rather than one node
    // (link-card-requirements.md §14.2.1 ①). Not a video is the same answer as any other miss.
    expect(() => resolveEmbed('https://www.youtube.com/watch?v=%zz')).not.toThrow();
    expect(resolveEmbed('https://www.youtube.com/watch?v=%zz')).toBeNull();
  });

  it('names the provider and an accessible name for the iframe (§8-②)', () => {
    const target = resolveEmbed(`https://youtu.be/${ID}`);
    expect(target?.provider).toBe('youtube');
    expect(target?.title).not.toBe('');
  });
});

// docs/embed-requirements.md §10. The account/post split lives entirely in what this file returns:
// a post URL resolves, and every other x.com URL returns null and falls to `normalizeCardHref`,
// which is the whole of "the account gets a card" (§10.4). So the two halves of §10's decision are
// both measured here.
//
// `2089798442306711646` is the post measured in §10.1 and §10.5's table.
const X_ID = '2089798442306711646';
const X_SRC = (id: string, embedId: string) =>
  `https://platform.twitter.com/embed/Tweet.html?id=${id}&lang=ja&embedId=${embedId}`;

describe('resolveEmbed / X', () => {
  it('makes one src out of both post URL shapes, on every host (X1, X3)', () => {
    // `/i/status/` carries the id where a handle would be, so one pattern covers both. The old
    // domain 301s to x.com (§10.1) — matched here rather than followed, since resolving an embed
    // must not put a request on the wire (§3.2).
    for (const href of [
      `https://x.com/ClaudeDevs/status/${X_ID}`,
      `https://www.x.com/ClaudeDevs/status/${X_ID}`,
      `https://twitter.com/ClaudeDevs/status/${X_ID}`,
      `https://www.twitter.com/ClaudeDevs/status/${X_ID}`,
      `https://mobile.twitter.com/ClaudeDevs/status/${X_ID}`,
      `https://x.com/i/status/${X_ID}`,
      // What the share sheet appends, and a trailing segment the id does not depend on.
      `https://x.com/ClaudeDevs/status/${X_ID}?s=20&t=abc`,
      `https://x.com/ClaudeDevs/status/${X_ID}/photo/1`,
    ])
      expect(resolveEmbed(href)?.src('e1'), href).toBe(X_SRC(X_ID, 'e1'));
  });

  it('names the iframe per placement, so two embeds are told apart (X1, §10.5)', () => {
    // Without a distinct `embedId` every iframe on the page answers to `embed-0`, and the parent
    // cannot tell whose `resize` is whose — measured 2026-08-23.
    const target = resolveEmbed(`https://x.com/ClaudeDevs/status/${X_ID}`);
    expect(target?.src('a')).not.toBe(target?.src('b'));
    // The id is the render stage's string, so it is escaped on the way into the query.
    expect(target?.src('a b&c')).toBe(X_SRC(X_ID, 'a%20b%26c'));
  });

  it('leaves the account, and everything else on the host, to the card (X2)', () => {
    // Not a rejection with a message — a `null` here IS how the account gets a card (§10.4).
    for (const href of [
      'https://x.com/ClaudeDevs',
      'https://x.com/',
      'https://x.com/i/lists/12345',
      'https://x.com/search?q=claude',
      'https://x.com/ClaudeDevs/with_replies',
      'https://x.com/ClaudeDevs/status',
      'https://twitter.com/__example__',
    ])
      expect(resolveEmbed(href), href).toBeNull();
  });

  it('refuses an id that is not an id (X4)', () => {
    // The bound is what keeps a longer run of digits out of the src verbatim; `99999999999999999999`
    // is the 20-digit fixture §10.6 keeps, and it is refused HERE, before anything reaches the wire.
    for (const bad of ['99999999999999999999', 'abc', '12a45', '', '-1', '1.5', '１２３'])
      expect(
        resolveEmbed(`https://x.com/ClaudeDevs/status/${encodeURIComponent(bad)}`),
        bad,
      ).toBeNull();
  });

  it('refuses a redirector rather than following it (§3.2)', () => {
    // `t.co` names nothing without a request, and resolving an embed must not make one.
    expect(resolveEmbed('https://t.co/abc123')).toBeNull();
  });

  it('refuses credentials and every other scheme, as YouTube does (E2)', () => {
    expect(resolveEmbed(`https://user:pass@x.com/a/status/${X_ID}`)).toBeNull();
    expect(resolveEmbed(`//x.com/a/status/${X_ID}`)).toBeNull();
  });

  it('does not throw on a broken percent-escape (E3)', () => {
    expect(() => resolveEmbed('https://x.com/a/status/%zz')).not.toThrow();
    expect(resolveEmbed('https://x.com/a/status/%zz')).toBeNull();
  });

  it('names the provider and an accessible name for the iframe (§8-②)', () => {
    // `embed-x` is the CSS hook both surfaces share; the name is generic because no fetch has run.
    const target = resolveEmbed(`https://x.com/ClaudeDevs/status/${X_ID}`);
    expect(target?.provider).toBe('x');
    expect(target?.title).not.toBe('');
  });
});

// docs/embed-requirements.md §14. `260753333` is the deck measured throughout that section, and
// `266319371` is the 43-slide one its paging was measured on.
//
// The whole of "a deck URL becomes an embed and a SlideShare URL that names no deck becomes a card"
// lives in what this file returns, as X's account/post split does — so both halves are measured
// here rather than through either caller.
const SS_ID = '260753333';
const SS_SRC = `https://www.slideshare.net/slideshow/embed_code/${SS_ID}`;

describe('resolveEmbed / SlideShare', () => {
  it('makes the id form out of the canonical URL, on both hosts (S1)', () => {
    // embed-requirements.md §14.3 measured that this 302s to `embed_code/key/<KEY>` and plays the right deck. Nothing
    // here follows that redirect — the id is read out of the string, which is what keeps §3.2 true.
    for (const href of [
      `https://www.slideshare.net/slideshow/slidesharesample-${SS_ID}/${SS_ID}`,
      `https://slideshare.net/slideshow/slidesharesample-${SS_ID}/${SS_ID}`,
      `https://www.slideshare.net/slideshow/slidesharesample-${SS_ID}/${SS_ID}/`,
      `https://www.slideshare.net/slideshow/2024-state-of-marketing-report-by-hubspot/${SS_ID}`,
    ])
      expect(resolveEmbed(href)?.src(ANY), href).toBe(SS_SRC);
  });

  it('leaves every SlideShare URL that names no deck to the card (S2)', () => {
    for (const href of [
      // The old shape, which carries no id at all (measured 2026-08-25: it answers 404).
      'https://www.slideshare.net/HubSpot/2024-state-of-marketing-report-by-hubspot',
      // A deck page with the id missing, the search page, the front page, a user page.
      'https://www.slideshare.net/slideshow/slidesharesample-260753333',
      'https://www.slideshare.net/search?q=tiptap',
      'https://www.slideshare.net/',
      // The embed URL itself. Accepting it would put a bare player page into the `<a href>` that
      // 「リンクに戻す」 writes, which is not the page the author was holding (embed-requirements.md §14.2).
      'https://www.slideshare.net/slideshow/embed_code/key/LZA7MNjzNb8GAl',
      // The locale hosts are outside the allowlist and fall to the card, as `music.youtube.com`
      // does (embed-requirements.md §14.2).
      `https://es.slideshare.net/slideshow/slidesharesample-${SS_ID}/${SS_ID}`,
    ])
      expect(resolveEmbed(href), href).toBeNull();
  });

  it('refuses an id that is not an id (S3)', () => {
    for (const id of ['abc', '', '12a', '-1', '1'.repeat(20), '%zz'])
      expect(resolveEmbed(`https://www.slideshare.net/slideshow/deck/${id}`), id).toBeNull();
  });

  it('refuses credentials and every other scheme, as the others do (E2)', () => {
    for (const href of [
      `https://user:pass@www.slideshare.net/slideshow/deck/${SS_ID}`,
      `javascript:alert(1)//www.slideshare.net/slideshow/deck/${SS_ID}`,
      `ftp://www.slideshare.net/slideshow/deck/${SS_ID}`,
    ])
      expect(resolveEmbed(href), href).toBeNull();
  });

  it('does not throw on a broken percent-escape (E3)', () => {
    expect(() => resolveEmbed('https://www.slideshare.net/slideshow/%zz/1')).not.toThrow();
    expect(resolveEmbed('https://www.slideshare.net/slideshow/%zz/1')?.src(ANY)).toBe(
      'https://www.slideshare.net/slideshow/embed_code/1',
    );
  });

  it('names the provider, an accessible name, and a mark-able label (S4, §8-②)', () => {
    const target = resolveEmbed(
      `https://www.slideshare.net/slideshow/slidesharesample-${SS_ID}/${SS_ID}`,
    );
    expect(target?.provider).toBe('slideshare');
    expect(target?.title).not.toBe('');
    // The slug is deliberately absent from the label — it is not a name (embed-requirements.md §14.8).
    expect(target?.label).toEqual({ lead: 'SlideShare', detail: '' });
    // Full screen is the attribute's business, not this string's (embed-requirements.md §14.4).
    expect(target?.allow).toBe('');
  });
});
