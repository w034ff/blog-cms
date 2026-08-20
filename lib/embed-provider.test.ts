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
      expect(resolveEmbed(href)?.src, href).toBe(SRC);
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
    expect(resolveEmbed(`https://youtu.be/${ID}?t=90`)?.src).toBe(`${SRC}?start=90`);
    expect(resolveEmbed(`https://youtu.be/${ID}?t=90s`)?.src).toBe(`${SRC}?start=90`);
    expect(resolveEmbed(`https://youtu.be/${ID}?t=1h2m3s`)?.src).toBe(`${SRC}?start=3723`);
    expect(resolveEmbed(`https://youtu.be/${ID}?t=2m`)?.src).toBe(`${SRC}?start=120`);
    expect(resolveEmbed(`https://www.youtube.com/watch?v=${ID}&start=45`)?.src).toBe(
      `${SRC}?start=45`,
    );
  });

  it('plays from the start when `t` is not something it understands (Y3)', () => {
    // Not a guess to make: an uninterpreted string in the src is worse than the wrong moment.
    for (const t of ['abc', '', '-5', '1h2m3', '9'.repeat(12), 'NaN'])
      expect(resolveEmbed(`https://youtu.be/${ID}?t=${t}`)?.src, t).toBe(SRC);
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
    expect(resolveEmbed(`https://www.youtube.com/watch?v=${ID}&list=PLabc&index=2`)?.src).toBe(SRC);
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
