import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { PhrasingContent, Root, RootContent } from 'mdast';
import { SUMMARY_CLASS, TLDR_CLASS } from './summary-types';

// A post's summary line, and the one place that decides what it is — the twin of
// lib/thumbnail.ts's resolveThumbnail. There is no field for it: the author writes no description,
// and every surface that shows one (the post list, `<meta name="description">`, `og:description`,
// the RSS item, an internal link card) reads the opening of the body instead, the way Hatena
// Blog does. Five surfaces, one function, so none of them can disagree about the words
// (docs/cms-features.md「説明文の自動抽出」).
//
// Read from the parsed tree, not by scanning lines: a stored body is CRLF or LF depending on the
// route that wrote it, and the constructs to skip — fences, raw-HTML cards and embeds,
// `<details>`, GitHub alerts — are exactly what a line scanner gets wrong.

// Long enough to fill a search result's snippet in Japanese, short enough that it is still the
// opening rather than a paragraph dump.
export const EXCERPT_MAX_CHARS = 120;

export const parser = unified().use(remarkParse).use(remarkGfm);

// The visible words of an inline run. Raw HTML is dropped as markup (the text inside an
// `<span class="accent-emphasis">` is a sibling `text` node and survives); images and footnote
// references contribute nothing a reader would read as prose.
export function phrasingText(nodes: PhrasingContent[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'inlineCode') out += node.value;
    else if (node.type === 'break') out += '\n';
    else if ('children' in node) out += phrasingText(node.children);
  }
  return out;
}

function isImageOnly(node: RootContent): boolean {
  return (
    node.type === 'paragraph' &&
    node.children.every(
      (child) => child.type === 'image' || (child.type === 'text' && child.value.trim() === ''),
    )
  );
}

// `*caption*` directly under an image is the image's caption (lib/rehype-image-caption.ts),
// not the post talking.
function isCaption(node: RootContent, previous: RootContent | undefined): boolean {
  return (
    previous !== undefined &&
    isImageOnly(previous) &&
    node.type === 'paragraph' &&
    node.children.length === 1 &&
    node.children[0].type === 'emphasis'
  );
}

// A paragraph ending in a colon introduces the block after it (「サンプル:」 before a fence), and
// reads as a dangling fragment once that block is gone.
function isLeadIn(text: string): boolean {
  return /[:：]$/.test(text);
}

// Japanese and ASCII, but not the space between them: the house style spaces a Latin term inside
// Japanese (「React は」), so an ordinary space is kept. What goes is a line break — a soft break in
// the source, or the seam between two paragraphs — right after a Japanese character, where a
// browser's space would read as a stray gap (「軽量。 使い分け」).
const CJK_BEFORE = /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]$/;

function joinLine(left: string, right: string): string {
  if (left === '') return right;
  return CJK_BEFORE.test(left) ? left + right : `${left} ${right}`;
}

export function normalize(text: string): string {
  return text
    .split(/\s*\n\s*/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .reduce(joinLine, '');
}

// A paragraph that is nothing but a URL is a pasted link, not a sentence.
function isBareLink(node: RootContent): boolean {
  if (node.type !== 'paragraph' || node.children.length !== 1) return false;
  const only = node.children[0];
  return only.type === 'link' && phrasingText(only.children) === only.url;
}

// How far a raw-HTML block moves into or out of an accordion. The editor writes `<details>` and
// `</details>` as HTML blocks of their own with the contents between them as ordinary markdown
// (components/editor/details-extension.ts), so the paragraphs inside arrive as top-level
// paragraphs — folded away from the reader, and so not the post's opening.
function detailsDepthChange(html: string): number {
  return (html.match(/<details\b/gi)?.length ?? 0) - (html.match(/<\/details\s*>/gi)?.length ?? 0);
}

// The まとめ and TL;DR containers are raw-HTML blocks too, `<div class="…">` and `</div>` each a block
// of their own (components/editor/summary-extension.ts), so which one a paragraph sits in is a
// stack of the <div>s opened and not yet closed. Other <div>s (link cards, embeds) are pushed as ''
// so that their `</div>` closes the right one.
const DIV_TAG = /<div\b[^>]*>|<\/div\s*>/gi;
const CLASS_ATTR = /\bclass\s*=\s*"([^"]*)"/i;

function applyDivTags(html: string, stack: string[]): void {
  for (const [tag] of html.matchAll(DIV_TAG)) {
    if (tag.startsWith('</')) {
      stack.pop();
      continue;
    }
    const classes = (tag.match(CLASS_ATTR)?.[1] ?? '').split(/\s+/);
    if (classes.includes(TLDR_CLASS)) stack.push(TLDR_CLASS);
    else if (classes.includes(SUMMARY_CLASS)) stack.push(SUMMARY_CLASS);
    else stack.push('');
  }
}

// Counted in code points, so a cut never splits a surrogate pair.
function clip(text: string): string {
  const chars = Array.from(text);
  return chars.length > EXCERPT_MAX_CHARS
    ? `${chars.slice(0, EXCERPT_MAX_CHARS).join('').trimEnd()}…`
    : text;
}

// The description is the TL;DR when the post has one with any text (docs/summary-requirements.md
// §2) — the author's own words for a reader deciding whether to read. Otherwise it is the opening:
// top-level paragraphs only, so headings, lists, tables, quotes (and so callouts), code and raw HTML
// blocks are all skipped, as is anything inside an accordion, a まとめ (written for someone who has
// read the post) or an empty TL;DR. Paragraphs are joined until the limit rather than stopping at
// the first, so a one-line greeting does not become the whole summary.
export function excerptFromBody(body: string): string {
  const tree = parser.parse(body) as Root;
  let joined = '';
  let tldr = '';
  let tldrSeen = false;
  let previous: RootContent | undefined;
  let detailsDepth = 0;
  const divs: string[] = [];
  for (const node of tree.children) {
    if (node.type === 'html') {
      detailsDepth = Math.max(0, detailsDepth + detailsDepthChange(node.value));
      const wasInTldr = divs.includes(TLDR_CLASS);
      applyDivTags(node.value, divs);
      if (wasInTldr && !divs.includes(TLDR_CLASS)) tldrSeen = true;
    }
    const inTldr = divs.includes(TLDR_CLASS);
    if (inTldr && !tldrSeen && detailsDepth === 0 && node.type === 'paragraph') {
      tldr = joinLine(tldr, normalize(phrasingText(node.children)));
    }
    const skip =
      detailsDepth > 0 ||
      divs.includes(SUMMARY_CLASS) ||
      inTldr ||
      node.type !== 'paragraph' ||
      isImageOnly(node) ||
      isCaption(node, previous) ||
      isBareLink(node);
    previous = node;
    if (skip || node.type !== 'paragraph') continue;
    const text = normalize(phrasingText(node.children));
    if (text === '' || isLeadIn(text)) continue;
    if (joined.length < EXCERPT_MAX_CHARS) joined = joinLine(joined, text);
  }
  return clip(tldr !== '' ? tldr : joined);
}
