import { InputRule } from '@tiptap/core';
import type { CommandProps } from '@tiptap/core';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { detailsSliceGuard } from './details-slice-guard';
import type { MarkdownSerializerState } from './markdown-serializer-state';

// The Zenn-style folding block (docs/accordion-requirements.md). @tiptap/extension-details
// supplies the three nodes — `details` holding `detailsSummary detailsContent` — and every editing
// behaviour; what it does not supply is a markdown layer this repo can use. Its
// `createBlockMarkdownSpec` belongs to TipTap 3's own markdown module, which tiptap-markdown 0.9.0
// never reads, so it looks wired up and is inert. Everything markdown-facing is therefore here:
// the serializer, the parse hook, the placement rule, and the `:::details ` shortcut.

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

// The toggle's glyph and label, matching the public page's ::before marker (app/globals.css).
// The official default writes English (`"Collapse details content"`), and the site's UI is
// Japanese — §7.3. `renderToggleButton` is called on mount and on every toggle.
function renderToggleButton({ element, isOpen }: { element: HTMLElement; isOpen: boolean }): void {
  element.textContent = isOpen ? '▾' : '▸';
  element.setAttribute('aria-label', isOpen ? '折りたたみを閉じる' : '折りたたみを開く');
}

// The refusal reporter the slice guard needs, declared as a type so `MarkdownDetails.configure({
// onBlocked })` typechecks at the call site in PostEditor — the same shape Callout and
// MarkdownTable take, writing to the same single notice (useEditorNotice).
export type DetailsOptions = Parameters<typeof Details.configure>[0] & {
  onBlocked: (message: string) => void;
};

export const MarkdownDetails = Details.extend<DetailsOptions>({
  addOptions() {
    const parent = this.parent?.();
    return {
      onBlocked: () => {},
      // `persist: false` is the default and is load-bearing (§5): with it, the open/closed state
      // never reaches the document, so folding cannot mark the post dirty or fire autosave.
      persist: parent?.persist ?? false,
      openClassName: parent?.openClassName ?? 'is-open',
      HTMLAttributes: parent?.HTMLAttributes ?? {},
      renderToggleButton,
    };
  },

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

  // Keeps a dropped or pasted slice from putting an accordion anywhere but the top level, and
  // repairs a slice that only carries half of one (see details-slice-guard.ts).
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), detailsSliceGuard(this.options.onBlocked)];
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
