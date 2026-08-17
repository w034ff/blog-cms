import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { renderMdxToHtml } from '@/lib/render';
import { collectHeadings, matchHeadings, slugsFor } from './document-headings';

// The link card offers these slugs as fragments to write down (§5.5.17), so the only thing that
// makes them worth anything is that they are the same strings the published page puts on its
// headings. Nothing else in the codebase checks that: the editor and the render pipeline reach
// `github-slugger` by different routes (a direct import here, `rehype-slug` there), and a fragment
// that misses is not refused anywhere — it renders as a link that lands nowhere.
//
// So this compares against the pipeline's own output rather than against a table of expected
// slugs. A table would pass just as happily on the day the two sides drift apart.
describe('slugsFor matches the published headings', () => {
  // Each of these is a rule an author cannot see: brackets and full-width punctuation are dropped,
  // ASCII is lowercased, spaces become hyphens, and a repeated heading takes a counter.
  const HEADINGS = [
    '導入',
    'Hello World',
    'API と CLI（詳細）',
    '導入',
    'Set up (part 1)',
    'コード `fence` と **強調**',
  ];

  it('produces exactly the ids rehype-slug does, in document order', async () => {
    const { html } = await renderMdxToHtml(HEADINGS.map((text) => `## ${text}`).join('\n\n'));
    // Sanitize renames every id to `user-content-<id>` (lib/render.ts). The editor writes the name
    // before that rename, because lib/rehype-clobber-fragment-links.ts applies the same prefix to
    // the href at publish time — so the prefix comes off here rather than being added there.
    const published = [...html.matchAll(/<h2 id="user-content-([^"]*)"/g)].map((m) => m[1]);
    expect(published).toHaveLength(HEADINGS.length);
    expect(slugsFor(HEADINGS)).toEqual(published);
  });

  it('numbers a repeated heading the way the pipeline does', async () => {
    const { html } = await renderMdxToHtml('## 導入\n\n## 導入\n\n## 導入');
    const published = [...html.matchAll(/<h2 id="user-content-([^"]*)"/g)].map((m) => m[1]);
    expect(published).toEqual(['導入', '導入-1', '導入-2']);
    expect(slugsFor(['導入', '導入', '導入'])).toEqual(published);
  });

  // An empty heading gets no usable fragment, but it does consume a turn of the slugger — which is
  // why collectHeadings slugs before it drops them. Pinned against the pipeline because the whole
  // question is what the *other* side counts.
  it('counts an empty heading, which is why it is slugged before being dropped', async () => {
    const { html } = await renderMdxToHtml('## 導入\n\n##\n\n## 導入');
    const published = [...html.matchAll(/<h2 id="user-content-([^"]*)"/g)].map((m) => m[1]);
    expect(slugsFor(['導入', '', '導入'])).toEqual(published);
  });
});

// A schema with just enough in it to build documents by hand: the real editor schema would drag in
// every extension, and none of them is what these tests are about.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    blockquote: { group: 'block', content: 'block+' },
    heading: { group: 'block', content: 'inline*', attrs: { level: { default: 2 } } },
    text: { group: 'inline' },
  },
});

const heading = (level: number, text: string) =>
  schema.node('heading', { level }, text === '' ? undefined : schema.text(text));

describe('collectHeadings', () => {
  it('reads text and slug in document order, at any level', () => {
    const doc = schema.node('doc', null, [
      heading(2, '導入'),
      schema.node('paragraph', null, schema.text('本文')),
      heading(3, 'Hello World'),
    ]);
    // The level itself is not carried: nothing displays it (§5.5.17).
    expect(collectHeadings(doc)).toEqual([
      { text: '導入', slug: '導入' },
      { text: 'Hello World', slug: 'hello-world' },
    ]);
  });

  it('drops an empty heading without letting it shift the counter', () => {
    const doc = schema.node('doc', null, [heading(2, '導入'), heading(2, ''), heading(2, '導入')]);
    // The second 導入 is `導入-1`, not `導入`: the empty heading in between took a turn upstream.
    expect(collectHeadings(doc).map((h) => h.slug)).toEqual(['導入', '導入-1']);
  });

  // Not in the table of contents (docs/toc-requirements.md §4.1) is not the same as not reachable —
  // these still get ids, so they are offered.
  it('includes a heading nested inside another block', () => {
    const doc = schema.node('doc', null, [
      heading(2, '導入'),
      schema.node('blockquote', null, heading(3, '引用の中')),
    ]);
    expect(collectHeadings(doc).map((h) => h.text)).toEqual(['導入', '引用の中']);
  });
});

describe('matchHeadings', () => {
  const headings = collectHeadings(
    schema.node('doc', null, [
      heading(2, '導入'),
      heading(2, 'Hello World'),
      heading(3, '導入の続き'),
    ]),
  );

  it('offers everything for an empty query', () => {
    expect(matchHeadings(headings, '')).toHaveLength(3);
  });

  it('matches the visible text', () => {
    expect(matchHeadings(headings, '導入').map((h) => h.text)).toEqual(['導入', '導入の続き']);
  });

  // The slug is what a fragment already written into the field contains, and it is not always the
  // text: `Hello World` is reachable by `hello-` and by `World` alike.
  it('matches the slug, case-insensitively', () => {
    expect(matchHeadings(headings, 'hello-').map((h) => h.text)).toEqual(['Hello World']);
    expect(matchHeadings(headings, 'WORLD').map((h) => h.text)).toEqual(['Hello World']);
  });

  it('offers nothing when nothing matches', () => {
    expect(matchHeadings(headings, 'そんな見出しは無い')).toEqual([]);
  });
});
