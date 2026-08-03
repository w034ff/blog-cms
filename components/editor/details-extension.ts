import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { MarkdownSerializerState } from './markdown-serializer-state';

// SPIKE (docs/accordion-requirements.md §4): the markdown layer for the accordion, and nothing
// else. No guards, no slash menu, no CSS — this exists to answer the one question the design
// document flagged as unverified, which is whether TipTap → markdown → TipTap reaches a fixed
// point. The official extension supplies the three nodes and every editing behaviour; it has no
// markdown serializer that tiptap-markdown 0.9.0 can see (its `createBlockMarkdownSpec` belongs
// to TipTap 3's own markdown layer, which this repo does not use), so that is what is added here.

// The stored form, whose two blank lines are load-bearing (§2.1):
//
//   <details>
//   <summary>タイトル</summary>
//   <blank>
//   本文
//   <blank>
//   </details>
//
// Without the first, the body stays inside the HTML block and comes back as literal text; without
// the second, `</details>` is swallowed by the last block. Both blank lines come from closing the
// block before writing the next piece — prosemirror-markdown emits the separation on the next
// write (flushClose), which is the same mechanism serializeCallout uses for its blank `>` line.
//
// The summary is written as raw HTML rather than through `state.text()`. Two reasons, and the
// second is the one that bites: `text()` escapes *markdown* syntax, so a title reading `*強調*`
// would come back as `\*強調\*`; and the line is HTML, so it needs HTML escaping instead, or a
// title containing `<` or `&` loses characters when markdown-it parses the tag it just grew.
function escapeSummary(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function serializeDetails(state: MarkdownSerializerState, node: PMNode): void {
  const summary = node.firstChild;
  const content = node.lastChild;
  state.write('<details>');
  state.ensureNewLine();
  state.write(`<summary>${escapeSummary(summary?.textContent ?? '')}</summary>`);
  state.closeBlock(node);
  if (content) state.renderContent(content);
  state.write('</details>');
  state.closeBlock(node);
}

// Parse hook (runs on markdown-it's HTML before ProseMirror parses it). The stored form has no
// `<div data-type="detailsContent">` — that wrapper is the official extension's own DOM shape, and
// its parseHTML requires it — so the body blocks are collected into one here.
//
// Idempotent by contract: tiptap-markdown re-runs every extension's `parse.setup` on each parse
// (the lesson from the footnote fix), so a second pass must not wrap the wrapper again. The
// early return is that guard.
function updateDetailsDOM(element: HTMLElement): void {
  element.querySelectorAll('details').forEach((details) => {
    if (details.querySelector(':scope > div[data-type="detailsContent"]')) return;
    const doc = element.ownerDocument;
    const summary = details.querySelector(':scope > summary');
    const content = doc.createElement('div');
    content.setAttribute('data-type', 'detailsContent');
    Array.from(details.childNodes).forEach((child) => {
      if (child !== summary) content.appendChild(child);
    });
    // `detailsContent` is `block+`, so an accordion written with an empty body still needs one
    // node to hold — otherwise the parser drops the whole thing rather than the body alone.
    if (!content.firstElementChild) content.appendChild(doc.createElement('p'));
    if (!summary) details.insertBefore(doc.createElement('summary'), details.firstChild);
    details.appendChild(content);
  });
}

export const MarkdownDetails = Details.extend({
  addStorage() {
    return {
      markdown: {
        serialize: serializeDetails,
        parse: { updateDOM: updateDetailsDOM },
      },
    };
  },
});

// The children are rendered by serializeDetails itself, so neither is ever asked to serialize on
// its own — but tiptap-markdown builds its serializer map from every registered node, and a node
// with no entry falls back to raw HTML. Declaring no-ops keeps that fallback from ever running.
export const MarkdownDetailsSummary = DetailsSummary.extend({
  addStorage() {
    return { markdown: { serialize: () => {} } };
  },
});

export const MarkdownDetailsContent = DetailsContent.extend({
  addStorage() {
    return {
      markdown: {
        serialize: (state: MarkdownSerializerState, node: PMNode) => state.renderContent(node),
      },
    };
  },
});
