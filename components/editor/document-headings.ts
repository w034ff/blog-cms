import GithubSlugger from 'github-slugger';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

// The headings of the document being edited, with the fragment each one will answer to once the
// post is published — the list the link card's URL field offers when the author types `#`
// (docs/link-requirements.md §5.5.17).
//
// This exists because the slug is not something an author can read off a heading. Measured
// 2026-08-17 against the real pipeline: `API と CLI（詳細）` gets `id="user-content-api-と-cli詳細"`
// — the full-width brackets are simply gone — `Hello World` is lowercased to `hello-world`, and a
// second `導入` becomes `導入-1`. A hand-typed fragment that misses by one character is not refused
// anywhere: it renders as an ordinary link that lands nowhere, and nothing on either surface says
// so. Offering the list is how the author stops having to know the rule.
//
// `github-slugger` is a direct dependency rather than a local approximation for exactly that
// reason: it is what `rehype-slug` uses (lib/render.ts), so this is the same function that will
// name the heading, not a second opinion about it. document-headings.test.ts pins the two together
// against the render pipeline's own output.

export type DocumentHeading = {
  // The heading's text as the author sees it, which is what the picker lists.
  text: string;
  // The fragment to write, WITHOUT the `#` and without the `user-content-` prefix. The prefix is
  // sanitize's, and lib/rehype-clobber-fragment-links.ts adds it to both sides at publish time —
  // an author who writes it themselves gets `user-content-user-content-…` and a link to nowhere
  // (measured). So the editor stores what the author would have typed, and nothing more.
  slug: string;
  // Where the heading node starts. `pos + 1` is inside it, which is where a caret goes to reach it
  // (§5.5.18 — the card walks a fragment back to the heading it names).
  pos: number;
};

// The level is deliberately not carried. Nothing shows it: the picker draws every row at the same
// x, because a filtered list cannot honestly indent one row under another (§5.5.17). Reading
// `node.attrs.level` back is one line on the day a row has something to say about it.

// Slugs for a run of heading texts, in document order. Order is the whole reason this takes an
// array instead of a string: `GithubSlugger` carries the "seen this one already" counter that turns
// the second `導入` into `導入-1`, and rehype-slug runs one slugger per document, top to bottom.
// Ask it out of order, or with a fresh slugger per heading, and the duplicates stop matching.
export function slugsFor(texts: readonly string[]): string[] {
  const slugger = new GithubSlugger();
  return texts.map((text) => slugger.slug(text));
}

// Every heading in the document, empty ones dropped. Headings inside an accordion or a quote are
// included deliberately: they are not in the table of contents (docs/toc-requirements.md §4.1) but
// they do get ids and a fragment does reach them, so they are legitimate targets.
export function collectHeadings(doc: ProseMirrorNode): DocumentHeading[] {
  const found: { text: string; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true;
    found.push({ text: node.textContent, pos });
    // Nothing inside a heading is a heading.
    return false;
  });
  // Slugged before the empty ones are dropped, not after: an empty heading still consumes a turn of
  // the slugger upstream, and skipping it here would shift every duplicate counter that follows.
  const slugs = slugsFor(found.map((heading) => heading.text));
  return found
    .map((heading, index) => ({ ...heading, slug: slugs[index] }))
    .filter((heading) => heading.text.trim() !== '');
}

// The heading a fragment names, or null. Matched exactly, and that is the point rather than a
// convenience: a browser matches `#…` against an id without folding case, so a fragment this refuses
// is a fragment that lands nowhere for a reader too. Being generous here would make the card say a
// link works when it does not.
//
// Percent-encoding is undone first, because that is what a browser does before comparing (a fragment
// written by the markdown round trip arrives as `#%E5%B0%8E%E5%85%A5`, §2.2.2). A malformed escape
// decodes to nothing and simply finds no heading.
export function headingForFragment(
  headings: readonly DocumentHeading[],
  href: string,
): DocumentHeading | null {
  if (!href.startsWith('#')) return null;
  let target = href.slice(1);
  try {
    target = decodeURIComponent(target);
  } catch {
    return null;
  }
  return headings.find((heading) => heading.slug === target) ?? null;
}

// The headings a `#…` query is offering. Both the visible text and the slug are matched, because
// the author may be typing either — the text is what they remember and the slug is what a fragment
// they are correcting already contains.
export function matchHeadings(
  headings: readonly DocumentHeading[],
  query: string,
): DocumentHeading[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...headings];
  return headings.filter(
    (heading) =>
      heading.text.toLowerCase().includes(needle) || heading.slug.toLowerCase().includes(needle),
  );
}
