import { describe, expect, it } from 'vitest';
import { embedFallbackAnchor } from './embed-fallback';
import { renderMdxToHtml } from '@/lib/render';
import { CARD_PLACEHOLDER_DARK_SRC, CARD_PLACEHOLDER_SRC } from '@/lib/link-card-image';

// Guards the public render pipeline end-to-end (remark-gfm → alerts →
// remark-rehype → rehype-raw → rehype-sanitize → pretty-code). Focus: the GitHub
// alert transform and the sanitize-schema edit that lets its classes through —
// the schema is security-sensitive (untrusted non-admin authors), so these pin
// that the allowlist stays narrow.
describe('renderMdxToHtml — GitHub alerts', () => {
  it('renders a [!WARNING] blockquote as a styled alert, marker stripped', async () => {
    const { html } = await renderMdxToHtml('> [!WARNING]\n> Be careful **here**.');
    expect(html).toContain('markdown-alert markdown-alert-warning');
    // The type word survives sanitize inside its sr-only label span (icon-only
    // visually, but announced to screen readers) — pins that the schema edit lets
    // the span + its one allowed class through.
    expect(html).toContain('<span class="markdown-alert-title-label">警告</span>');
    // Body is wrapped in a content column div; the sanitize schema must allow it.
    expect(html).toContain('<div class="markdown-alert-content">');
    expect(html).toContain('<strong>here</strong>');
    expect(html).not.toContain('[!WARNING]');
  });

  it('keeps the alert classes but strips a non-allowlisted class', async () => {
    // The `['className', …]` value allowlist must NOT have blanket-enabled
    // className: a bogus class on raw HTML should still be sanitized away.
    const { html } = await renderMdxToHtml('<div class="evil">x</div>\n\n> [!NOTE]\n> ok');
    expect(html).toContain('markdown-alert-note');
    expect(html).not.toContain('evil');
  });
});

// The "強調" inline mark (components/editor/accent-emphasis-extension.ts) has no native
// markdown syntax, so it round-trips as raw `<span class="accent-emphasis">` — pins that
// the sanitize schema edit keeps that exact span/class through rehype-raw + rehype-sanitize.
describe('renderMdxToHtml — accent emphasis', () => {
  it('keeps a `<span class="accent-emphasis">` from raw inline HTML', async () => {
    const { html } = await renderMdxToHtml('Some <span class="accent-emphasis">text</span>.');
    expect(html).toContain('<span class="accent-emphasis">text</span>');
  });

  it('strips a non-allowlisted class on a span', async () => {
    const { html } = await renderMdxToHtml('<span class="evil">x</span>');
    expect(html).not.toContain('evil');
  });

  // Regression (found 2026-07-25): unlike bold/italic/strike, layering inline code onto an
  // accent-emphasis span doesn't corrupt the surrounding markdown (a code span's content is
  // never re-parsed, so no flanking-rule issue) — but nesting the *reverse* way, an
  // accent-emphasis span inside a code span, is still broken: code-span content is always
  // literal, so the span tags show up as escaped `&lt;span…&gt;` text instead of an element.
  // accentEmphasis's `excludes: '… code'` (accent-emphasis-extension.ts) stops the editor from
  // ever producing this nesting; this pins the underlying markdown-level reason why.
  it('does not parse a span nested inside a code span — it stays literal text', async () => {
    const { html } = await renderMdxToHtml('`<span class="accent-emphasis">a</span>`');
    expect(html).toContain('&#x3C;span class="accent-emphasis">a&#x3C;/span>');
    expect(html).not.toContain('<span class="accent-emphasis">');
  });
});

// The Zenn/Qiita ```lang:filename fence: remarkCodeFilename splits the colon so the language
// still highlights and the filename becomes a pretty-code title bar (figcaption).
describe('renderMdxToHtml — code block filename', () => {
  it('renders ```lang:filename as a highlighted block with a title figcaption', async () => {
    const { html } = await renderMdxToHtml('```ts:index.ts\nconst x = 1;\n```');
    // pretty-code emits the filename in a <figcaption data-rehype-pretty-code-title>.
    expect(html).toContain('data-rehype-pretty-code-title');
    expect(html).toContain('index.ts');
    // The block still highlights as TS (pretty-code wraps it in its figure), and the raw
    // `ts:index.ts` info string never leaks into a bogus language class.
    expect(html).toContain('data-rehype-pretty-code-figure');
    expect(html).not.toContain('index.ts"><code'); // no `language-ts:index.ts`-style leak
  });

  it('leaves a plain ```lang fence without a title', async () => {
    const { html } = await renderMdxToHtml('```ts\nconst x = 1;\n```');
    expect(html).toContain('data-rehype-pretty-code-figure');
    expect(html).not.toContain('data-rehype-pretty-code-title');
  });
});

// A GFM pipe table is what the editor stores whenever it can (components/editor/table-extensions.ts);
// the raw-HTML fallback it drops to otherwise loses column alignment on this path, because sanitize
// strips the inline `text-align` the fallback carries. Both halves are pinned here: the alignment a
// pipe table keeps, and the `<br>` a cell needs to hold two lines — the shape tablePasteRepair
// produces when a multi-paragraph paste lands in a cell, and the one Shift+Enter makes by hand.
describe('renderMdxToHtml — GFM pipe tables', () => {
  it('keeps a column alignment as an align attribute', async () => {
    const { html } = await renderMdxToHtml('| A | B |\n| :-: | --- |\n| x | y |\n');
    expect(html).toContain('<th align="center">A</th>');
    expect(html).toContain('<td align="center">x</td>');
    // The semantics the fallback has no way to express.
    expect(html).toContain('<thead>');
  });

  it('keeps a <br> inside a cell', async () => {
    const { html } = await renderMdxToHtml('| A | B |\n| --- | --- |\n| x<br>y | z |\n');
    expect(html).toMatch(/<td>x<br\s*\/?>y<\/td>/);
  });
});

// The post page's table of contents (app/posts/[slug]/page.tsx) is built from this, not from
// re-parsing the rendered HTML — so the id rehype-slug assigns and the id collected here must
// be the exact same one the heading renders with.
describe('renderMdxToHtml — table of contents', () => {
  it('collects h2/h3 headings with slugged ids, in document order', async () => {
    const { html, toc } = await renderMdxToHtml('## First\n\n### Nested\n\n## Second\n');
    // rehype-sanitize's GitHub schema clobber-prefixes every id (DOM-clobbering defense) —
    // the collected id must be this final, post-sanitize form, not the raw slug.
    expect(toc).toEqual([
      { id: 'user-content-first', text: 'First', level: 2 },
      { id: 'user-content-nested', text: 'Nested', level: 3 },
      { id: 'user-content-second', text: 'Second', level: 2 },
    ]);
    expect(html).toContain('<h2 id="user-content-first">First</h2>');
  });

  it('dedupes identical heading text the same way the rendered ids do', async () => {
    const { html, toc } = await renderMdxToHtml('## Same\n\n## Same\n');
    expect(toc.map((t) => t.id)).toEqual(['user-content-same', 'user-content-same-1']);
    expect(html).toContain('id="user-content-same-1"');
  });

  it('returns an empty list when there are no headings', async () => {
    const { toc } = await renderMdxToHtml('Just a paragraph.\n');
    expect(toc).toEqual([]);
  });

  // docs/accordion-requirements.md §8.1: the table of contents lists what a reader can see, and an
  // accordion's contents are folded away by the author's choice. Leaving them out also keeps the
  // default navigation off a route whose behaviour is the browser's to decide — whether following
  // a fragment into a closed <details> expands it is not uniform.
  it('leaves out headings folded inside an accordion, keeping the rest', async () => {
    const { html, toc } = await renderMdxToHtml(
      '## 見える見出し\n\n<details>\n<summary>畳んだ節</summary>\n\n## 畳まれた見出し\n\n### 深いほう\n\n</details>\n\n## 続き\n',
    );
    expect(toc.map((t) => t.text)).toEqual(['見える見出し', '続き']);
    // The id is still assigned, so an in-page or external anchor into the fold resolves.
    expect(html).toContain('id="user-content-畳まれた見出し"');
  });

  // docs/footnote-requirements.md §8. remark-gfm labels the footnote section with its own
  // screen-reader-only `<h2>Footnotes</h2>`, which the collector had no reason to filter until the
  // editor started saving real footnote syntax — a Japanese post's contents would otherwise gain an
  // English entry the author never wrote.
  it('leaves the footnote section out of the table of contents', async () => {
    const { html, toc } = await renderMdxToHtml('## 見出し\n\n本文[^1]\n\n[^1]: 注釈\n');

    expect(toc.map((t) => t.text)).toEqual(['見出し']);
    // The section is still rendered, and its heading still carries an id — only the contents skip it.
    expect(html).toContain('id="user-content-footnote-label"');
  });
});

// Sanitize renames every id (`user-content-` clobber prefix) but never touches an href, so an
// in-page link and its target used to drift apart and jump nowhere. rehypeClobberFragmentLinks
// applies the same rename to fragment hrefs; these pin that the two halves still meet.
describe('renderMdxToHtml — in-page links', () => {
  it('points a link at a heading at the id that heading actually renders with', async () => {
    const { html } = await renderMdxToHtml('## Intro\n\n[to intro](#intro)\n');
    expect(html).toContain('<h2 id="user-content-intro">Intro</h2>');
    expect(html).toContain('href="#user-content-intro"');
  });

  it('keeps a non-ASCII fragment percent-encoded while prefixing it', async () => {
    // remark encodes the href but not the id; browsers decode a fragment before matching it,
    // so the prefix has to go in front of the encoding rather than through it.
    const { html } = await renderMdxToHtml('## 導入\n\n[導入へ](#導入)\n');
    expect(html).toContain('<h2 id="user-content-導入">導入</h2>');
    expect(html).toContain('href="#user-content-%E5%B0%8E%E5%85%A5"');
  });

  it('leaves an external link and a bare `#` alone', async () => {
    const { html } = await renderMdxToHtml('[x](https://example.com/#frag) [y](#)\n');
    expect(html).toContain('href="https://example.com/#frag"');
    expect(html).toContain('href="#"');
  });

  it('links a GFM footnote to its definition and back', async () => {
    // remark-gfm gives footnotes for free; what needed fixing was that to-hast pre-prefixed
    // them and sanitize then prefixed the id a second time, orphaning both jumps.
    const { html } = await renderMdxToHtml('Body[^1].\n\n[^1]: The note.\n');
    expect(html).toContain('href="#user-content-fn-1"');
    expect(html).toContain('id="user-content-fn-1"');
    // …and the ↩ backref, the other direction.
    expect(html).toContain('href="#user-content-fnref-1"');
    expect(html).toContain('id="user-content-fnref-1"');
    expect(html).not.toContain('user-content-user-content-');
    // The section chrome, which the schema does NOT get from the div/p/span edit above but
    // from defaultSchema's own footnote entries — pinned so the narrow `['className', …]`
    // value allowlists there can't quietly displace them.
    expect(html).toContain('<section data-footnotes="" class="footnotes">');
    expect(html).toContain('<h2 class="sr-only"');
    expect(html).toContain('class="data-footnote-backref"');
  });

  it('gives two references to one note the same number and two backrefs', async () => {
    // docs/footnote-requirements.md §6.2 — the editor makes these now (copy-and-paste of a
    // reference shares its definition), so the published side has to hold up. It needs nothing:
    // remark-gfm numbers both `1`, distinguishes only the reference ids, and writes a backref per
    // reference. Pinned because the pipeline's own footnote handling is the whole implementation —
    // if a future clobber or sanitize edit broke the second id, nothing else would notice.
    const { html } = await renderMdxToHtml('One[^a] and two[^a].\n\n[^a]: The note.\n');

    expect(html).toContain('id="user-content-fnref-a"');
    expect(html).toContain('id="user-content-fnref-a-2"');
    // One definition, pointed at twice.
    expect(html.match(/href="#user-content-fn-a"/g)).toHaveLength(2);
    expect(html.match(/id="user-content-fn-a"/g)).toHaveLength(1);
    // …and a way back from each, the second marked `↩2`.
    expect(html).toContain('href="#user-content-fnref-a-2"');
    expect(html).toContain('aria-label="Back to reference 1-2"');
    expect(html).not.toContain('user-content-user-content-');
  });
});

// docs/link-card-requirements.md §9, the rows this side of the feature can measure. A card is
// stored as a reference and nothing else — `<div class="link-card" data-href="/posts/…">` — so
// everything a reader sees is built here, at render time, from whatever `resolveCard` reports.
//
// The security shape is the point of most of these. `data-href` is allowed on the sanitize schema
// as a bare property name, so any value passes it (§4.4), and rehypeLinkCard runs *after*
// sanitize, so the `<a href>` it emits never meets the protocol check either. The reference is
// therefore validated by the stage itself, and that is what 2c/2d pin.
describe('renderMdxToHtml — link cards', () => {
  const CARD = '<div class="link-card" data-href="/posts/abc123"></div>';

  // Stands in for the DB. The real one closes over getPostBySlug (app/posts/[slug]/page.tsx);
  // this is the whole reason the resolver is injected rather than imported (§6, criterion 5a).
  const resolveCard = async (href: string) =>
    href === '/posts/abc123' ? { title: '参照先の記事', description: '説明文', image: null } : null;

  it('resolves a stored reference into a card (2a)', async () => {
    const { html } = await renderMdxToHtml(CARD, { resolveCard });
    expect(html).toContain('<a class="link-card" href="/posts/abc123" target="_blank">');
    expect(html).toContain('<span class="link-card-title">参照先の記事</span>');
    expect(html).toContain('<span class="link-card-description">説明文</span>');
    // Title and description are the card's text: the target's date was dropped 2026-08-15
    // (lib/rehype-link-card.ts carries the reason). `.link-card-meta` still exists for the editor's
    // NodeView, which says there that the target is a draft or cannot be found (§13.1), so its
    // absence here is asserted rather than assumed.
    expect(html).not.toContain('link-card-meta');
    // This resolver answers with no picture, and the stage then draws no <img> at all rather than
    // an empty box — the text column is the whole card. In production that answer comes from an
    // external target with no og:image: an internal card always carries a picture, the site's own
    // mark when the post has none, and the resolver is what decides that (§17, the test below).
  });

  it('puts the target’s image beside the text when it has one', async () => {
    const withImage = async () => ({
      title: '絵のある記事',
      description: '説明文',
      image: { src: '/uploads/8c3a2ce41540e56801a3.png', placeholder: false },
    });
    const { html } = await renderMdxToHtml(CARD, { resolveCard: withImage });
    expect(html).toContain('<img class="link-card-image" src="/uploads/8c3a2ce41540e56801a3.png"');
    // Empty alt: the title sits inside the same <a>, so a described image would be read twice.
    expect(html).toContain('alt=""');
    // The text is wrapped in its own column, which is what keeps the description clamped to the
    // column rather than the card. Both with and without an image, so the shape does not shift.
    expect(html).toContain('<span class="link-card-text">');
  });

  it('marks the house placeholder so the card can draw it differently (17a)', async () => {
    // §17. A post with neither a chosen thumbnail nor an image in its body resolves to this site's
    // own mark, and the card has to paint it as a mark on a tint rather than crop it to fill the
    // frame. The second class is the whole of how the stylesheet tells the two apart, and it comes
    // from the resolver's flag — not from a test on the src here, which would break the moment the
    // file is renamed.
    const houseMark = async () => ({
      title: '絵のない記事',
      description: '説明文',
      image: { src: CARD_PLACEHOLDER_SRC, placeholder: true },
    });
    const { html } = await renderMdxToHtml(CARD, { resolveCard: houseMark });
    expect(html).toContain(
      `<img class="link-card-image link-card-placeholder" src="${CARD_PLACEHOLDER_SRC}"`,
    );
    // Still decorative: the mark names this blog, which the card already points at.
    expect(html).toContain('alt=""');
    // The mark is the site's name in the foreground colour, so it has a file per scheme and the
    // page chooses (§17.3). The `<img>`'s own src stays the light file — that is the fallback for
    // anything that ignores `<source>`, and asserting both is what keeps the pair from collapsing
    // into "the dark one only".
    expect(html).toContain(
      `<picture><source media="(prefers-color-scheme: dark)" srcset="${CARD_PLACEHOLDER_DARK_SRC}">`,
    );
  });

  it('leaves the second class off a picture the target owns (17a)', async () => {
    // The other half: a real picture must not be painted on the tint. Mutating `placeholder` to a
    // constant `true` takes this one red and the one above green, which is what makes the pair
    // measure the flag rather than the class name.
    const withImage = async () => ({
      title: '絵のある記事',
      description: '',
      image: { src: '/uploads/8c3a2ce41540e56801a3.png', placeholder: false },
    });
    const { html } = await renderMdxToHtml(CARD, { resolveCard: withImage });
    expect(html).toContain('<img class="link-card-image" src="/uploads/');
    expect(html).not.toContain('link-card-placeholder');
    // And no wrapper: a photograph has one file, so there is nothing for a `<source>` to choose.
    expect(html).not.toContain('<picture>');
  });

  it('survives sanitize with the image intact (2a)', async () => {
    // The stage runs after rehype-sanitize, so nothing it emits meets the schema — this pins that
    // the ordering still holds for the <img>, which is the one element here a schema would care
    // about. If the stage were ever moved before sanitize, this is what goes red.
    const withImage = async () => ({
      title: 'T',
      description: '',
      image: { src: '/uploads/a.png', placeholder: false },
    });
    const { html } = await renderMdxToHtml(CARD, { resolveCard: withImage });
    expect(html).toContain('src="/uploads/a.png"');
    expect(html).toContain('class="link-card-image"');
  });

  it('reads the title from the resolver, not from the stored markdown (1b/1c)', async () => {
    // The stored form holds no display text at all, so a renamed post shows its new title with
    // no rewrite of any body that links to it. Same source, a different resolver, a different
    // title — which is the round-trip claim §4.2 makes, measured at the only place it can be.
    const renamed = async () => ({ title: '改題後', description: '', image: null });
    const { html } = await renderMdxToHtml(CARD, { resolveCard: renamed });
    expect(html).toContain('改題後');
    expect(CARD).not.toContain('改題後');
    // An empty description contributes no empty span — the card is its title alone.
    expect(html).not.toContain('link-card-description');
  });

  it('keeps `class` and `data-href` through sanitize (2a)', async () => {
    // Without the schema edit both are stripped and the card arrives at the stage as a bare
    // <div>, which resolves to nothing — i.e. it fails silently. Measured by rendering with no
    // resolver, where a card that survived sanitize still becomes the fallback link.
    const { html } = await renderMdxToHtml(CARD);
    // Asserted on the produced `<a>`, not on `href="/posts/abc123"` alone: the stored
    // `data-href="…"` contains that substring verbatim, so the looser check passes even when the
    // stage never saw the card.
    expect(html).toContain('<a href="/posts/abc123">');
    expect(html).not.toContain('<div');
  });

  it('does not let the new div allowlist widen what else passes (2b)', async () => {
    // `link-card` shares one `['className', …]` tuple with the alert classes — hast-util-sanitize
    // returns on the first entry matching an attribute name, so a second tuple would be dead.
    // This pins that merging them broke neither side, and that the list is still exact.
    const { html } = await renderMdxToHtml(
      '<div class="evil">x</div>\n\n> [!NOTE]\n> ok\n\n<div class="link-card" data-href="/posts/abc123"></div>',
    );
    expect(html).toContain('markdown-alert markdown-alert-note');
    expect(html).toContain('<div class="markdown-alert-content">');
    expect(html).not.toContain('evil');
  });

  it('refuses a hand-written javascript: reference (2c)', async () => {
    // The §4.4 hole. `html: true` in the editor and rehype-raw here mean an author can type this
    // literally, and no protocol check stands between it and the output — so the stage's own
    // shape test is the only thing that stops it. It must not become a link of any kind.
    const { html } = await renderMdxToHtml(
      '<div class="link-card" data-href="javascript:alert(1)"></div>',
      { resolveCard },
    );
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<a');
  });

  it('refuses references that are neither shape the stage accepts (2c/2d)', async () => {
    // Neither `/posts/<slug>` nor an absolute http(s) URL (§14.2). `https://evil.example` is NOT
    // in this list any more: an external URL is a legitimate reference since 2026-08-18 and gets
    // the fallback link when nothing has been stored about it — see the external-card block below.
    for (const href of [
      // Protocol-relative, so `new URL()` cannot parse it without a base and the internal test
      // refuses the leading `//` — it is the shape that looks same-origin and is not.
      '//evil.example/posts/x',
      '/admin/posts/1',
      '/posts/../admin',
      // Passes a naive `[\w.~-]+` slug class and resolves to the site root, not a post.
      '/posts/..',
    ]) {
      const { html } = await renderMdxToHtml(`<div class="link-card" data-href="${href}"></div>`, {
        resolveCard,
      });
      expect(html, href).not.toContain('<a');
      expect(html, href).not.toContain('evil.example');
    }
  });

  it('falls back to a plain link for an unknown slug (2d)', async () => {
    const { html } = await renderMdxToHtml(
      '<div class="link-card" data-href="/posts/gone"></div>',
      {
        resolveCard,
      },
    );
    expect(html).toContain('<a href="/posts/gone">/posts/gone</a>');
    expect(html).not.toContain('class="link-card"');
    // Unwrapped, like the resolved card: the stage can't see the parent, and a `<p>` is not legal
    // everywhere a `<div>` was.
    expect(html).not.toContain('<p><a href="/posts/gone">');
  });

  it('falls back to a plain link for a draft, which resolves the same as unknown (2e)', async () => {
    // getPostBySlug returns null for a draft (lib/posts.ts), so the resolver cannot tell the two
    // apart and neither does this. Pinned separately from 2d because it is a different authoring
    // mistake with the same rendering, and §6.1 chose that on purpose.
    const draftOnly = async () => null;
    const { html } = await renderMdxToHtml(CARD, { resolveCard: draftOnly });
    expect(html).toContain('<a href="/posts/abc123">/posts/abc123</a>');
  });

  it('leaves headings, the toc and in-page links untouched around a card', async () => {
    // Pins the stage's position (§10): it runs last, after pretty-code, and nothing it does can
    // reach rehypeCollectToc (headings only) or rehypeClobberFragmentLinks (`#…` hrefs only).
    // Worth measuring rather than arguing, since a card DOES emit an `<a href>` — the one output
    // shape a fragment-link rewrite could in principle have touched.
    const { html, toc } = await renderMdxToHtml(
      `## 導入\n\n${CARD}\n\n[導入へ](#導入)\n\n\`\`\`ts\nconst x = 1;\n\`\`\`\n`,
      { resolveCard },
    );
    expect(toc).toEqual([{ id: 'user-content-導入', text: '導入', level: 2 }]);
    expect(html).toContain('href="#user-content-%E5%B0%8E%E5%85%A5"');
    // The card's own href is a path, not a fragment, so the rewrite left it alone.
    expect(html).toContain('<a class="link-card" href="/posts/abc123" target="_blank">');
    // …and pretty-code still ran on the fence below it.
    expect(html).toContain('data-rehype-pretty-code-figure');
  });

  it('resolves several cards in one document independently', async () => {
    // The stage collects first and splices after, so an earlier replacement must not shift a
    // later one's index — and a removal (the javascript: card) shifts the list hardest.
    const { html } = await renderMdxToHtml(
      `${CARD}\n\n<div class="link-card" data-href="javascript:alert(1)"></div>\n\n<div class="link-card" data-href="/posts/gone"></div>\n\n${CARD}\n`,
      { resolveCard },
    );
    expect(html.match(/<a class="link-card"/g)).toHaveLength(2);
    expect(html.match(/<a href="\/posts\/gone">/g)).toHaveLength(1);
    expect(html).not.toContain('javascript:');
  });
});

// docs/link-card-requirements.md §14.9, the rows this side can measure. An external card is the
// same node, the same class and the same `data-href` (§14.2); what changes is that the reference
// may be an absolute URL, that the resolver reads a stored row instead of `posts`, and that the
// card gains a provenance line and loses the image.
//
// **The reader's request never fetches anything** (§14.1). Nothing in this file could tell the
// difference on its own, so the criterion is pinned where it is decided instead: the resolver is
// injected, and the published page hands over one that only reads (app/posts/[slug]/page.tsx).
// What is measured here is that the stage asks the resolver and nothing else — a card whose URL
// has no row renders the fallback link rather than reaching for the page.
describe('renderMdxToHtml — external link cards', () => {
  const CARD = '<div class="link-card" data-href="https://example.com/article"></div>';
  const resolveCard = async (href: string) =>
    href === 'https://example.com/article'
      ? { title: '外部の記事', description: '外部の説明', image: null }
      : null;

  it('resolves an absolute URL into a card carrying the target’s host (14i)', async () => {
    const { html } = await renderMdxToHtml(CARD, { resolveCard });
    expect(html).toContain(
      '<a class="link-card" href="https://example.com/article" target="_blank">',
    );
    expect(html).toContain('<span class="link-card-title">外部の記事</span>');
    expect(html).toContain('<span class="link-card-description">外部の説明</span>');
    // The provenance line §12 left empty while every card pointed at this blog (§14.4). It is
    // built from the reference, not from the resolver's answer, so it cannot disagree with where
    // the click actually goes.
    expect(html).toContain('<span class="link-card-domain">example.com</span>');
  });

  it('drops a leading `www.` from the host line (14i)', async () => {
    const withWww = async () => ({ title: 'T', description: '', image: null });
    const { html } = await renderMdxToHtml(
      '<div class="link-card" data-href="https://www.example.com/a"></div>',
      { resolveCard: withWww },
    );
    expect(html).toContain('<span class="link-card-domain">example.com</span>');
    // Only the display is shortened. The href is the reference as stored, which is what the
    // author wrote and what was fetched.
    expect(html).toContain('href="https://www.example.com/a"');
  });

  it('shows the target’s picture through this site, never from its CDN (14j)', async () => {
    // §14.4: the card does show the target's og:image, but the `<img src>` is this site's own
    // signed proxy path — the value the resolver hands over is what app/posts/[slug]/page.tsx
    // builds with `linkImageSrc`. What must never appear here is the third party's URL: that would
    // be hotlinking, which lib/thumbnail.ts refuses in the same words.
    const withImage = async () => ({
      title: '外部の記事',
      description: '',
      image: {
        src: '/api/link-image?url=https%3A%2F%2Fcdn.example%2Fa.png&sig=0123456789abcdef0123',
        placeholder: false,
      },
    });
    const { html } = await renderMdxToHtml(CARD, { resolveCard: withImage });
    expect(html).toContain('<img class="link-card-image" src="/api/link-image?url=');
    // Same empty alt as the internal card: the title is inside the same anchor.
    expect(html).toContain('alt=""');
    // The target's own host appears only inside the encoded `url=` parameter — never as an src a
    // browser would connect to.
    expect(html).not.toContain('src="https://cdn.example');
  });

  it('carries no image when the target has none (14j)', async () => {
    // A page with no og:image, or one the proxy could not fetch when the row was written. The card
    // is the text column alone rather than an empty frame, which is what §12 settled.
    const { html } = await renderMdxToHtml(CARD, { resolveCard });
    expect(html).not.toContain('link-card-image');
    expect(html).not.toContain('<img');
  });

  it('falls back to a plain link when nothing is stored about the URL (14d)', async () => {
    // The row is missing — never resolved in the editor, or the fetch failed. Identical to a draft
    // or an unknown slug on the internal side (§6.1): the reader still gets the link, and the
    // author sees a link where they expected a card.
    const { html } = await renderMdxToHtml(CARD, { resolveCard: async () => null });
    expect(html).toContain(
      '<a href="https://example.com/article" target="_blank">https://example.com/article</a>',
    );
    expect(html).not.toContain('link-card-title');
    expect(html).not.toContain('<div');
  });

  it('refuses a scheme that is not http(s) (14e)', async () => {
    // The allowlist, from the other direction. These parse as URLs — `new URL()` accepts every one
    // — so only the scheme test stands between them and an `<a href>` this stage builds after
    // sanitize has already run (§4.4).
    for (const href of [
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'file:///etc',
    ]) {
      const { html } = await renderMdxToHtml(`<div class="link-card" data-href="${href}"></div>`, {
        resolveCard,
      });
      expect(html, href).not.toContain('<a');
      expect(html, href).not.toContain('link-card-domain');
    }
  });

  it('keeps an internal card free of the host line (14i)', async () => {
    // The two kinds share every mechanism but this: a card pointing at this blog has nothing to
    // say about provenance, which is why §12 dropped the line rather than filling it with a date.
    const internal = async () => ({ title: '内部の記事', description: '', image: null });
    const { html } = await renderMdxToHtml(
      '<div class="link-card" data-href="/posts/abc123"></div>',
      { resolveCard: internal },
    );
    expect(html).toContain('link-card-title');
    expect(html).not.toContain('link-card-domain');
  });
});

// docs/embed-requirements.md §6 and §9.5, the rows the published side can measure. An embed is
// stored as a reference and nothing else — `<div class="embed" data-href="…">` — and the stage that
// resolves it runs AFTER rehype-sanitize, which is what these pin: `<iframe>` is not in the schema,
// so the element below can only exist because it is built where sanitize can no longer reach it,
// and the `src` it carries therefore meets no protocol check anywhere (§4.2).
describe('renderMdxToHtml / embed', () => {
  const ID = 'hDPybQwAuVo';
  const resolveCard = async (href: string) =>
    href === '/posts/abc123' ? { title: '参照先の記事', description: '説明文', image: null } : null;

  it('turns a stored reference into a lazily-loaded nocookie iframe (Y1)', async () => {
    const { html } = await renderMdxToHtml(
      `<div class="embed" data-href="https://www.youtube.com/watch?v=${ID}&amp;t=90"></div>`,
    );
    expect(html).toContain('class="embed embed-youtube"');
    expect(html).toContain(`src="https://www.youtube-nocookie.com/embed/${ID}?start=90"`);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('allowfullscreen');
    // §10.8. Measured on X, applied to every provider — and a headless browser cannot see the bar
    // it removes (overlay scrollbars report a width of 0), so the attribute is what is asserted.
    expect(html).toContain('scrolling="no"');
    // No fetch runs, so the name is generic on purpose (§8-②) — but it is present.
    expect(html).toContain('title="YouTube 動画"');
  });

  it('keeps the class through sanitize (E4)', async () => {
    // `embed` shares the `div` className tuple with the alert classes and `link-card`; dropped from
    // it, the class is stripped and the stage below sees an ordinary div. Asserting the iframe is
    // not enough on its own, so the stored class is asserted where it survives: an unresolvable
    // reference keeps the div nowhere, so this measures the resolved one reaching the stage at all.
    const { html } = await renderMdxToHtml(
      `<div class="embed" data-href="https://youtu.be/${ID}"></div>\n\n<div class="evil">x</div>`,
    );
    expect(html).toContain('<iframe');
    expect(html).not.toContain('evil');
  });

  it('refuses a hand-written javascript: reference (E2)', async () => {
    // The same §4.4 hole the card has, one step worse: what this stage builds is an iframe, and
    // nothing downstream checks its src. **Both exits have to refuse it** — the iframe and the
    // plain-link fallback, which is published markup built after sanitize as well. The fallback was
    // the one that let it through until this test was written.
    for (const href of ['javascript:alert(1)', 'data:text/html,x', '//evil.example/x']) {
      const { html } = await renderMdxToHtml(`<div class="embed" data-href="${href}"></div>`);
      expect(html, href).not.toContain('<iframe');
      expect(html, href).not.toContain('<a');
      expect(html, href).not.toContain('evil.example');
    }
  });

  it('falls back to a plain link for what names no single video (Y4)', async () => {
    for (const href of [
      'https://www.youtube.com/playlist?list=PLabc',
      'https://www.youtube.com/@handle',
      'https://example.com/article',
    ]) {
      const { html } = await renderMdxToHtml(`<div class="embed" data-href="${href}"></div>`, {});
      expect(html, href).not.toContain('<iframe');
      expect(html, href).toContain(`<a href="${href}" target="_blank">`);
    }
  });

  it('does not take the page down on a broken percent-escape (E3)', async () => {
    const { html } = await renderMdxToHtml(
      '<div class="embed" data-href="https://www.youtube.com/watch?v=%zz"></div>',
    );
    expect(html).not.toContain('<iframe');
  });

  it("does not touch an author's own div that happens to carry the class", async () => {
    // `embed` is an ordinary word. The stage claims only a div that carries `data-href`, because a
    // hand-written `<div class="embed">` collected and then dropped would take its children with
    // it — content vanishing from the published page with no trace.
    const { html } = await renderMdxToHtml('<div class="embed">著者の本文</div>');
    expect(html).toContain('著者の本文');
  });

  it('leaves the link card alone (§4)', async () => {
    // The two stages read disjoint classes. A card in the same body must still be a card, which is
    // what keeps "one node per class" more than a statement about the document format.
    const { html } = await renderMdxToHtml(
      `<div class="link-card" data-href="/posts/abc123"></div>\n\n<div class="embed" data-href="https://youtu.be/${ID}"></div>`,
      { resolveCard },
    );
    expect(html).toContain('<a class="link-card" href="/posts/abc123" target="_blank">');
    expect(html).toContain('<iframe');
  });

  // docs/embed-requirements.md §10. `2089798442306711646` is the post measured in §10.1.
  const POST = 'https://x.com/ClaudeDevs/status/2089798442306711646';

  it('turns a post reference into an iframe the browser can address (X1)', async () => {
    const { html } = await renderMdxToHtml(`<div class="embed" data-href="${POST}"></div>`);
    expect(html).toContain('class="embed embed-x"');
    expect(html).toContain(
      'src="https://platform.twitter.com/embed/Tweet.html?id=2089798442306711646&#x26;lang=ja&#x26;embedId=emb-0"',
    );
    // The client needs both to do its work: the name the provider will answer to, and the
    // reference to build the fallback link from (§10.6). Neither is reconstructible from the src.
    expect(html).toContain('data-embed-id="emb-0"');
    expect(html).toContain(`data-href="${POST}"`);
    // The provider this one was measured on (§10.8).
    expect(html).toContain('scrolling="no"');
  });

  it('names each placement distinctly, so two posts are told apart (§10.5)', async () => {
    // Without this every iframe answers to `embed-0` and the parent cannot route a `resize`.
    const { html } = await renderMdxToHtml(
      `<div class="embed" data-href="${POST}"></div>\n\n<div class="embed" data-href="${POST}"></div>`,
    );
    expect(html).toContain('embedId=emb-0');
    expect(html).toContain('embedId=emb-1');
  });

  it('leaves the account URL to the card, as a plain link here (X2)', async () => {
    // A profile becomes a card upstream; reaching this stage at all means someone hand-wrote it,
    // and the answer is the same one every unclaimed reference gets.
    const { html } = await renderMdxToHtml(
      '<div class="embed" data-href="https://x.com/ClaudeDevs"></div>',
    );
    expect(html).not.toContain('<iframe');
    expect(html).toContain('<a href="https://x.com/ClaudeDevs" target="_blank">');
  });

  // docs/embed-requirements.md §14. `260753333` is the deck measured there.
  const DECK = 'https://www.slideshare.net/slideshow/slidesharesample-260753333/260753333';

  it('turns a deck reference into the id form of the embed URL (S5)', async () => {
    const { html } = await renderMdxToHtml(`<div class="embed" data-href="${DECK}"></div>`);
    // The class the aspect-ratio rule hangs on, and the src the reader's browser redirects from.
    expect(html).toContain('class="embed embed-slideshare"');
    expect(html).toContain('src="https://www.slideshare.net/slideshow/embed_code/260753333"');
    // Full screen is the attribute's business (§14.4), and `allow` is empty for this provider.
    expect(html).toContain('allow="" allowfullscreen');
    // Nothing listens for this one, so no client behaviour hangs off the id — but both stages mint
    // it for every embed, and a missing attribute would be a difference between the two.
    expect(html).toContain('data-embed-id="emb-0"');
  });

  it('leaves a SlideShare URL that names no deck to the card, as a plain link here (S2)', async () => {
    const href = 'https://www.slideshare.net/HubSpot/2024-state-of-marketing-report-by-hubspot';
    const { html } = await renderMdxToHtml(`<div class="embed" data-href="${href}"></div>`);
    expect(html).not.toContain('<iframe');
    expect(html).toContain(`<a href="${href}" target="_blank">`);
  });

  // docs/embed-requirements.md §15. `7or4V8Tl8YbEFRmMSF3pXe` is the file measured there.
  const DESIGN = 'https://www.figma.com/design/7or4V8Tl8YbEFRmMSF3pXe/Figma-sample?node-id=5-2&p=f';

  it('turns a design reference into the key form of the embed URL (F6)', async () => {
    const { html } = await renderMdxToHtml(`<div class="embed" data-href="${DESIGN}"></div>`);
    // The class the aspect-ratio rule hangs on, and the src the reader's browser redirects from.
    expect(html).toContain('class="embed embed-figma"');
    expect(html).toContain(
      'src="https://embed.figma.com/design/7or4V8Tl8YbEFRmMSF3pXe?embed-host=tech-blog&#x26;node-id=5-2"',
    );
    // Full screen is the attribute's business (§15.3), and `allow` is empty for this provider.
    expect(html).toContain('allow="" allowfullscreen');
  });

  it('leaves a Figma URL that names no file to the card, as a plain link here (F3)', async () => {
    const href = 'https://www.figma.com/proto/7or4V8Tl8YbEFRmMSF3pXe/Figma-sample?node-id=5-2';
    const { html } = await renderMdxToHtml(`<div class="embed" data-href="${href}"></div>`);
    expect(html).not.toContain('<iframe');
    expect(html).toContain(`<a href="${href}" target="_blank">`);
  });

  // docs/embed-requirements.md §16. `9de2f18094b14cbb91b07331eb085e4f` is the deck measured there.
  const SLIDES = 'https://speakerdeck.com/player/9de2f18094b14cbb91b07331eb085e4f';

  it('publishes a Speaker Deck player reference as the iframe (SD5)', async () => {
    const { html } = await renderMdxToHtml(`<div class="embed" data-href="${SLIDES}"></div>`);
    // The class the aspect-ratio rule hangs on, and the src — which is the reference itself here,
    // rebuilt from the id rather than passed through (§16.3).
    expect(html).toContain('class="embed embed-speakerdeck"');
    expect(html).toContain(`src="${SLIDES}"`);
    // Full screen is the attribute's business (§16.4), and `allow` is empty for this provider.
    expect(html).toContain('allow="" allowfullscreen');
  });

  it('leaves the deck page URL to the card, as a plain link here (SD2)', async () => {
    // **The shape an author reaches for first**, and the one that cannot become an embed: the id
    // is nowhere in it (§16.2). Getting a link rather than a silent gap is the whole of what this
    // measures.
    const href = 'https://speakerdeck.com/soudai/pgcon21j-tutorial';
    const { html } = await renderMdxToHtml(`<div class="embed" data-href="${href}"></div>`);
    expect(html).not.toContain('<iframe');
    expect(html).toContain(`<a href="${href}" target="_blank">`);
  });

  it('publishes the fallback anchor in exactly the shape the client must reproduce (X5)', async () => {
    // **One surface, two code paths** (§10.6). This one is built here, before rehypeNewTabLinks;
    // the other is built in the reader's browser after `no_results`, with no later stage to add
    // `target`. `lib/embed-fallback.ts` is what both are derived from, so this pins the render-time
    // path against it — the client path is pinned by construction, since it calls it.
    const href = 'https://example.com/article';
    const { html } = await renderMdxToHtml(`<div class="embed" data-href="${href}"></div>`);
    const spec = embedFallbackAnchor(href);
    const anchor = /<a\s[^>]*href="https:\/\/example\.com\/article"[^>]*>[^<]*<\/a>/.exec(html);
    expect(anchor?.[0]).toBe(`<a href="${spec.href}" target="${spec.target}">${spec.text}</a>`);
    // No `rel`: a modern browser implies `noopener`, and `noreferrer` would withhold what §7
    // refuses to withhold (lib/rehype-new-tab-links.ts).
    expect(anchor?.[0]).not.toContain('rel=');
  });
});

// docs/link-requirements.md §7.2 — the stage that opens a link leaving this site in a new tab. It
// is the last one in the pipeline, so what these measure is a single rule applied to anchors from
// four different sources: the author's markdown, the author's raw HTML, and the two stages that
// build anchors of their own (a card, and either stage's fallback link).
//
// The half that carries the risk is what must NOT get it. Every link that stays on this site is a
// relative path or a fragment (§2.3), so the generated table of contents, footnote references and
// their backrefs all sit outside a test written on the href's scheme — which is why the criterion
// is "starts with http(s)" and not a comparison against `siteOrigin` (§7.2 item 1).
describe('renderMdxToHtml — external links open in a new tab', () => {
  const resolveCard = async (href: string) =>
    href === '/posts/abc123'
      ? { title: '参照先の記事', description: '説明文', image: null }
      : href === 'https://example.com/a'
        ? { title: '外部の記事', description: '外部の説明', image: null }
        : null;

  it('opens an external link, written or autolinked, in a new tab (11a)', async () => {
    const { html } = await renderMdxToHtml(
      '[x](https://example.com/a)\n\nhttps://example.com/b\n\nwww.example.com/c\n',
    );
    expect(html).toContain('<a href="https://example.com/a" target="_blank">');
    expect(html).toContain('<a href="https://example.com/b" target="_blank">');
    // remark-gfm gives a bare `www.` literal an `http://` scheme, so it is external too.
    expect(html).toContain('<a href="http://www.example.com/c" target="_blank">');
  });

  it('leaves an internal link in the same tab (11b)', async () => {
    const { html } = await renderMdxToHtml('[内部](/posts/foo)\n');
    expect(html).toContain('<a href="/posts/foo">');
    expect(html).not.toContain('target=');
  });

  it('leaves the table of contents’ targets and a bare `#` in the same tab (11b)', async () => {
    const { html } = await renderMdxToHtml('## 導入\n\n[導入へ](#導入)\n\n[上へ](#)\n');
    expect(html).toContain('href="#user-content-%E5%B0%8E%E5%85%A5"');
    expect(html).not.toContain('target=');
  });

  it('leaves a hand-written `#user-content-…` fragment in the same tab (11b)', async () => {
    // §2.1.1: copying an href off a published page produces this, and it is indistinguishable from
    // a generated ToC link by its text. Both are outside the test for the same reason — neither
    // starts with a scheme (§7.2 item 2).
    const { html } = await renderMdxToHtml('[戻る](#user-content-導入)\n');
    expect(html).not.toContain('target=');
  });

  it('leaves a footnote reference and its backref in the same tab (11b)', async () => {
    const { html } = await renderMdxToHtml('本文[^1]\n\n[^1]: 注\n');
    expect(html).toContain('href="#user-content-fn-1"');
    expect(html).toContain('href="#user-content-fnref-1"');
    expect(html).not.toContain('target=');
  });

  it('leaves the other schemes sanitize permits in the same tab (11c)', async () => {
    // A new tab for `mailto:` opens a blank one beside the mail client.
    const { html } = await renderMdxToHtml(
      '[mail](mailto:a@example.com) [chat](xmpp:a@example.com)\n',
    );
    expect(html).toContain('href="mailto:a@example.com"');
    expect(html).toContain('href="xmpp:a@example.com"');
    expect(html).not.toContain('target=');
  });

  it('re-adds the target sanitize stripped off raw HTML, and only when external (11d)', async () => {
    // The author still cannot write `target` — sanitize removes it (§2.3), `rel` with it. What the
    // external one ends up with is this stage's own attribute, which is why the internal one below
    // does not get one back.
    const { html } = await renderMdxToHtml(
      '<a href="https://example.com/a" target="_self" rel="opener">x</a>\n\n<a href="/posts/foo" target="_blank">y</a>\n',
    );
    expect(html).toContain('<a href="https://example.com/a" target="_blank">');
    expect(html).toContain('<a href="/posts/foo">');
    expect(html).not.toContain('rel=');
  });

  it('leaves a protocol-relative URL in the same tab — a measurement, not a criterion', async () => {
    // `//example.com` has no scheme, so sanitize passes it as a relative URL and the test above
    // does not match it: it is the one off-site shape that stays in this tab (§7.2 item 1). Pinned
    // because it is the exception to "内部は相対パスか fragment", not because it is wanted — no
    // route in the repo writes this form today.
    const { html } = await renderMdxToHtml('[x](//example.com)\n');
    expect(html).toContain('<a href="//example.com">');
    expect(html).not.toContain('target=');
  });

  it('opens a link card in a new tab wherever it points (11e)', async () => {
    // The internal card is the half that does not follow from the href: a card is a block-level
    // aside standing for a whole other article, and one component behaves one way (§7.2 item 4).
    const { html } = await renderMdxToHtml(
      '<div class="link-card" data-href="https://example.com/a"></div>\n\n<div class="link-card" data-href="/posts/abc123"></div>\n',
      { resolveCard },
    );
    expect(html).toContain('<a class="link-card" href="https://example.com/a" target="_blank">');
    expect(html).toContain('<a class="link-card" href="/posts/abc123" target="_blank">');
  });

  it('does not let an author claim the card rule with raw HTML — a measurement', async () => {
    // The card rule reads a class rather than an href shape, so it is worth pinning that the class
    // is not something an author can put on an anchor. `link-card` is allow-listed on `div`
    // (`divClasses` in lib/render.ts) and nowhere else; the only `className` value the schema lets
    // through on `a` is `data-footnote-backref` (hast-util-sanitize's own `defaultSchema`), so the
    // attribute survives emptied rather than carrying the name. The harm if it passed would be nil
    // — a new tab on an internal link — but §7.2 item 6's "the author is not trusted" claim has to
    // stay measured rather than assumed.
    const { html } = await renderMdxToHtml('<a class="link-card" href="/posts/foo">x</a>\n');
    expect(html).toContain('<a class="" href="/posts/foo">x</a>');
    expect(html).not.toContain('link-card');
    expect(html).not.toContain('target=');
  });

  it('leaves an internal card that resolved to nothing in the same tab (11f)', async () => {
    // A card whose slug is unknown or whose target is a draft renders as a bare `<a>` with no
    // class — it has lost the card's shape, so it is judged as the plain internal link it now is.
    const { html } = await renderMdxToHtml(
      '<div class="link-card" data-href="/posts/gone"></div>\n',
      { resolveCard },
    );
    expect(html).toContain('<a href="/posts/gone">');
    expect(html).not.toContain('target=');
  });

  it('opens a fallback link from either resolving stage in a new tab (11e)', async () => {
    // A card whose URL resolves to nothing, and an embed no provider claims: both degrade to a
    // plain external link, and both are anchors this stage sees because it runs after them.
    const { html } = await renderMdxToHtml(
      '<div class="link-card" data-href="https://example.com/unknown"></div>\n\n<div class="embed" data-href="https://www.youtube.com/playlist?list=PL1"></div>\n',
      { resolveCard },
    );
    expect(html).toContain('<a href="https://example.com/unknown" target="_blank">');
    expect(html).toContain('<a href="https://www.youtube.com/playlist?list=PL1" target="_blank">');
  });
});
