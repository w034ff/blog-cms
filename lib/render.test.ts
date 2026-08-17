import { describe, expect, it } from 'vitest';
import { renderMdxToHtml } from '@/lib/render';

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
    href === '/posts/abc123'
      ? { title: '参照先の記事', description: '説明文', thumbnail: null }
      : null;

  it('resolves a stored reference into a card (2a)', async () => {
    const { html } = await renderMdxToHtml(CARD, { resolveCard });
    expect(html).toContain('<a class="link-card" href="/posts/abc123">');
    expect(html).toContain('<span class="link-card-title">参照先の記事</span>');
    expect(html).toContain('<span class="link-card-description">説明文</span>');
    // Title and description are the card's text: the target's date was dropped 2026-08-15
    // (lib/rehype-link-card.ts carries the reason). `.link-card-meta` still exists for the editor's
    // NodeView, which says there that the target is a draft or cannot be found (§13.1), so its
    // absence here is asserted rather than assumed.
    expect(html).not.toContain('link-card-meta');
    // This target has no image, and a card without one carries no <img> at all rather than an
    // empty box — the text column is the whole card.
    expect(html).not.toContain('link-card-image');
  });

  it('puts the target’s image beside the text when it has one', async () => {
    const withImage = async () => ({
      title: '絵のある記事',
      description: '説明文',
      thumbnail: '/uploads/8c3a2ce41540e56801a3.png',
    });
    const { html } = await renderMdxToHtml(CARD, { resolveCard: withImage });
    expect(html).toContain('<img class="link-card-image" src="/uploads/8c3a2ce41540e56801a3.png"');
    // Empty alt: the title sits inside the same <a>, so a described image would be read twice.
    expect(html).toContain('alt=""');
    // The text is wrapped in its own column, which is what keeps the description clamped to the
    // column rather than the card. Both with and without an image, so the shape does not shift.
    expect(html).toContain('<span class="link-card-text">');
  });

  it('survives sanitize with the image intact (2a)', async () => {
    // The stage runs after rehype-sanitize, so nothing it emits meets the schema — this pins that
    // the ordering still holds for the <img>, which is the one element here a schema would care
    // about. If the stage were ever moved before sanitize, this is what goes red.
    const withImage = async () => ({
      title: 'T',
      description: '',
      thumbnail: '/uploads/a.png',
    });
    const { html } = await renderMdxToHtml(CARD, { resolveCard: withImage });
    expect(html).toContain('src="/uploads/a.png"');
    expect(html).toContain('class="link-card-image"');
  });

  it('reads the title from the resolver, not from the stored markdown (1b/1c)', async () => {
    // The stored form holds no display text at all, so a renamed post shows its new title with
    // no rewrite of any body that links to it. Same source, a different resolver, a different
    // title — which is the round-trip claim §4.2 makes, measured at the only place it can be.
    const renamed = async () => ({ title: '改題後', description: '', thumbnail: null });
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

  it('refuses references that are not same-origin `/posts/…` (2c/2d)', async () => {
    for (const href of [
      '//evil.example/posts/x',
      'https://evil.example',
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
    expect(html).toContain('<a class="link-card" href="/posts/abc123">');
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
