import { describe, expect, it } from 'vitest';
import { EMBED_PROVIDERS, embedRefusal, resolveEmbed } from './embed-provider';

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

// docs/embed-requirements.md §15. `7or4V8Tl8YbEFRmMSF3pXe` is the file measured throughout that
// section, and `5-2` the node its deep link was measured on.
//
// The src is the whole of what §15.3 decided — the key form on `embed.figma.com` rather than the
// legacy `www.figma.com/embed?url=` form — so it is asserted as a whole string here, as SlideShare's
// is, rather than through either caller.
const FIGMA_KEY_SAMPLE = '7or4V8Tl8YbEFRmMSF3pXe';
const FIGMA_SRC = `https://embed.figma.com/design/${FIGMA_KEY_SAMPLE}?embed-host=tech-blog`;

describe('resolveEmbed / Figma', () => {
  it('makes the key form out of every page URL that names the file (F1)', () => {
    for (const href of [
      `https://www.figma.com/design/${FIGMA_KEY_SAMPLE}/Figma-sample`,
      `https://figma.com/design/${FIGMA_KEY_SAMPLE}/Figma-sample`,
      `https://www.figma.com/design/${FIGMA_KEY_SAMPLE}/Figma-sample/`,
      // No slug at all, and the percent-encoded Japanese slug the sample URL actually carries.
      `https://www.figma.com/design/${FIGMA_KEY_SAMPLE}`,
      `https://www.figma.com/design/${FIGMA_KEY_SAMPLE}/Figma%E5%9F%8B%E3%82%81%E8%BE%BC%E3%81%BF%E3%82%B5%E3%83%B3%E3%83%97%E3%83%AB?p=f`,
      // The `/file/` form, which is the same file — Figma's own `og:url` still publishes it
      // (embed-requirements.md §15.2). Both inputs collapse to the one src.
      `https://www.figma.com/file/${FIGMA_KEY_SAMPLE}/Figma-sample`,
    ])
      expect(resolveEmbed(href)?.src(ANY), href).toBe(FIGMA_SRC);
  });

  it('carries the linked node, in either separator, and drops the rest (F2)', () => {
    // `5-2` is what Figma writes today and `5:2` what an older URL carries; `searchParams` hands
    // the latter over decoded, and both land on the same node (embed-requirements.md §15.3).
    for (const node of ['5-2', '5%3A2'])
      expect(
        resolveEmbed(`https://www.figma.com/design/${FIGMA_KEY_SAMPLE}/s?node-id=${node}`)?.src(
          ANY,
        ),
        node,
      ).toBe(`${FIGMA_SRC}&node-id=5-2`);
    // `t` is a sharing attribution token and `p` names a pane of Figma's own UI; neither is part of
    // what the reader sees (embed-requirements.md §15.4).
    expect(
      resolveEmbed(
        `https://www.figma.com/design/${FIGMA_KEY_SAMPLE}/s?node-id=0-1&t=abcDEF123-4&p=f`,
      )?.src(ANY),
    ).toBe(`${FIGMA_SRC}&node-id=0-1`);
    // A `node-id` this does not understand is not a guess to make: the file opens where it opens,
    // and the author's string never reaches the src (§9.3's rule).
    for (const node of ['abc', '1', '1-', '-1', '1-2-3', `${'1'.repeat(10)}-2`, '%zz'])
      expect(
        resolveEmbed(`https://www.figma.com/design/${FIGMA_KEY_SAMPLE}/s?node-id=${node}`)?.src(
          ANY,
        ),
        node,
      ).toBe(FIGMA_SRC);
  });

  it('leaves every Figma URL that names no file to the card (F3)', () => {
    for (const href of [
      // The shapes deferred until one of Figma's own share URLs for them has been measured
      // (embed-requirements.md §15.2): a prototype, a FigJam board, a Slides deck.
      `https://www.figma.com/proto/${FIGMA_KEY_SAMPLE}/Figma-sample?node-id=5-2`,
      `https://www.figma.com/board/${FIGMA_KEY_SAMPLE}/Figma-sample`,
      `https://www.figma.com/slides/${FIGMA_KEY_SAMPLE}/Figma-sample`,
      // The marketing site, the community, a team page, the front page.
      'https://www.figma.com/community/file/1234567890/tiptap',
      'https://www.figma.com/files/team/123/project',
      'https://www.figma.com/',
      // The embed host is an output of this file, not an input to it (embed-requirements.md §15.2),
      // and `figma.site` is a published site rather than a file.
      `https://embed.figma.com/design/${FIGMA_KEY_SAMPLE}?embed-host=tech-blog`,
      'https://foo.figma.site/',
    ])
      expect(resolveEmbed(href), href).toBeNull();
  });

  it('refuses a key that is not a key (F4)', () => {
    // The charset is deliberately `YOUTUBE_ID`'s and wider than the keys measured
    // (embed-requirements.md §15.2), so `-` and `_` are NOT asserted as refusals here.
    for (const key of ['', 'a'.repeat(65), '%zz', 'キー', 'a.b', 'a~b'])
      expect(resolveEmbed(`https://www.figma.com/design/${key}/s`), key).toBeNull();
  });

  it('refuses credentials and every other scheme, as the others do (E2)', () => {
    for (const href of [
      `https://user:pass@www.figma.com/design/${FIGMA_KEY_SAMPLE}/s`,
      `javascript:alert(1)//www.figma.com/design/${FIGMA_KEY_SAMPLE}/s`,
      `ftp://www.figma.com/design/${FIGMA_KEY_SAMPLE}/s`,
    ])
      expect(resolveEmbed(href), href).toBeNull();
  });

  it('does not throw on a broken percent-escape (E3)', () => {
    const href = `https://www.figma.com/design/${FIGMA_KEY_SAMPLE}/%zz?node-id=%zz`;
    expect(() => resolveEmbed(href)).not.toThrow();
    expect(resolveEmbed(href)?.src(ANY)).toBe(FIGMA_SRC);
  });

  it('names the provider, an accessible name, and a mark-able label (F5, §8-②)', () => {
    const target = resolveEmbed(`https://www.figma.com/design/${FIGMA_KEY_SAMPLE}/s?node-id=5-2`);
    expect(target?.provider).toBe('figma');
    expect(target?.title).not.toBe('');
    // Neither the slug nor the node id is a name (embed-requirements.md §15.5).
    expect(target?.label).toEqual({ lead: 'Figma', detail: '' });
    // Full screen is the attribute's business, not this string's (embed-requirements.md §15.3).
    expect(target?.allow).toBe('');
  });
});

// docs/embed-requirements.md §16. `9de2f18094b14cbb91b07331eb085e4f` is the deck measured throughout
// that section (`speakerdeck.com/soudai/pgcon21j-tutorial`), and `504229f1c53c970002012ba0` the
// 24-character legacy id measured beside it.
//
// **What is measured here is mostly what is refused.** The deck page's URL carries no id and no
// slug-shaped alias for the player exists (§16.2), so this provider accepts one shape and one only,
// and every other Speaker Deck URL — the page the author is most likely to be holding — has to
// reach the card rather than an iframe that would name nothing.
const SD_ID = '9de2f18094b14cbb91b07331eb085e4f';
const SD_LEGACY_ID = '504229f1c53c970002012ba0';
const SD_SRC = `https://speakerdeck.com/player/${SD_ID}`;

describe('resolveEmbed / Speaker Deck', () => {
  it('makes the src out of the player URL, on both hosts (SD1)', () => {
    for (const href of [
      SD_SRC,
      `https://www.speakerdeck.com/player/${SD_ID}`,
      `https://speakerdeck.com/player/${SD_ID}/`,
    ])
      expect(resolveEmbed(href)?.src(ANY), href).toBe(SD_SRC);
    // The 24-character form older decks carry — both lengths play (measured 2026-08-26, §16.2).
    expect(resolveEmbed(`https://speakerdeck.com/player/${SD_LEGACY_ID}`)?.src(ANY)).toBe(
      `https://speakerdeck.com/player/${SD_LEGACY_ID}`,
    );
  });

  it('leaves every Speaker Deck URL that is not a player to the card (SD2)', () => {
    for (const href of [
      // **The deck page itself**, which is the shape an author reaches for first. It carries no id
      // at any depth of the path, and deriving one would mean fetching the page (§16.3).
      'https://speakerdeck.com/soudai/pgcon21j-tutorial',
      'https://www.speakerdeck.com/soudai/pgcon21j-tutorial',
      // The slug-shaped aliases that do not exist — all four answer 404 (measured 2026-08-26).
      `https://speakerdeck.com/player/soudai/pgcon21j-tutorial`,
      'https://speakerdeck.com/soudai/pgcon21j-tutorial/embed',
      'https://speakerdeck.com/soudai/pgcon21j-tutorial/player',
      'https://speakerdeck.com/embed/soudai/pgcon21j-tutorial',
      // A user page, the front page, and the player with nothing after it.
      'https://speakerdeck.com/soudai',
      'https://speakerdeck.com/',
      'https://speakerdeck.com/player',
      'https://speakerdeck.com/player/',
      // The oEmbed endpoint. It answers with the player URL, but reading that answer is a fetch,
      // and this file has no fetch in it (§3.2).
      `https://speakerdeck.com/oembed.json?url=https%3A%2F%2Fspeakerdeck.com%2Fsoudai%2Fpgcon21j-tutorial`,
    ])
      expect(resolveEmbed(href), href).toBeNull();
  });

  it('refuses an id that is not an id (SD3)', () => {
    for (const id of [
      '',
      'abc',
      // Uppercase is a different string to Speaker Deck: the same characters upper-cased answer 404
      // (measured 2026-08-26), so accepting them would build a src that plays nothing (§16.2).
      SD_ID.toUpperCase(),
      // Shorter than the legacy form, longer than the current one, and not hex at all.
      '0'.repeat(23),
      '0'.repeat(33),
      `${SD_ID.slice(0, 31)}g`,
      '%zz',
    ])
      expect(resolveEmbed(`https://speakerdeck.com/player/${id}`), id).toBeNull();
  });

  it('refuses credentials and every other scheme, as the others do (E2)', () => {
    for (const href of [
      `https://user:pass@speakerdeck.com/player/${SD_ID}`,
      `javascript:alert(1)//speakerdeck.com/player/${SD_ID}`,
      `ftp://speakerdeck.com/player/${SD_ID}`,
    ])
      expect(resolveEmbed(href), href).toBeNull();
  });

  it('does not throw on a broken percent-escape (E3)', () => {
    expect(() => resolveEmbed('https://speakerdeck.com/player/%zz')).not.toThrow();
    expect(resolveEmbed('https://speakerdeck.com/player/%zz')).toBeNull();
  });

  it('names the provider, an accessible name, and a mark-able label (SD4, §8-②)', () => {
    const target = resolveEmbed(SD_SRC);
    expect(target?.provider).toBe('speakerdeck');
    expect(target?.title).not.toBe('');
    // The reference carries nothing but the id, and an id is not a name (embed-requirements.md §16.7).
    expect(target?.label).toEqual({ lead: 'Speaker Deck', detail: '' });
    // Full screen is the attribute's business, and `web-share` is not asked for
    // (embed-requirements.md §16.4).
    expect(target?.allow).toBe('');
  });
});

// docs/embed-requirements.md §17. `LK7J5V` is the deck measured throughout that section
// (`www.docswell.com/s/ku-suke/LK7J5V-hello-docswell`, 13 pages), and `vYN91PJ` is the video whose
// page URL has the same shape — the one case where the key class is doing the work, since
// `/slide/vYN91PJ/embed` answers 404 (§17.2).
const DW_KEY = 'LK7J5V';
const DW_PAGE = `https://www.docswell.com/s/ku-suke/${DW_KEY}-hello-docswell`;
const DW_SRC = `https://www.docswell.com/slide/${DW_KEY}/embed`;

describe('resolveEmbed / Docswell', () => {
  it('makes the embed src out of the deck page URL, in all of its shapes (D1)', () => {
    for (const href of [
      DW_PAGE,
      // The apex, which answers directly rather than redirecting (§17.2).
      `https://docswell.com/s/ku-suke/${DW_KEY}-hello-docswell`,
      // No slug — `/s/<user>/<key>` 302s to the full form, and the key alone is what resolves.
      `https://www.docswell.com/s/ku-suke/${DW_KEY}`,
      `${DW_PAGE}/`,
      // A slug with hyphens of its own, which is the common shape: the key ends at the first one.
      `https://www.docswell.com/s/1000ch/${DW_KEY}-ai-collaboration-shift-in-engineer-metrics`,
      // Tracking parameters, which name no part of what is shown (§15.4's call for `t=`).
      `${DW_PAGE}?utm_source=x`,
    ])
      expect(resolveEmbed(href)?.src(ANY), href).toBe(DW_SRC);
  });

  it('carries the page the author is pointing at, in either spelling (D2)', () => {
    // The fragment is what the deck page's own player writes into the address bar (`#p1`…`#p13` are
    // in its markup), and the `/<n>` permalink is rewritten into that fragment on load (§17.3).
    expect(resolveEmbed(`${DW_PAGE}#p5`)?.src(ANY)).toBe(`${DW_SRC}#p5`);
    expect(resolveEmbed(`${DW_PAGE}/5`)?.src(ANY)).toBe(`${DW_SRC}#p5`);
    expect(resolveEmbed(`${DW_PAGE}/5#p7`)?.src(ANY)).toBe(`${DW_SRC}#p7`);
    // Page 1 is what the player opens on, so it writes no fragment — and neither does a page this
    // does not understand, for §9.3's reason: an uninterpreted string must not reach the src.
    for (const href of [`${DW_PAGE}#p1`, `${DW_PAGE}/1`, `${DW_PAGE}#p0`, `${DW_PAGE}#page5`])
      expect(resolveEmbed(href)?.src(ANY), href).toBe(DW_SRC);
    // The label says so too, rather than leaving the carried page unnamed (§17.7).
    expect(resolveEmbed(`${DW_PAGE}#p5`)?.label).toEqual({
      lead: 'Docswell',
      detail: '5 ページ目から',
    });
  });

  it('leaves every Docswell URL that is not a deck page to the card (D3)', () => {
    for (const href of [
      // **A video**, which lives at the same path with a `v` in front of the key and is served from
      // `/video/<key>/embed` instead — `/slide/vYN91PJ/embed` is a 404 (measured 2026-08-26).
      'https://www.docswell.com/s/carol0226/vYN91PJ-2026-08-26-2684',
      // The embed URL itself. Accepting it would make 「リンクに戻す」 write the bare player into an
      // `<a href>` rather than the page the author was holding (§14.2's call).
      DW_SRC,
      `https://www.docswell.com/slide/${DW_KEY}/embed#p5`,
      // A user page, the front page, a tag listing and a search — none of them name a deck.
      'https://www.docswell.com/user/ku-suke',
      'https://www.docswell.com/',
      'https://www.docswell.com/tag/AI',
      'https://www.docswell.com/search?q=AI',
      // `/s/` with nothing under it, and the user segment alone (301 to the user page).
      'https://www.docswell.com/s/ku-suke/',
      'https://www.docswell.com/s/ku-suke',
      // The oEmbed endpoint, which answers with the embed URL — reading that answer is a fetch, and
      // this file has none (§3.2).
      `https://www.docswell.com/service/oembed?url=${encodeURIComponent(DW_PAGE)}`,
    ])
      expect(resolveEmbed(href), href).toBeNull();
  });

  it('refuses a key that is not a key (D4)', () => {
    for (const key of [
      // Lowercase is a different string to Docswell: `lk7j5v` answers 404 where `LK7J5V` is the deck
      // (measured 2026-08-26), so the class has no `a-z` in it — which is also what keeps the video
      // form above out (§17.2).
      DW_KEY.toLowerCase(),
      'LK7J5v',
      'A'.repeat(33),
      '%zz',
      '..',
    ])
      expect(resolveEmbed(`https://www.docswell.com/s/ku-suke/${key}-slug`), key).toBeNull();
  });

  it('refuses credentials and every other scheme, as the others do (E2)', () => {
    for (const href of [
      `https://user:pass@www.docswell.com/s/ku-suke/${DW_KEY}-hello-docswell`,
      `javascript:alert(1)//www.docswell.com/s/ku-suke/${DW_KEY}`,
      `ftp://www.docswell.com/s/ku-suke/${DW_KEY}`,
    ])
      expect(resolveEmbed(href), href).toBeNull();
  });

  it('names the provider, an accessible name, and a mark-able label (D5, §8-②)', () => {
    const target = resolveEmbed(DW_PAGE);
    expect(target?.provider).toBe('docswell');
    expect(target?.title).not.toBe('');
    // The slug is the author's title slugified and the key is not a name, so there is nothing to
    // put beside the provider until the URL names a page (embed-requirements.md §17.7).
    expect(target?.label).toEqual({ lead: 'Docswell', detail: '' });
    // Full screen is the attribute's business (embed-requirements.md §17.4).
    expect(target?.allow).toBe('');
  });
});

// docs/embed-requirements.md §18. `qiitan/fa7df…` is the gist Qiita's own guide embeds, and
// `octocat/6cad326836d38bd3a7ae` is the 20-character form — both measured 2026-08-29.
const GIST_OWNER = 'qiitan';
const GIST_ID = 'fa7df2b570a3f16b39e990b2d2c20aae';
const GIST_PAGE = `https://gist.github.com/${GIST_OWNER}/${GIST_ID}`;
const GIST_SRC = `${GIST_PAGE}.js`;

describe('resolveEmbed / GitHub Gist', () => {
  it('makes the .js src out of the gist page URL, in both of its shapes (G1)', () => {
    expect(resolveEmbed(GIST_PAGE)?.src(ANY)).toBe(GIST_SRC);
    expect(resolveEmbed(`${GIST_PAGE}/`)?.src(ANY)).toBe(GIST_SRC);
    // The ownerless form is a real one: it 302s to the owner form and the reader's browser follows
    // it, which is §14.3's arrangement. It is not rewritten here, because rewriting would need the
    // owner, and the owner is what this form does not carry.
    expect(resolveEmbed(`https://gist.github.com/${GIST_ID}`)?.src(ANY)).toBe(
      `https://gist.github.com/${GIST_ID}.js`,
    );
    // The 20-character id, which is still in service beside the 32 (§18.2).
    expect(resolveEmbed('https://gist.github.com/octocat/6cad326836d38bd3a7ae')?.src(ANY)).toBe(
      'https://gist.github.com/octocat/6cad326836d38bd3a7ae.js',
    );
    // A parameter that names no part of what is shown, as §15.4 drops Figma's `t=`.
    expect(resolveEmbed(`${GIST_PAGE}?utm_source=x`)?.src(ANY)).toBe(GIST_SRC);
  });

  it('carries the file the author named, percent-encoded, and names it (G2)', () => {
    expect(resolveEmbed(`${GIST_PAGE}?file=hello.rb`)?.src(ANY)).toBe(`${GIST_SRC}?file=hello.rb`);
    // The one author-controlled string that reaches a src here, so it is encoded rather than
    // trusted — a filename may hold a space or a `?` and still be a filename (§18.3).
    expect(resolveEmbed(`${GIST_PAGE}?file=a b.md`)?.src(ANY)).toBe(`${GIST_SRC}?file=a%20b.md`);
    // Not a filename: dropped rather than passed on, which shows the whole gist instead of the
    // browser's own refusal notice (§9.3's rule).
    for (const file of ['', 'a/b.txt', 'x'.repeat(256)])
      expect(resolveEmbed(`${GIST_PAGE}?file=${encodeURIComponent(file)}`)?.src(ANY), file).toBe(
        GIST_SRC,
      );
    // The label is the one here that can name the item, rather than leading with the provider the
    // way every deck does (§18.8).
    expect(resolveEmbed(`${GIST_PAGE}?file=hello.rb`)?.label).toEqual({
      lead: GIST_OWNER,
      detail: 'hello.rb',
    });
    expect(resolveEmbed(`https://gist.github.com/${GIST_ID}?file=hello.rb`)?.label).toEqual({
      lead: 'GitHub Gist',
      detail: 'hello.rb',
    });
  });

  it('leaves every gist.github.com URL that is not one gist to the card (G3)', () => {
    for (const href of [
      // The two embed URLs themselves. Accepting either would make 「リンクに戻す」 write GitHub's
      // bare embed form into an `<a href>` rather than the page the author was holding (§14.2's
      // call).
      GIST_SRC,
      `${GIST_PAGE}.pibb`,
      // Revisions, the starred list, the discover feed, a user's gist index, and the root.
      `${GIST_PAGE}/revisions`,
      'https://gist.github.com/starred',
      'https://gist.github.com/discover',
      `https://gist.github.com/${GIST_OWNER}`,
      'https://gist.github.com/',
      // The raw host, which serves `text/plain` under `x-frame-options: deny` and CSP `sandbox` —
      // it is not an embed of anything (§18.2).
      `https://gist.githubusercontent.com/${GIST_OWNER}/${GIST_ID}/raw/hello.rb`,
      // github.com itself is not this provider: a blob page answers `deny` (§18.1).
      'https://github.com/octocat/Spoon-Knife/blob/main/README.md',
    ])
      expect(resolveEmbed(href), href).toBeNull();
  });

  it('refuses an id or an owner that is not one (G4)', () => {
    for (const id of [
      // Case matters to gist: the same 32 characters upper-cased answer 404 (§18.2).
      GIST_ID.toUpperCase(),
      'g'.repeat(32),
      'a'.repeat(19),
      'a'.repeat(33),
      '..',
    ])
      expect(resolveEmbed(`https://gist.github.com/${GIST_OWNER}/${id}`), id).toBeNull();
    // The owner reaches the src too — a wrong one is a 404 rather than a redirect — so it is
    // verified like an id (§18.2).
    for (const owner of ['a'.repeat(40), 'own er', 'own/er'])
      expect(resolveEmbed(`https://gist.github.com/${owner}/${GIST_ID}`), owner).toBeNull();
  });

  it('refuses credentials and every other scheme, as the others do (E2)', () => {
    for (const href of [
      `https://user:pass@gist.github.com/${GIST_OWNER}/${GIST_ID}`,
      `javascript:alert(1)//gist.github.com/${GIST_OWNER}/${GIST_ID}`,
      `ftp://gist.github.com/${GIST_OWNER}/${GIST_ID}`,
    ])
      expect(resolveEmbed(href), href).toBeNull();
  });

  it('does not throw on a broken percent-escape (E3)', () => {
    expect(() => resolveEmbed(`${GIST_PAGE}?file=%E0%A4%A`)).not.toThrow();
    expect(resolveEmbed('https://gist.github.com/%E0%A4%A')).toBeNull();
  });

  it('asks for the frame it needs, and no permission (G5, §8-②)', () => {
    const target = resolveEmbed(GIST_PAGE);
    expect(target?.provider).toBe('gist');
    expect(target?.title).not.toBe('');
    // No file named, so the owner stands alone (§18.8).
    expect(target?.label).toEqual({ lead: GIST_OWNER, detail: '' });
    // Nothing is asked for through `allow`; what the frame needs is asked for through `sandbox`,
    // which is a list of restrictions lifted rather than permissions granted (§18.6).
    expect(target?.allow).toBe('');
    expect(target?.sandbox).toBe('allow-scripts allow-popups');
    // Every other provider is pointed straight at its own URL and gets no sandbox.
    for (const href of [`https://www.youtube.com/watch?v=${ID}`, `${DW_PAGE}`, `${SD_SRC}`]) {
      expect(resolveEmbed(href)?.srcdoc, href).toBeNull();
      expect(resolveEmbed(href)?.sandbox, href).toBeNull();
    }
  });

  it('frames the gist in a document that reports back (G9, §18.5)', () => {
    const target = resolveEmbed(`${GIST_PAGE}?file=hello.rb`);
    const src = target!.src(ANY);
    const doc = target!.srcdoc!(src, 'emb-3');
    // GitHub's script is loaded by the document rather than framed as one — that is the whole of
    // why this provider can be measured at all.
    expect(doc).toContain(`<script src="${src}"></script>`);
    // The reporter names this placement, so two gists on a page are told apart the way two X posts
    // are (§10.5).
    expect(doc).toContain('"emb-3"');
    expect(doc).toContain('gist-embed');
    // The height and the file count, which are the two answers the parent acts on. **The body's
    // rect, not `documentElement.scrollHeight`** — that one is clamped to the frame's own viewport
    // and so can never report a box smaller than the one it is already in (§18.5).
    expect(doc).toContain('document.body.getBoundingClientRect');
    expect(doc).not.toContain('scrollHeight');
    expect(doc).toContain('.gist-file');
    // **Our own base, not GitHub's.** `.pibb` hard-codes `target="_parent"`, which is what took the
    // article away (§18.6); `.js` writes none, so this one is the document's.
    expect(doc).toContain('<base target="_blank">');
    expect(doc).not.toContain('_parent');
    // **The document is written into an HTML attribute, so a filename that could close the `src`
    // attribute would be writing markup.** `encodeURIComponent` is what prevents it, and this is
    // the assertion that would fail if it were dropped (§18.3).
    const hostile = resolveEmbed(`${GIST_PAGE}?file=${encodeURIComponent('a"><img src=x> .rb')}`);
    const hostileDoc = hostile!.srcdoc!(hostile!.src(ANY), 'emb-4');
    expect(hostileDoc).toContain('?file=a%22%3E%3Cimg%20src%3Dx%3E%20.rb');
    expect(hostileDoc).not.toContain('<img');
    // Pure: the same arguments give the same document, which is what lets both stages build it.
    expect(target!.srcdoc!(src, 'emb-3')).toBe(doc);
  });
});

// docs/embed-requirements.md §20. `xgzdk` is the sandbox measured throughout that section (its
// page URL is `/s/react-example-xgzdk`), and `eager-proskuriakova-2lcdqm` is the one Zenn's own
// guide embeds — the fixture that pins the "do not split the segment" rule, since `2lcdqm` inside
// it resolves to the same sandbox and is still not what goes into the src.
const CSB_SEG = 'react-example-xgzdk';
const CSB_PAGE = `https://codesandbox.io/p/sandbox/${CSB_SEG}`;
const CSB_SRC = `https://codesandbox.io/embed/${CSB_SEG}?runonclick=1`;

describe('resolveEmbed / CodeSandbox', () => {
  it('makes the embed src out of the sandbox page URL, in all of its shapes (C1)', () => {
    for (const href of [
      CSB_PAGE,
      // The legacy form, which 307s to `/p/sandbox/<seg>` and carries the segment in the same place
      // — so the src is built without following the redirect (§3.2).
      `https://codesandbox.io/s/${CSB_SEG}`,
      // `www` answers 200 in its own right rather than redirecting (measured 2026-08-30).
      `https://www.codesandbox.io/p/sandbox/${CSB_SEG}`,
      `${CSB_PAGE}/`,
      // Tracking parameters and a fragment: neither names any part of what is shown, and there is
      // no start time or page for this provider to carry over (§20.10).
      `${CSB_PAGE}?utm_source=x`,
      `${CSB_PAGE}#file=/src/index.js`,
    ])
      expect(resolveEmbed(href)?.src(ANY), href).toBe(CSB_SRC);
  });

  it('passes the whole last segment through, without splitting it (C2)', () => {
    // **The bare id is a different string and stays a different string.** Both resolve, so this is
    // not about which one works — it is that the author's segment is what reaches the src (§20.3).
    expect(resolveEmbed('https://codesandbox.io/p/sandbox/xgzdk')?.src(ANY)).toBe(
      'https://codesandbox.io/embed/xgzdk?runonclick=1',
    );
    expect(resolveEmbed(CSB_PAGE)?.src(ANY)).toBe(CSB_SRC);
    // Zenn's fixture, which has two hyphens: a "text after the last hyphen" rule would send
    // `2lcdqm`, and Zenn itself sends the whole thing (measured 2026-08-30).
    const zenn = 'eager-proskuriakova-2lcdqm';
    expect(resolveEmbed(`https://codesandbox.io/p/sandbox/${zenn}`)?.src(ANY)).toBe(
      `https://codesandbox.io/embed/${zenn}?runonclick=1`,
    );
    // **The case that makes splitting unsafe rather than merely different**: this segment is a name,
    // not a slug plus an id, so a split would build a src for a sandbox called `devbox`.
    expect(resolveEmbed('https://codesandbox.io/s/react-new-devbox')?.src(ANY)).toBe(
      'https://codesandbox.io/embed/react-new-devbox?runonclick=1',
    );
    // Case is not normalised either — `/embed/XGZDK` is the same sandbox (measured), so there is
    // nothing to correct, and correcting it would put a string the author did not write in the src.
    expect(resolveEmbed('https://codesandbox.io/s/XGZDK')?.src(ANY)).toBe(
      'https://codesandbox.io/embed/XGZDK?runonclick=1',
    );
  });

  it('leaves every CodeSandbox URL that is not a sandbox page to the card (C3)', () => {
    for (const href of [
      // **A devbox**, which is a VM Sandbox. Measured not to render in a third-party iframe on
      // either route — `/p/sandbox/` and `/embed/` both answer with a Cloudflare challenge that
      // carries `X-Frame-Options: SAMEORIGIN` (§20.13). The claim is about the class, not this URL:
      // what was measured is the docs' own VM example and the six rejected ids, against a browser
      // sandbox as the passing control. So this is refused for a known failure, not an unknown.
      'https://codesandbox.io/p/devbox/react-new-devbox',
      // The embed URL itself, for §14.2's reason: accepting it would make 「リンクに戻す」 write the
      // bare player into an `<a href>` rather than the page the author was holding.
      CSB_SRC,
      'https://codesandbox.io/embed/xgzdk',
      // Listings and profiles, none of which name a single sandbox.
      'https://codesandbox.io/examples/package/react',
      'https://codesandbox.io/u/compuives',
      'https://codesandbox.io/',
      'https://codesandbox.io/dashboard',
      // `/s/` and `/p/sandbox/` with nothing under them.
      'https://codesandbox.io/s/',
      'https://codesandbox.io/p/sandbox/',
      // A deeper path under the canonical form: the segment is not the last one, so this names
      // something other than the sandbox itself.
      'https://codesandbox.io/p/sandbox/xgzdk/settings',
      // The API, whose answer would be a fetch — and this file has none (§3.2).
      'https://codesandbox.io/api/v1/sandboxes/xgzdk',
    ])
      expect(resolveEmbed(href), href).toBeNull();
  });

  it('refuses a segment that cannot be one (C4)', () => {
    for (const segment of [
      // Past the bound, which sits far above the 26 characters of the longest slug form measured.
      'a'.repeat(65),
      // Characters outside the class. Each of these would otherwise reach the src, which is the
      // reason the class is an allowlist rather than a filter (§4.2).
      'a_b',
      'a.b',
      'a%20b',
      'a+b',
      'サンドボックス',
      // `?` and `#` are deliberately not in this list: they never reach `url.pathname` at all, so a
      // segment "containing" one is really the shorter segment before it, which resolves. That is
      // the parser's job and is asserted in C1 with `?utm_source=x` rather than refused here.
    ])
      expect(resolveEmbed(`https://codesandbox.io/p/sandbox/${segment}`), segment).toBeNull();
  });

  it('refuses credentials and every other scheme, as the others do (E2)', () => {
    for (const href of [
      `https://user:pass@codesandbox.io/p/sandbox/${CSB_SEG}`,
      `javascript:alert(1)//codesandbox.io/p/sandbox/${CSB_SEG}`,
      `ftp://codesandbox.io/p/sandbox/${CSB_SEG}`,
    ])
      expect(resolveEmbed(href), href).toBeNull();
  });

  it('names the provider, an accessible name, and asks for no device (C5)', () => {
    const target = resolveEmbed(CSB_PAGE);
    expect(target?.provider).toBe('codesandbox');
    expect(target?.title).not.toBe('');
    // The segment is a slugified title or a random word rather than a name, and no start time or
    // page exists to carry over, so `detail` is always empty here (§20.10).
    expect(target?.label).toEqual({ lead: 'CodeSandbox', detail: '' });
    // **Empty on purpose, and this is the assertion that would fail if someone restored
    // CodeSandbox's own list the way Qiita and Zenn both copy it** (§20.7). A sandbox frames
    // arbitrary third-party code; it is not handed a camera or a microphone by default.
    expect(target?.allow).toBe('');
    // No document of our own: the provider needs no reporter, because it has no height worth
    // hearing (§20.6).
    expect(target?.srcdoc).toBeNull();
    // `allow-top-navigation` is the one absent from this list that matters — the frame must not be
    // able to take the article somewhere else. `allow-same-origin` IS present, unlike the gist's
    // (§18.6), because the editor and the preview need their own storage and workers.
    expect(target?.sandbox).toBe(
      'allow-scripts allow-same-origin allow-forms allow-modals allow-popups',
    );
    expect(target?.sandbox).not.toContain('allow-top-navigation');
  });
});

// docs/embed-requirements.md §21. `flatsato/VwqprLp` is the pen Zenn's own guide embeds and the one
// measured throughout that section; `ohisama/yLePKeK` came out of the Qiita corpus §21.3 counts.
const PEN_USER = 'flatsato';
const PEN_SLUG = 'VwqprLp';
const PEN_PAGE = `https://codepen.io/${PEN_USER}/pen/${PEN_SLUG}`;
const PEN_SRC = `https://codepen.io/${PEN_USER}/embed/${PEN_SLUG}`;

describe('resolveEmbed / CodePen', () => {
  it('makes the embed src out of the pen page URL, in all of its shapes (P1)', () => {
    for (const href of [
      PEN_PAGE,
      // `/full/` and `/details/` are the same pen under another view, with the slug in the same
      // place — 8 and 2 of the corpus's URLs are written this way (§21.3).
      `https://codepen.io/${PEN_USER}/full/${PEN_SLUG}`,
      `https://codepen.io/${PEN_USER}/details/${PEN_SLUG}`,
      `https://www.codepen.io/${PEN_USER}/pen/${PEN_SLUG}`,
      `${PEN_PAGE}/`,
      // Neither names any part of what is shown, and this provider carries nothing over (§21.10).
      `${PEN_PAGE}?utm_source=x`,
      `${PEN_PAGE}#result`,
    ])
      expect(resolveEmbed(href)?.src(ANY), href).toBe(PEN_SRC);
  });

  it('carries the user segment the author wrote, without deriving one (P1)', () => {
    // CodePen does not check it — `/anon/embed/VwqprLp` renders the same pen (measured
    // 2026-08-31) — so this asserts that the src keeps the author's spelling rather than any
    // normal form of ours (§21.4).
    expect(resolveEmbed('https://codepen.io/ohisama/pen/yLePKeK')?.src(ANY)).toBe(
      'https://codepen.io/ohisama/embed/yLePKeK',
    );
  });

  it('appends no query at all — not even the one Zenn sends (P4)', () => {
    const src = resolveEmbed(PEN_PAGE)!.src(ANY);
    expect(src).not.toContain('?');
    // **The three that were measured to work and are still refused** (§21.5): Zenn's undocumented
    // version marker, and the two that would pick a panel and a palette for every author.
    expect(src).not.toContain('embed-version');
    expect(src).not.toContain('default-tab');
    expect(src).not.toContain('theme-id');
    // `/embed/preview/` is the click-to-run form. It exists and works; the saving measured was 10
    // requests against 8, which does not buy the running result being a click away (§21.5).
    expect(src).not.toContain('/embed/preview/');
  });

  it('leaves every CodePen URL that is not a pen page to the card (P2)', () => {
    for (const href of [
      // The embed URL itself, for §14.2's reason.
      PEN_SRC,
      `https://codepen.io/${PEN_USER}/embed/preview/${PEN_SLUG}`,
      // Listings and profiles, none of which name a single pen.
      'https://codepen.io/flatsato',
      'https://codepen.io/collection/DQvYpQ',
      'https://codepen.io/',
      'https://codepen.io/pen/',
      // A deeper path under the canonical form: the slug is not the last segment any more.
      `${PEN_PAGE}/comments`,
      // The two four-segment forms accepted below, one segment deeper again.
      'https://codepen.io/team/codepen/pen/PoqWOwZ/comments',
      // `/editor/` carries only `/pen/`; the other two views were not seen under it (§21.3).
      'https://codepen.io/editor/tetsuji-ishii/full/019f2a4c-772a-7863-84be-b43a2738f8f5',
      // Neither view exists as a page of ours to resolve.
      `https://codepen.io/${PEN_USER}/debug/${PEN_SLUG}`,
      `https://codepen.io/${PEN_USER}/pres/${PEN_SLUG}`,
    ])
      expect(resolveEmbed(href), href).toBeNull();
  });

  it('refuses a slug or a user that cannot be one (P3)', () => {
    for (const slug of [
      'abc',
      'a'.repeat(17),
      'a_b',
      'a.b',
      'a-b',
      'a%20b',
      'ペン',
      // Hyphenated but not a UUID — the shape the second predicate exists to keep out, since a
      // single widened class covering both would have admitted it.
      '019f467b-060a-7fd7-a4af',
      '019F467B-060A-7FD7-A4AF-707B1437B086',
      'zzzzzzzz-060a-7fd7-a4af-707b1437b086',
    ])
      expect(resolveEmbed(`https://codepen.io/${PEN_USER}/pen/${slug}`), slug).toBeNull();
    // The user segment reaches the src as well, so it is checked with the same kind of predicate
    // (§21.3) — 163 usernames measured, the longest 26 characters.
    for (const user of ['a'.repeat(41), 'a b', 'a/b', 'ユーザー'])
      expect(resolveEmbed(`https://codepen.io/${user}/pen/${PEN_SLUG}`), user).toBeNull();
  });

  it("keeps a team's prefix and drops the new editor's (P1)", () => {
    // Both measured in the author's own browser, 2026-08-31 (§21.3). A team keeps `/team/<team>/`
    // because that is what `/pen/` → `/embed/` produces from the page URL; `/editor/` is dropped
    // because the same pen's canonical page URL does not have it either.
    for (const [href, src] of [
      [
        'https://codepen.io/team/codepen/pen/PoqWOwZ',
        'https://codepen.io/team/codepen/embed/PoqWOwZ',
      ],
      [
        'https://codepen.io/team/codepen/full/PoqWOwZ',
        'https://codepen.io/team/codepen/embed/PoqWOwZ',
      ],
      [
        'https://codepen.io/editor/tetsuji-ishii/pen/019f2a4c-772a-7863-84be-b43a2738f8f5',
        'https://codepen.io/tetsuji-ishii/embed/019f2a4c-772a-7863-84be-b43a2738f8f5',
      ],
      // The same UUID under the canonical page URL — 1 of the 4 measured pens is spelled this way,
      // which is why the slug predicate rather than the path is what admits these (§21.3).
      [
        'https://codepen.io/HanaleiMoon/pen/019f467b-060a-7fd7-a4af-707b1437b086',
        'https://codepen.io/HanaleiMoon/embed/019f467b-060a-7fd7-a4af-707b1437b086',
      ],
    ])
      expect(resolveEmbed(href)?.src(ANY), href).toBe(src);
  });

  it('refuses credentials and every other scheme, as the others do (E2)', () => {
    for (const href of [
      `https://user:pass@codepen.io/${PEN_USER}/pen/${PEN_SLUG}`,
      'https://user:pass@codepen.io/team/codepen/pen/PoqWOwZ',
      `javascript:alert(1)//codepen.io/${PEN_USER}/pen/${PEN_SLUG}`,
      `ftp://codepen.io/${PEN_USER}/pen/${PEN_SLUG}`,
    ])
      expect(resolveEmbed(href), href).toBeNull();
  });

  it('names the provider, an accessible name, and asks for no device (P5)', () => {
    const target = resolveEmbed(PEN_PAGE);
    expect(target?.provider).toBe('codepen');
    expect(target?.title).not.toBe('');
    // **The user segment is deliberately absent from the label** (§21.10): the src does not use it
    // as the reference and CodePen does not verify it, so the ghost would name an unchecked author.
    expect(target?.label).toEqual({ lead: 'CodePen', detail: '' });
    expect(target?.label.detail).not.toContain(PEN_USER);
    // Empty, where CodePen's own snippet and both reference sites hand the frame a device list.
    expect(target?.allow).toBe('');
    // The frame reports no height at all (§21.6), so there is no document of ours to put it in.
    expect(target?.srcdoc).toBeNull();
    // **Zenn ships no `sandbox` for CodePen; this diverges on purpose** (§21.7). The entry that
    // matters is the absent one — arbitrary third-party JS must not navigate the article away.
    expect(target?.sandbox).toBe(
      'allow-scripts allow-same-origin allow-forms allow-modals allow-popups',
    );
    expect(target?.sandbox).not.toContain('allow-top-navigation');
  });
});

// §24.1. The insert dialog's table is derived from the registry rather than written beside it, and
// these are the two properties that make deriving it worth anything.
describe('EMBED_PROVIDERS — what the insert dialog can name', () => {
  it('carries every provider the resolver claims, and nothing else', () => {
    // Both directions. Length alone would pass a list that names one provider twice, and a name
    // check alone would pass a list missing the newest entry — which is the failure a hand-kept
    // list has every time this file grows one (§24.1).
    expect(EMBED_PROVIDERS.map((p) => p.name)).toEqual([
      'YouTube',
      'X',
      'SlideShare',
      'Figma',
      'Speaker Deck',
      'Docswell',
      'GitHub Gist',
      'CodeSandbox',
      'CodePen',
    ]);
    for (const provider of EMBED_PROVIDERS) {
      expect(provider.hosts.length, provider.name).toBeGreaterThan(0);
    }
  });

  it('names a kind for every row, out of a vocabulary that groups them (SD8)', () => {
    // §24.1 (2026-09-03). The column stopped printing hosts, which answered "which site" while
    // every URL an author gets wrong is about which page on it. **The assertion is the vocabulary,
    // not the mapping**: nine rows spell five words, and the three-and-three repetition is what
    // makes 「スライドを貼りたい、どれが使える」 land on a group instead of on one brand name. A
    // per-provider kind cannot be checked against the matcher the way a URL shape could — it makes
    // no claim about any URL — so what is held here is coverage and spelling.
    expect(EMBED_PROVIDERS.map((provider) => provider.kind)).toEqual([
      '動画',
      '投稿',
      'スライド',
      'デザインファイル',
      'スライド',
      'スライド',
      'コード',
      'コード',
      'コード',
    ]);
    expect(new Set(EMBED_PROVIDERS.map((provider) => provider.kind)).size).toBe(5);
  });

  it('notes the one provider whose address bar is not the answer (SD8)', () => {
    // §16.10. Speaker Deck's row is the only one an author cannot act on by copying the address
    // bar: the deck page at `speakerdeck.com/<user>/<slug>` carries no id, so nothing there
    // resolves and `/player/<id>` is reachable only from inside the embed code. The dialog draws
    // this in parentheses after the kind (`e2e/editor-embed-insert.spec.ts`, 24h); what is held
    // here is that the registry owns it.
    const noted = EMBED_PROVIDERS.filter((provider) => provider.note !== undefined);
    expect(noted.map((provider) => provider.name)).toEqual(['Speaker Deck']);
    // **It names the code, not a button.** `speakerdeckSnippetHref` takes either Share button's
    // output (§16.9), so 「iframe コード」 here would be false for the author holding the JS one.
    expect(noted[0].note).toBe('埋め込みコード');
    // **The other eight carry none, and that is the assertion.** For them the address bar is the
    // answer, so a note would only repeat what the reader already has.
    expect(EMBED_PROVIDERS.length - noted.length).toBe(8);
  });

  it('answers a refused URL in the words of the provider that claimed it (SD9)', () => {
    // §24.1. Which kind a provider gets turns on whether the author can act. **A fixable URL is
    // told what works and loses the card** — it is a fallback where a fix exists.
    expect(embedRefusal(`https://www.figma.com/proto/${FIGMA_KEY_SAMPLE}/a-file`)).toBe(
      '埋め込めるのは /design/ か /file/ の URL です。',
    );
    expect(embedRefusal('https://speakerdeck.com/soudai/pgcon21j-tutorial')).toBe(
      'Share →「Copy iframe code」の内容を貼ってください。',
    );
    // **A reference nothing can embed keeps the card and gains the reason.** A Docswell video and
    // a devbox have no working URL to reach instead (§17.2, §20.13), so taking the card away
    // would leave the author with a diagnosis and no move.
    expect(embedRefusal('https://www.docswell.com/s/someone/vLK7J5V-a-video')).toBe(
      '動画は埋め込めません。リンクカードにしてください。',
    );
    expect(embedRefusal('https://codesandbox.io/p/devbox/eager-proskuriakova-2lcdqm')).toBe(
      'Devbox は埋め込めません。リンクカードにしてください。',
    );

    // **The narrow half.** A provider answers per URL, not per host, because its refusal meets
    // every shape that fails there — so the sentences above must not reach a user page or a
    // search result, which they would describe wrongly.
    for (const href of [
      'https://www.docswell.com/user/somebody',
      'https://www.docswell.com/s/someone/LK7J5V-a-deck/999999',
      'https://codesandbox.io/u/someone',
      'https://codesandbox.io/examples/package/react',
    ]) {
      expect(resolveEmbed(href), href).toBeNull();
      expect(embedRefusal(href), href).toBeNull();
    }
    // A host no provider claims has nothing specific to say, which is most references — and so
    // does a string that is not a URL, the shape the dialog holds while an author is typing.
    expect(embedRefusal('https://example.com/an-article')).toBeNull();
    expect(embedRefusal('es.slideshare.net/slideshow/x/1')).toBeNull();
    expect(embedRefusal('https://www.you')).toBeNull();
    expect(embedRefusal('')).toBeNull();
  });

  it('spells each provider the same way the drag ghost does', () => {
    // The seven that always lead with the provider, plus the fallback branch of the two that
    // usually lead with an account — those are the leads that must not become a second spelling.
    // X's account form and the gist's owner form are deliberately not here: their lead is the
    // account, not the provider (§10.4, §18).
    // The fixtures each provider's own section above already measured, not new ones: a URL invented
    // here that quietly stops resolving would turn this into a test of the fixture.
    const leads: Record<string, string> = {
      YouTube: `https://www.youtube.com/watch?v=${ID}`,
      // The `/i/status/` form, which is the branch that leads with the provider (§10.4).
      X: `https://x.com/i/status/${X_ID}`,
      SlideShare: `https://www.slideshare.net/slideshow/slidesharesample-${SS_ID}/${SS_ID}`,
      Figma: `https://www.figma.com/design/${FIGMA_KEY_SAMPLE}/Figma-sample`,
      // The player URL, not the deck page — the page carries no id and is left to the card (SD2).
      'Speaker Deck': `https://speakerdeck.com/player/${SD_ID}`,
      Docswell: DW_PAGE,
      // The owner-less form, for X's reason one provider over (§18).
      'GitHub Gist': `https://gist.github.com/${GIST_ID}`,
      CodeSandbox: CSB_PAGE,
      CodePen: PEN_PAGE,
    };
    for (const provider of EMBED_PROVIDERS) {
      const href = leads[provider.name];
      expect(href, `no fixture for ${provider.name}`).toBeDefined();
      const target = resolveEmbed(href);
      expect(target, href).not.toBeNull();
      expect(target?.label.lead, provider.name).toBe(provider.name);
    }
  });
});
