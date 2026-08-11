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

// The class @tiptap/extension-details puts on the NodeView's wrapper while it is open — the
// official default, restated because three places read it and the option's type allows undefined:
// the option below, openInsertedDetails, and app/globals.css, which draws the whole open state off
// it (the marker's direction and the divider under the title).
const OPEN_CLASS = 'is-open';

// The toggle's accessible name, and nothing else: the marker itself is drawn in CSS
// (app/globals.css) off the wrapper's `is-open` class, as the same clip-path triangle the public
// page's ::before uses, so this writes no text into the button. The official default writes
// English (`"Collapse details content"`), and the site's UI is Japanese — §7.3.
// `renderToggleButton` is called on mount and on every toggle.
function renderToggleButton({ element, isOpen }: { element: HTMLElement; isOpen: boolean }): void {
  element.setAttribute('aria-label', isOpen ? 'アコーディオンを閉じる' : 'アコーディオンを開く');
}

// A freshly inserted accordion is left open, so the author can write the body without opening it
// first. Only the two authoring routes do this: a loaded document keeps every accordion closed
// (§5), which is what a reader gets, and a pasted or dropped one is content being moved rather
// than written.
//
// It has to be done by clicking the toggle, and the reason is §5's `persist: false`. In that mode
// the official extension's `addAttributes()` returns `[]` — there is no `open` attribute in the
// schema at all — so there is nothing to set on the node, and equally nothing that could reach the
// document and mark the post dirty. Open state lives only in the NodeView's own DOM, whose one
// external control is that button.
//
// Deferred by a frame because the NodeView does not exist until the view has processed the
// transaction that created the node. Everything is re-read inside the callback rather than
// captured: by then the insertion may have been undone, in which case no accordion holds the
// selection and this does nothing.
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

// Is the accordion holding this position open? Its NodeView's wrapper carries the class while it
// is (§7.4 — with `persist: false` the DOM is the only place the open state exists, so there is
// nothing in the document to ask).
function detailsIsOpen(editor: Editor, posBeforeDetails: number, openClassName: string): boolean {
  const dom = editor.view.nodeDOM(posBeforeDetails);
  return dom instanceof HTMLElement && dom.classList.contains(openClassName);
}

// The body of the accordion whose title `$head` sits in, and the position its first line starts
// at — or null when the caret is not in a title, or that accordion is folded. Both keys that go
// title → body ask through here, so the folded case is answered in one place: putting the caret
// into a hidden body is the one thing §7.2 is emphatic about.
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

// Put the caret at `pos` and change nothing else, which is the whole of what both keys below do
// once they have decided they apply.
function moveCaretTo(editor: Editor, pos: number): boolean {
  const { tr } = editor.state;
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
  tr.scrollIntoView();
  editor.view.dispatch(tr);
  return true;
}

// Enter in the title of a just-inserted accordion (§7.4). The official handler *inserts* the
// body's first line rather than entering the one that is already there — invisible in most shapes,
// but a freshly inserted body IS one empty paragraph, so it comes out with a spare that the author
// has to notice and delete. Same landing place, one line instead of two.
//
// Deliberately narrow: only when the body is exactly one empty textblock, which is precisely the
// shape insertion leaves behind. There, "make a new first line" and "go to the existing one" put
// the caret in the same place and differ only in the leftover, so this is the official behaviour
// without the duplicate rather than a departure from it. Once the body holds anything real the two
// are different operations and the official one is right, so it is left alone.
//
// Returns false for everything it does not handle, including a folded accordion
// (openBodyFromSummary below), where the official handler's answer — a new block below — is the one
// this must not take away.
function enterIntoEmptyBody(editor: Editor, openClassName: string): boolean {
  const { $head, empty } = editor.state.selection;
  if (!empty) return false;
  const target = openBodyFromSummary(editor, $head, openClassName);
  if (!target || target.body.childCount !== 1) return false;
  const line = target.body.firstChild;
  if (!line || !line.isTextblock || line.content.size > 0) return false;
  return moveCaretTo(editor, target.firstLinePos);
}

// Tab in the title moves to the body as it stands — the motion Enter cannot offer. The official
// Enter *inserts* the body's first line (see above), so leaving a title whose body already holds
// something costs an empty paragraph the author then has to delete; enterIntoEmptyBody only removes
// that for the one shape where the two coincide. This is the plain "next field" move, the same
// meaning Tab has between table cells, and it changes no content at all.
//
// Only from the title, and only while the accordion is open (§7.2) — a folded one declines, and Tab
// then does what it does everywhere else in prose, which is move the browser's focus. The title is
// `text*`, so no list or table can sit in it and no other extension's Tab is in play here; this
// binding therefore depends on no ordering.
//
// Deliberately one-way. The body is `block+` and so can hold a list, where Shift+Tab already means
// liftListItem — a body → title binding would have to win that argument first, and nothing is asking
// for it yet.
function tabIntoBody(editor: Editor, openClassName: string): boolean {
  const target = openBodyFromSummary(editor, editor.state.selection.$head, openClassName);
  return target !== null && moveCaretTo(editor, target.firstLinePos);
}

// Puts the caret back where the author was typing after `:::details ` is undone by Backspace.
//
// `undoInputRule` (@tiptap/core) never sets a selection — it inverts the rule's steps, re-inserts
// the literal text, and leaves the caret to whatever the step mapping produces. That works for the
// shortcuts that *wrap* (measured: `:::info ` and `> ` both land at the end of the restored text),
// because the paragraph survives the wrap and the caret maps back into it. This rule cannot wrap —
// `details` is `detailsSummary detailsContent`, so the line is replaced outright — and it then puts
// the caret inside the new node, per §7. Inverting that maps a position inside a node that no
// longer exists, and the caret comes to rest at the start of the *following* paragraph (measured).
//
// So the caret is placed here instead, after the fact. The target is the end of the restored text
// less whatever the rule had carried into the body, which is where the author's cursor was when the
// rule fired: for a bare `:::details ` the body is empty and this is the end of the line, and for
// `:::details本文` it is the boundary between the trigger and 本文.
//
// The conditions are narrow enough that nothing else reaches it. An accordion held the selection,
// the input rule's inverse was available and now is not, and the position it occupied now holds a
// textblock — that last one is what excludes simply typing in a new accordion's title, which also
// consumes the undoable but leaves the accordion where it was.
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
    const openClassName = this.options.openClassName ?? OPEN_CLASS;
    return {
      ...parent,
      setDetails:
        () =>
        (props: CommandProps): boolean => {
          if (!selectionIsTopLevel(props)) return false;
          if (!(parent?.setDetails?.()(props) ?? false)) return false;
          // `dispatch` is absent when the menu asks `can().setDetails()` for its own predicate —
          // that is a dry run over a throwaway transaction, and nothing may be opened for it.
          if (props.dispatch) openInsertedDetails(props.editor, openClassName);
          return true;
        },

      // The official `unsetDetails` turns the title into a paragraph unconditionally, so dissolving
      // an accordion whose title was never filled in leaves an empty paragraph that stands for
      // nothing. Insert one from the slash menu, change your mind, press Backspace, and the single
      // line you started on has become three.
      //
      // §7.2's rule is that the title's *characters* survive the dissolve; an empty title has none,
      // so the paragraph is residue rather than content. detailsUnwrapped (details-slice-guard.ts)
      // already reads the rule that way — it emits the paragraph only `if (child.content.size > 0)`
      // — which means the keyboard and the paste/drop repair disagreed today, and the comment there
      // claiming a reader "sees the same thing either way" was true only for a filled-in title.
      // This is that rule applied to the other path, not a new one.
      //
      // Only the empty case is handled here; with a title to preserve the official command is
      // right and runs unchanged.
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

  // Everything the official extension binds is kept; Enter and Tab each get a case in front of it,
  // and only the one described at enterIntoEmptyBody / tabIntoBody. Delegating rather than replacing
  // means a future @tiptap bump that changes (or newly binds) either handler keeps working — this
  // narrows them, it does not restate them.
  addKeyboardShortcuts() {
    const parent = this.parent?.();
    const openClassName = this.options.openClassName ?? OPEN_CLASS;
    return {
      ...parent,
      Enter: (props: { editor: Editor }): boolean => {
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

// The children are rendered by serializeDetails itself, so neither is ever asked to serialize on
// its own — but tiptap-markdown builds its serializer map from every registered node, and a node
// with no entry falls back to raw HTML. Declaring no-ops keeps that fallback from ever running.
export const MarkdownDetailsSummary = DetailsSummary.extend({
  // No marks in the title (§1's non-goal, made permanent 2026-08-10). The official node is `text*`
  // and says nothing about marks, so bold/italic/strike/code/accent/link all applied — and then
  // vanished on save, because serializeDetails reads `textContent` and the title round-trips as one
  // raw `<summary>…</summary>` line. Silent loss at save time, which is the worst place for it.
  //
  // Declared on the schema rather than guarded per command, and §6.3's "禁止するのは操作であって
  // スキーマではない" does not argue against it here. That rule exists because forbidding a *shape*
  // drops the content of any markdown carrying it the moment the document opens — but a dropped
  // mark keeps its text, and the emphasis is already lost at save today, so this moves the loss
  // from silent-on-save to visible-on-press without making it larger. One declaration also answers
  // every route at once: the toolbar greys itself out (`can().toggleBold()` turns false), the
  // keyboard chords decline, and a pasted or loaded `<summary><b>x</b></summary>` keeps its words
  // and leaves the mark behind. Re-opening this means §6.5's three pieces — content expression,
  // serializer, public renderer — not this line alone.
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
