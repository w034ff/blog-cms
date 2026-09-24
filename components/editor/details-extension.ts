import { InputRule, findParentNode } from '@tiptap/core';
import type { CommandProps, Editor } from '@tiptap/core';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { Fragment, type Node as PMNode, type NodeType, type ResolvedPos } from '@tiptap/pm/model';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { detailsSliceGuard } from './details-slice-guard';
import { hasUndoableInputRule } from './input-rule-undo';
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
// Without the first, the body stays inside the HTML block as literal text; without the second,
// `</details>` is swallowed by the last block. Both come from closing the block before the next
// write (flushClose), as serializeCallout's blank `>` line does.
//
// The summary is written as raw HTML with HTML escaping, not through `state.text()`, which applies
// markdown escaping (`*強調*` → `\*強調\*`) and leaves `<` and `&` to be eaten by markdown-it.
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
// Idempotent: tiptap-markdown re-runs `parse.setup` on each parse, so the early return keeps a
// second pass from wrapping the wrapper.
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

// Is the whole selection at the document's top level? The one placement rule (§6.3): an accordion
// may only be *created* there. Asked of both ends, and as a depth test rather than a list of
// containers, which would go stale with a new block node. Stored markdown may nest it (§4.4); only
// the gesture is refused, as for `wouldNestCallout` in callout-slice-guard.ts.
function selectionIsTopLevel({ state }: CommandProps): boolean {
  const { $from, $to } = state.selection;
  return $from.depth === 1 && $to.depth === 1;
}

// `:::details ` on a top-level line. No findWrapping can turn a paragraph into
// `detailsSummary detailsContent`, so the line is replaced and anything typed after the trigger
// becomes the body.
const DIRECTIVE = /^:::details\s$/;

// The official open class, restated because the option below, openInsertedDetails and
// app/globals.css all read it, and the option's type allows undefined.
const OPEN_CLASS = 'is-open';

// Only the toggle's Japanese accessible name (§7.3); the marker is CSS off `is-open`. Called on
// mount and on every toggle.
function renderToggleButton({ element, isOpen }: { element: HTMLElement; isOpen: boolean }): void {
  element.setAttribute('aria-label', isOpen ? 'アコーディオンを閉じる' : 'アコーディオンを開く');
}

// A freshly inserted accordion is left open (§7.4); loaded, pasted and dropped ones are not. It is
// done by clicking the toggle because under `persist: false` (§5) there is no `open` attribute:
// the state lives only in the NodeView's DOM. A frame later, once the NodeView exists, re-reading
// everything in case the insertion was undone.
function openInsertedDetails(editor: Editor, openClassName: string): void {
  requestAnimationFrame(() => {
    if (editor.isDestroyed) return;
    const { $from } = editor.state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      if ($from.node(depth).type.name !== 'details') continue;
      const dom = editor.view.nodeDOM($from.before(depth));
      if (!(dom instanceof HTMLElement) || dom.classList.contains(openClassName)) return;
      dom.querySelector<HTMLButtonElement>(':scope > button')?.click();
      return;
    }
  });
}

// Is the accordion holding this position open? Only the DOM knows (§7.4).
function detailsIsOpen(editor: Editor, posBeforeDetails: number, openClassName: string): boolean {
  const dom = editor.view.nodeDOM(posBeforeDetails);
  return dom instanceof HTMLElement && dom.classList.contains(openClassName);
}

// The open body of the accordion whose title `$head` is in, or null (not in a title, or folded).
// Both title → body keys ask here, so neither can put the caret into a hidden body (§7.2).
//
// `$head.after()` is the detailsContent; +1 enters it, +1 again enters its first block.
function openBodyFromSummary(
  editor: Editor,
  $head: ResolvedPos,
  openClassName: string,
): { body: PMNode; firstLinePos: number } | null {
  const { schema } = editor.state;
  if ($head.parent.type !== schema.nodes.detailsSummary) return null;
  const details = $head.node(-1);
  if (details.type !== schema.nodes.details) return null;
  const body = details.lastChild;
  if (!body || body.type !== schema.nodes.detailsContent) return null;
  if (!detailsIsOpen(editor, $head.before(-1), openClassName)) return null;
  return { body, firstLinePos: $head.after() + 2 };
}

// Put the caret at `pos` and change nothing else.
function moveCaretTo(editor: Editor, pos: number): boolean {
  const { tr } = editor.state;
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
  tr.scrollIntoView();
  editor.view.dispatch(tr);
  return true;
}

// Enter in the title when the body is exactly one empty textblock (the shape insertion leaves,
// §7.4): the official handler *inserts* a first line, leaving a spare empty paragraph. Here that and
// "enter the existing one" differ only in the leftover. Otherwise, including a folded accordion,
// the official handler runs.
function enterIntoEmptyBody(editor: Editor, openClassName: string): boolean {
  const { $head, empty } = editor.state.selection;
  if (!empty) return false;
  const target = openBodyFromSummary(editor, $head, openClassName);
  if (!target || target.body.childCount !== 1) return false;
  const line = target.body.firstChild;
  if (!line || !line.isTextblock || line.content.size > 0) return false;
  return moveCaretTo(editor, target.firstLinePos);
}

// Tab in the title moves to the body as it stands, changing no content (the move Enter can't make
// without inserting a line). Only while open (§7.2). No ordering dependency: nothing else's Tab
// applies in a `text*` title. One-way, since Shift+Tab in a body list already means liftListItem.
function tabIntoBody(editor: Editor, openClassName: string): boolean {
  const target = openBodyFromSummary(editor, editor.state.selection.$head, openClassName);
  return target !== null && moveCaretTo(editor, target.firstLinePos);
}

// Puts the caret back where the author was typing after `:::details ` is undone by Backspace.
//
// `undoInputRule` sets no selection; the caret follows step mapping. That works for wrapping
// shortcuts, but this rule replaces the line, so the mapped caret landed at the start of the
// *following* paragraph. The caret goes to the end of the restored text less what the rule carried
// into the body, i.e. where it was when the rule fired (§7.6). Narrow: an accordion held the
// selection, the inverse was available and now is not, and its position now holds a textblock (which
// excludes typing into a new title).
function detailsInputRuleUndoCaret(detailsType: NodeType): Plugin {
  return new Plugin({
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((transaction) => transaction.docChanged)) return null;
      if (!hasUndoableInputRule(oldState) || hasUndoableInputRule(newState)) return null;

      const was = findParentNode((node) => node.type === detailsType)(oldState.selection);
      if (!was) return null;
      const restored = newState.doc.nodeAt(was.pos);
      if (!restored?.isTextblock) return null;

      const carried = was.node.lastChild?.textContent.length ?? 0;
      const target = Math.max(was.pos + 1, was.pos + restored.nodeSize - 1 - carried);
      if (newState.selection.from === target) return null;
      return newState.tr.setSelection(TextSelection.near(newState.doc.resolve(target)));
    },
  });
}

// Declared so `MarkdownDetails.configure({ onBlocked })` typechecks, as for Callout.
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
      openClassName: parent?.openClassName ?? OPEN_CLASS,
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

  // The official `setDetails` has no placement check, so `can()` was true in a table cell and
  // running it split the table; wrapping it is what makes `can()` usable as the menu's predicate.
  // Silent on refusal, since every route asks `can()` first.
  addCommands() {
    const parent = this.parent?.();
    const openClassName = this.options.openClassName ?? OPEN_CLASS;
    return {
      ...parent,
      setDetails:
        () =>
        (props: CommandProps): boolean => {
          if (!selectionIsTopLevel(props)) return false;
          if (!(parent?.setDetails?.()(props) ?? false)) return false;
          // No `dispatch` in a `can()` dry run, which must open nothing.
          if (props.dispatch) openInsertedDetails(props.editor, openClassName);
          return true;
        },

      // An empty title leaves no paragraph behind (§7.5): the official `unsetDetails` always made
      // one, so a regretted insert grew one line into three. This matches `detailsUnwrapped`
      // (details-slice-guard.ts); keep the two in step. A filled title runs the official command.
      unsetDetails:
        () =>
        (props: CommandProps): boolean => {
          const { state, chain } = props;
          const found = findParentNode((node) => node.type === this.type)(state.selection);
          const body = found?.node.lastChild;
          if (!found || !body || (found.node.firstChild?.content.size ?? 0) > 0) {
            return parent?.unsetDetails?.()(props) ?? false;
          }
          const from = found.pos;
          return (
            chain()
              .insertContentAt(
                { from, to: from + found.node.nodeSize },
                body.content.toJSON() ?? [],
              )
              // Into the first surviving block, which is where the official command lands too.
              .setTextSelection(from + 1)
              .run()
          );
        },
    };
  },

  // The official bindings are kept; Enter and Tab only get a case in front, so a @tiptap bump that
  // changes them still flows through.
  addKeyboardShortcuts() {
    const parent = this.parent?.();
    const openClassName = this.options.openClassName ?? OPEN_CLASS;
    return {
      ...parent,
      Enter: (props: { editor: Editor }): boolean => {
        // Enter over a range replaces the range first, as it does in any paragraph. The official
        // handler asks only where `$head` is, so a range ending in the title kept its text and grew
        // an empty line in the body (measured 2026-09-24, docs/editor-pitfalls.md §6.4).
        //   • A range that leaves the title is declined, and IsolatingBoundary's Enter clamps it at
        //     the accordion's edges — the same result as when the head is in the body.
        //   • A range inside the title is deleted here, and the caret left behind then takes the
        //     title's own Enter below. baseKeymap would not: it cannot split a `detailsSummary`, so
        //     the whole key did nothing.
        const { selection } = props.editor.state;
        if (!selection.empty) {
          const { $from, $to } = selection;
          const inTitle =
            selection instanceof TextSelection &&
            $from.parent.type.name === 'detailsSummary' &&
            $from.sameParent($to);
          if (!inTitle) return false;
          props.editor.view.dispatch(props.editor.state.tr.deleteSelection());
        }
        if (enterIntoEmptyBody(props.editor, openClassName)) return true;
        return parent?.Enter?.(props) ?? false;
      },
      Tab: (props: { editor: Editor }): boolean => {
        if (tabIntoBody(props.editor, openClassName)) return true;
        return parent?.Tab?.(props) ?? false;
      },
    };
  },

  // Keeps a dropped or pasted slice from putting an accordion anywhere but the top level, and
  // repairs a slice that only carries half of one (see details-slice-guard.ts).
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      detailsSliceGuard(this.options.onBlocked),
      detailsInputRuleUndoCaret(this.type),
    ];
  },

  addInputRules() {
    const detailsType = this.type;
    const { editor } = this;
    const openClassName = this.options.openClassName ?? OPEN_CLASS;
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
          openInsertedDetails(editor, openClassName);
          return undefined;
        },
      }),
    ];
  },
});

// serializeDetails renders the children; the no-op entries keep tiptap-markdown's raw-HTML fallback
// from running for them.
export const MarkdownDetailsSummary = DetailsSummary.extend({
  // No marks in the title (§6.7): serializeDetails writes `textContent`, so marks vanished on save.
  // On the schema, despite §6.3's "禁止するのは操作であってスキーマではない": a dropped mark keeps
  // its text, so this only moves the loss from silent-on-save to visible-on-press, and it answers
  // every route at once. Re-opening it means §6.5's three pieces, not this line alone.
  marks: '',

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
