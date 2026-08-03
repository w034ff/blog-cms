import { InputRule } from '@tiptap/core';
import type { CommandProps } from '@tiptap/core';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
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

// Is the whole selection sitting at the document's top level? The one placement rule (§6.3):
// an accordion may only be *created* there — not in a quote, a callout, a list item, a table
// cell, or another accordion. Asked of both ends, so a range reaching out of a container is
// refused like a caret inside one.
//
// A depth test rather than `selectionTouches(state, 'blockquote', …)`, which is what setCallout
// uses: the rule here is "nowhere but the top level", so naming the containers would be a list
// that goes stale the moment a new block node is added. The stored markdown is *not* restricted
// the same way — every one of these shapes loads and round-trips (measured, §4.4); it is the
// gesture that is refused, exactly as callout-slice-guard.ts:42-46 argues it must be.
function selectionIsTopLevel({ state }: CommandProps): boolean {
  const { $from, $to } = state.selection;
  return $from.depth === 1 && $to.depth === 1;
}

// `:::details ` on a top-level line, committed with the trailing space — the same shape as
// callout's `:::info ` shortcut. Unlike that one this cannot go through findWrapping: `details`
// is `detailsSummary detailsContent`, so there is no wrapping that turns one paragraph into it.
// The line is replaced instead, and whatever was typed after the trigger becomes the body, so
// nothing the author had already written is lost.
const DIRECTIVE = /^:::details\s$/;

export const MarkdownDetails = Details.extend({
  addStorage() {
    return {
      markdown: {
        serialize: serializeDetails,
        parse: { updateDOM: updateDetailsDOM },
      },
    };
  },

  // The official `setDetails` performs no placement check at all — it takes the caret's block
  // range and inserts if `detailsContent` can hold it, which a table cell's paragraph can. So
  // `can().setDetails()` reports true inside a cell, the slash menu offers the row, and running
  // it splits the table (the breakage table-cell-rules.ts documents). Wrapping it is therefore a
  // precondition for using `can()` as the menu's predicate, not a refinement of it.
  //
  // Silent on refusal, like setCallout: every route that can reach this asks `can()` first and
  // hides itself, so there is no gesture left for a notice to explain. The notices belong to the
  // guards, where a drop really is refused after the fact.
  addCommands() {
    const parent = this.parent?.();
    return {
      ...parent,
      setDetails:
        () =>
        (props: CommandProps): boolean => {
          if (!selectionIsTopLevel(props)) return false;
          return parent?.setDetails?.()(props) ?? false;
        },
    };
  },

  addInputRules() {
    const detailsType = this.type;
    return [
      new InputRule({
        find: DIRECTIVE,
        handler: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.depth !== 1 || !$from.parent.isTextblock) return null;
          const { schema, tr } = state;
          // Anything typed after the trigger stays as the body's first line.
          const rest = $from.parent.content.cut(range.to - $from.start());
          const node = detailsType.create(
            null,
            Fragment.fromArray([
              schema.nodes.detailsSummary.create(),
              schema.nodes.detailsContent.create(null, schema.nodes.paragraph.create(null, rest)),
            ]),
          );
          const start = $from.before(1);
          tr.replaceWith(start, $from.after(1), node);
          // Caret into the (empty) title, matching setDetails — §7 asks both routes to land there.
          tr.setSelection(TextSelection.near(tr.doc.resolve(start + 2)));
          return undefined;
        },
      }),
    ];
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
