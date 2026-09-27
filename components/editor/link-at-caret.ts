import { getMarkRange, isMarkActive } from '@tiptap/core';
import { Mark } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';

// What the link card (LinkBubble.tsx) asks of the document and of an href, as pure functions over
// an `EditorState` or a string, so that a vitest case can put the question
// (link-at-caret.test.ts). The card's show/hide and focus rules stay in LinkBubble.tsx; they are
// one state machine joined by refs and timing, and only a browser answers them.

/** The link the card is about: its range and href. */
export type CaretLink = { from: number; to: number; href: string };

// The link the card is about (range and href), or null. Every question about the current link goes
// through here.
//
// The mark is no longer inclusive (link-extension.ts), so at a link's right edge `isActive` and
// `getAttributes` answer nothing (§5.5.12). **The probe is the text before the caret**: `childBefore`
// has the link inside it and at its right edge but not its left, the card's reach while the mark
// was inclusive. `getMarkRange` alone also resolves at the left edge, so it only widens the range
// once the probe has found a link. A selection still uses `isMarkActive`.
export function linkAtCaret(state: EditorState): CaretLink | null {
  const type = state.schema.marks.link;
  if (!type) return null;
  const { $from, from, empty } = state.selection;
  if (empty) {
    const before = $from.parent.childBefore($from.parentOffset).node;
    if (!before?.marks.some((mark) => mark.type === type)) return null;
  } else if (!isMarkActive(state, type)) {
    return null;
  }
  const range = getMarkRange(state.doc.resolve(from), type);
  if (!range) return null;
  // Off the range's first text node: the caret at the right edge carries no link mark.
  const href = state.doc.nodeAt(range.from)?.marks.find((mark) => mark.type === type)?.attrs.href;
  return { from: range.from, to: range.to, href: typeof href === 'string' ? href : '' };
}

// The link's text when the card may rewrite it, else null (§5.5.13). **Allowed means one mark set
// over the whole range**, since the replacement is one text node carrying that set (so a uniformly
// bold link keeps its bold). Asked over the nodes, not their count: identical-mark text can be split
// into several nodes.
export function editableLinkText(doc: PMNode, from: number, to: number): string | null {
  let plain = true;
  let marks: readonly Mark[] | null = null;
  doc.nodesBetween(from, to, (node) => {
    if (!plain) return false;
    if (node.isText) {
      // `getMarkRange` only spans nodes with the same link attrs
      // (`isMarkInSet([...$pos.parent.child(endIndex).marks], type, attributes)`), so only the
      // rest of the set is in question.
      if (marks === null) marks = node.marks;
      else if (!Mark.sameSet(marks, node.marks)) plain = false;
      return false;
    }
    // An inline node that is not text — a footnote reference, an image — is structure by itself.
    if (node.isInline) {
      plain = false;
      return false;
    }
    return true;
  });
  return plain ? doc.textBetween(from, to) : null;
}

// Only `https://` is hidden, so an unencrypted `http://` is what shows, as in Chrome's address bar.
// Display only: the tooltip, open and copy use the raw href (§5.5.10).
export function displayHref(href: string): string {
  return href.replace(/^https:\/\//i, '');
}

// The root `/favicon.ico` of the link's origin, or null without one (`tel:`, `mailto:`); relative
// links resolve against `base`, this blog's own origin. Not `<link rel="icon">`, which would need a
// server fetch on every caret placement; the `<img>` is the author's browser asking, so no SSRF
// question (§5.5.8). Sites declaring their icon only in HTML show none. A browser, not curl, is the
// right probe (curl got a 403 where a browser didn't).
export function faviconSrc(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.origin}/favicon.ico`;
  } catch {
    return null;
  }
}
