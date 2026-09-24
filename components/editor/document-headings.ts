import GithubSlugger from 'github-slugger';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

// The headings of the document being edited, with the fragment each one will answer to once the
// post is published — the list the link card's URL field offers when the author types `#`
// (docs/link-requirements.md §5.5.17).
//
// The slug cannot be read off a heading (full-width brackets vanish, case folds, a second `導入`
// becomes `導入-1`), and a fragment that misses renders as a link to nowhere. `github-slugger` is
// what `rehype-slug` uses (lib/render.ts), so this is the same function, not an approximation;
// document-headings.test.ts pins the two together.

export type DocumentHeading = {
  // The heading's text as the author sees it, which is what the picker lists.
  text: string;
  // The fragment WITHOUT `#` and without the `user-content-` prefix, which
  // lib/rehype-clobber-fragment-links.ts adds to both sides at publish time.
  slug: string;
  // Where the heading node starts. `pos + 1` is inside it, which is where a caret goes to reach it
  // (§5.5.18 — the card walks a fragment back to the heading it names).
  pos: number;
};

// The level is not carried: a filtered list cannot honestly indent rows (§5.5.17).

// Slugs in document order, from one slugger: its duplicate counter must run top to bottom as
// rehype-slug's does, or the `-1` suffixes stop matching.
export function slugsFor(texts: readonly string[]): string[] {
  const slugger = new GithubSlugger();
  return texts.map((text) => slugger.slug(text));
}

// Every non-empty heading. Those inside an accordion or quote are included: they are not in the
// table of contents (docs/toc-requirements.md §4.1) but do get ids.
export function collectHeadings(doc: ProseMirrorNode): DocumentHeading[] {
  const found: { text: string; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true;
    found.push({ text: node.textContent, pos });
    // Nothing inside a heading is a heading.
    return false;
  });
  // Slugged before empty ones are dropped: they still consume a slugger turn upstream.
  const slugs = slugsFor(found.map((heading) => heading.text));
  return found
    .map((heading, index) => ({ ...heading, slug: slugs[index] }))
    .filter((heading) => heading.text.trim() !== '');
}

// The heading a fragment names, or null. Matched exactly, as a browser does, so the card never
// claims a link works when it does not. Percent-encoding is undone first, as a browser does
// (§2.2.2).
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

// The headings a `#…` query offers, matching either the text or the slug, since the author may be
// typing either.
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
