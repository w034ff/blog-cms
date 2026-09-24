import { describe, expect, it } from 'vitest';
import { isSpeakerdeckDeckPage, speakerdeckSnippetHref } from './speakerdeck-snippet';

// docs/embed-requirements.md §16.9. The two snippets below are Speaker Deck's own output, copied
// out of `data-clipboard-text` on the deck page for `speakerdeck.com/soudai/pgcon21j-tutorial`
// rather than written by hand — what this function has to read is whatever
// that button actually produces.
//
// **The half that carries the risk is what must NOT be recognised.** This function widens the shape
// an author may paste; it must not widen the set of references that can be stored, and it must
// never retarget a URL the author pasted to a host they did not name (§16.9's security note).
const ID = '9de2f18094b14cbb91b07331eb085e4f';
const HREF = `https://speakerdeck.com/player/${ID}`;

const IFRAME = `<iframe class="speakerdeck-iframe" frameborder="0" src="${HREF}" title="実際に使うSQLの書き方 徹底解説 / pgcon21j-tutorial" allowfullscreen="true" allow="web-share" style="border: 0px; background: padding-box padding-box rgba(0, 0, 0, 0.1); margin: 0px; padding: 0px; border-radius: 6px; box-shadow: rgba(0, 0, 0, 0.2) 0px 5px 40px; width: 100%; height: auto; aspect-ratio: 560 / 315;" data-ratio="1.7777777777777777"></iframe>`;
const SCRIPT = `<script defer class="speakerdeck-embed" data-id="${ID}" data-ratio="1.7777777777777777" src="//speakerdeck.com/assets/embed.js"></script>`;

describe('speakerdeckSnippetHref', () => {
  it('reads the reference out of both buttons’ output (SD7)', () => {
    expect(speakerdeckSnippetHref(IFRAME)).toBe(HREF);
    expect(speakerdeckSnippetHref(SCRIPT)).toBe(HREF);
    // Whitespace around a paste is the author's, not the snippet's.
    expect(speakerdeckSnippetHref(`\n  ${IFRAME}\n`)).toBe(HREF);
  });

  it('rebuilds the reference rather than copying it out (SD7)', () => {
    // A trailing slash, a query and the `www` host all resolve, and none of them reaches the
    // document: what is stored is built from the id, so the stored string is provably the fixed
    // prefix plus lowercase hex.
    for (const src of [
      `${HREF}/`,
      `${HREF}?utm_source=x`,
      `https://www.speakerdeck.com/player/${ID}`,
    ])
      expect(speakerdeckSnippetHref(`<iframe src="${src}"></iframe>`), src).toBe(HREF);
    // The legacy 24-character id, which plays as well as the current form (§16.2).
    const legacy = '504229f1c53c970002012ba0';
    expect(
      speakerdeckSnippetHref(`<iframe src="https://speakerdeck.com/player/${legacy}"></iframe>`),
    ).toBe(`https://speakerdeck.com/player/${legacy}`);
  });

  it('never retargets a src the author pasted to Speaker Deck (SD8)', () => {
    // **The failure this rules out**: reading the id out of the path and rebuilding the URL without
    // asking about the host would turn each of these into a Speaker Deck deck the author never
    // named. Nothing renders from them, but a silent retarget is not this function's to do.
    for (const src of [
      `https://evil.example/player/${ID}`,
      `https://speakerdeck.com.evil.example/player/${ID}`,
      `javascript:alert(1)//speakerdeck.com/player/${ID}`,
      `https://user:pass@speakerdeck.com/player/${ID}`,
      `//speakerdeck.com/player/${ID}`,
      'not a url at all',
      '',
    ])
      expect(speakerdeckSnippetHref(`<iframe src="${src}"></iframe>`), src).toBeNull();
  });

  it('refuses an id that resolveEmbed would refuse (SD8)', () => {
    for (const id of [
      // Uppercase is a different string to Speaker Deck (§16.2).
      ID.toUpperCase(),
      '0'.repeat(23),
      '0'.repeat(33),
      'not-hex-at-all',
      '',
      // The containment gate's own job: neither of these may be interpolated into a URL, because
      // the result would parse as a different path or carry a query into the document.
      `${ID}/../../evil`,
      `${ID}?x=1`,
      `${ID}#f`,
    ])
      expect(
        speakerdeckSnippetHref(`<script class="speakerdeck-embed" data-id="${id}"></script>`),
        id,
      ).toBeNull();
  });

  it('claims only a paste that is a snippet and nothing else (SD9)', () => {
    for (const text of [
      // A bare player URL is the existing path (§16.3) and is not this function's to claim — the
      // editor already turns it into an embed through the bubble.
      HREF,
      // Prose that mentions a snippet. Claiming it would delete text the author meant to keep.
      `埋め込みコードは ${IFRAME} です`,
      // A script that is not Speaker Deck's embed, even carrying a plausible `data-id`.
      `<script src="//example.com/x.js" data-id="${ID}"></script>`,
      // The embed class without an id, and an iframe with no src at all.
      '<script class="speakerdeck-embed"></script>',
      '<iframe class="speakerdeck-iframe"></iframe>',
      '',
      '   ',
      'ただの文章',
    ])
      expect(speakerdeckSnippetHref(text), text.slice(0, 40)).toBeNull();
  });

  it('does not read an arbitrarily large paste (SD9)', () => {
    // The bound is cheapness, not correctness: a snippet padded past it falls through to an
    // ordinary text paste, which is what every unrecognised paste does. Padded with text rather
    // than spaces, because the length is measured after trimming — the author's own whitespace
    // around a paste is not part of what they pasted.
    expect(speakerdeckSnippetHref(`${IFRAME}${'x'.repeat(9000)}`)).toBeNull();
    expect(speakerdeckSnippetHref(`${IFRAME}${' '.repeat(9000)}`)).toBe(HREF);
  });
});

// docs/embed-requirements.md §16.10. What decides whether the link bubble carries a line telling the
// author which Copy button they wanted. Wrong in the false direction it costs a line of advice
// nobody needed; wrong in the true direction it withholds the only signal there is (§3.2).
describe('isSpeakerdeckDeckPage', () => {
  it('claims the deck page on both hosts (SD13)', () => {
    for (const href of [
      'https://speakerdeck.com/soudai/pgcon21j-tutorial',
      'https://www.speakerdeck.com/soudai/pgcon21j-tutorial',
      'https://speakerdeck.com/soudai/pgcon21j-tutorial/',
    ])
      expect(isSpeakerdeckDeckPage(href), href).toBe(true);
  });

  it('says nothing about a reference that is already an embed (SD13)', () => {
    // The advice is for a reference `resolveEmbed` refused. A player URL needs none.
    expect(isSpeakerdeckDeckPage(HREF)).toBe(false);
  });

  it('leaves every other reference alone (SD13)', () => {
    for (const href of [
      // A user page and the front page name no deck.
      'https://speakerdeck.com/soudai',
      'https://speakerdeck.com/',
      // Another provider, another site, and a string that is not a URL.
      'https://www.youtube.com/watch?v=hDPybQwAuVo',
      'https://example.com/a/b',
      'https://speakerdeck.com.evil.example/a/b',
      'not a url',
      '',
    ])
      expect(isSpeakerdeckDeckPage(href), href).toBe(false);
  });
});
