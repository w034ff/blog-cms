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
});
