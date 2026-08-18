import { InputRule, Node as TiptapNode } from '@tiptap/core';
import type { CommandProps } from '@tiptap/core';
import { Fragment, type Node as PMNode, type NodeType } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { CALLOUT_NAME, calloutSliceGuard } from './callout-slice-guard';
import { findWrapping } from '@tiptap/pm/transform';
import { stepIntoNextIsolating, stepIntoPreviousIsolating } from './isolating-boundary';
import { selectionTouches } from './selection-scan';
import type { MarkdownSerializerState } from './markdown-serializer-state';
import {
  CALLOUT_CLASS,
  CALLOUT_CONTENT_CLASS,
  CALLOUT_MARKER_INPUT,
  CALLOUT_MARKER_LINE,
  CALLOUT_MARKERS,
  CALLOUT_TITLE_CLASS,
  CALLOUT_TITLE_LABEL_CLASS,
  CALLOUT_TITLES,
  calloutTypeClass,
  toCalloutType,
  type CalloutType,
} from '@/lib/callout-types';

// GitHub-style alert callouts as a first-class editor node. The three tiers
// (情報 → 警告 → 注意) come from lib/callout-types.ts, which the render transform
// (lib/remark-github-alerts.ts) reads too: the marker is NOT stored as editable text — it
// lives in the node's `type` attribute and shows as a non-editable label chip, so it can't be
// broken by typing after the `]`. Markdown stays the storage format: the node serializes back
// to `> [!TYPE]` and is parsed from it, so the public render pipeline and existing posts are
// unchanged.

// Menu display order (toolbar dropdown + slash menu), 情報 → 注意 → 警告. Deliberately not the
// severity ladder CALLOUT_TYPES holds, and of no use to the parser or the renderer, so it
// stays here with the UI rather than in the shared module.
export const CALLOUT_MENU_ORDER: readonly CalloutType[] = ['note', 'caution', 'warning'];

function calloutTypeOf(node: PMNode): CalloutType {
  return toCalloutType(node.attrs.type);
}

// Serialize the node back to a blank-line GFM alert:
//   > [!NOTE]
//   >
//   > body…
// The blank `>` line comes from closing the marker as its own block before the body —
// exactly the two-paragraph shape existing posts already store, so nothing regresses.
function serializeCallout(state: MarkdownSerializerState, node: PMNode): void {
  const marker = CALLOUT_MARKERS[calloutTypeOf(node)];
  state.wrapBlock('> ', null, node, () => {
    state.write(marker);
    state.closeBlock(node);
    state.renderContent(node);
  });
}

// Parse hook (runs on the rendered HTML before ProseMirror parses it): rewrite a
// `> [!TYPE]` blockquote into `<div data-callout>` so the node's parseHTML picks it up.
// Mirrors the render transform's marker stripping, incl. the soft/hard-break form and
// escaped `\[!NOTE\]` (markdown-it has already unescaped it in the DOM text).
function updateCalloutDOM(element: HTMLElement): void {
  element.querySelectorAll('blockquote').forEach((blockquote) => {
    const firstBlock = blockquote.firstElementChild;
    if (!firstBlock || firstBlock.tagName !== 'P') return;
    const firstNode = firstBlock.firstChild;
    if (!firstNode || firstNode.nodeType !== Node.TEXT_NODE) return;

    const match = (firstNode.nodeValue ?? '').match(CALLOUT_MARKER_LINE);
    if (!match) return;
    const type = toCalloutType(match[1].toLowerCase());

    // Strip the marker: keep any text that shared its line, else drop the now-empty
    // marker text node (and any leading break the author left after it), then the
    // paragraph if that emptied it.
    const remainder = (firstNode.nodeValue ?? '').slice(match[0].length);
    if (remainder.length > 0) {
      firstNode.nodeValue = remainder;
    } else {
      firstBlock.removeChild(firstNode);
      while (firstBlock.firstChild && firstBlock.firstChild.nodeName === 'BR') {
        firstBlock.removeChild(firstBlock.firstChild);
      }
      if (!firstBlock.firstChild) blockquote.removeChild(firstBlock);
    }

    const callout = element.ownerDocument.createElement('div');
    callout.setAttribute('data-callout', type);
    callout.setAttribute('class', `${CALLOUT_CLASS} ${calloutTypeClass(type)}`);
    const content = element.ownerDocument.createElement('div');
    content.setAttribute('class', CALLOUT_CONTENT_CLASS);
    while (blockquote.firstChild) content.appendChild(blockquote.firstChild);
    // A marker-only callout has no body; `block+` needs one node, so seed an empty
    // paragraph rather than let the parser drop the whole callout.
    if (!content.firstChild) content.appendChild(element.ownerDocument.createElement('p'));
    callout.appendChild(content);
    blockquote.replaceWith(callout);
  });
}

// Both callout shortcuts commit with a trailing space or Enter (see addInputRules), matching
// `#`, `>`, and the rest of the markdown shortcuts. The `:::` trigger words follow the
// unambiguous info < warning < danger severity ladder (Docusaurus-style), mapped onto the
// internal note/warning/caution types — so `:::warning` = caution (amber) and `:::danger` =
// warning (red). Typing conveniences only; storage stays `> [!TYPE]`.
const DIRECTIVE_TYPES: Record<string, CalloutType> = {
  info: 'note',
  warning: 'caution',
  danger: 'warning',
};

// Its own vocabulary, deliberately: `:::warning` is `caution` and `:::danger` is `warning`, so
// this alternation is not the shared CALLOUT_TYPES one and must not be derived from it.
const DIRECTIVE = /^:::(info|warning|danger)\s$/;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      // Insert an empty callout of the given type at the cursor, caret in the body.
      setCallout: (type: CalloutType) => ReturnType;
    };
  }
}

// Enter at the end of an *empty paragraph directly inside the callout* (not one nested deeper,
// e.g. inside a blockquote typed within the callout — see below) exits into a paragraph right
// after the callout, caret there. Mirrors @tiptap/extension-blockquote's default (unwritten)
// behaviour, which this same case reaches via prosemirror-commands' liftEmptyBlock: lifting the
// range out of the blockquote — if it's the blockquote's only child, `lift` has nothing left to
// leave behind, so the whole blockquote is replaced by the lifted (empty) paragraph and
// disappears; with earlier siblings still in it, only the trailing empty one moves out and the
// blockquote survives non-empty. This does the same by hand for the callout — delete the whole
// callout when this empty paragraph is its only child, or just the empty line when it isn't.
//
// `isolating` (below) is exactly why blockquote's own default can't be reused as-is: it blocks
// liftEmptyBlock (and joinBackward's identical lift fallback, which is what already lets Backspace
// remove an empty callout below — this Enter behaviour is that same restoration, applied to the
// other key) from ever crossing the callout's boundary, so without this override Enter would just
// keep splitting inside the callout forever instead of exiting like a blockquote does.
//
// Scoped to depth === 2 (paragraph is a *direct* child of the callout) rather than "any empty
// trailing block regardless of depth": the callout's `block+` content permits nesting (e.g. typing
// `> ` starts a blockquote inside it), and Callout's Enter binding wins the race over that inner
// node's own (Blockquote defines no Enter shortcut at all — see blockquote-extension.ts). Without
// this guard, an empty line at the tail of a *nested* structure would jump out of the whole
// callout instead of that structure's own normal Enter behavior (e.g. lifting out of just the
// blockquote, landing back in the callout body) — surprising, and not what was asked for here.
//
// A callout is never a textblock, so whenever it's the doc's last node, StarterKit's TrailingNode
// already keeps an empty paragraph sitting right after it (see the fenceUndo comment in
// code-block-extension.ts for the same mechanism). Inserting a fresh paragraph unconditionally
// would stack a redundant blank line next to that one; reuse it instead when it's there, and only
// insert a new paragraph when the callout is genuinely followed by something else (or nothing).
function exitCalloutOnEmptyEnter(
  calloutType: NodeType,
  { state, tr, dispatch }: CommandProps,
): boolean {
  const { selection } = state;
  if (!selection.empty) return false;
  const { $from } = selection;
  if ($from.depth !== 2 || $from.node(1).type !== calloutType) return false;
  if ($from.parent.content.size > 0) return false;
  // Only the callout's *last* child exits — mirroring liftEmptyBlock, which lifts an empty block
  // out of its parent only when it's trailing and otherwise splits in place (its `$cursor.after()
  // != $cursor.end(depth - 1)` branch). An empty line that isn't last (a blank typed or navigated
  // into between two body blocks) must stay put and take the default in-callout split; without
  // this guard it would be deleted and the caret would jump out of the callout entirely.
  if ($from.index(1) !== $from.node(1).childCount - 1) return false;
  if (dispatch) {
    const afterCallout = $from.after(1);
    if ($from.node(1).childCount > 1) {
      tr.delete($from.before($from.depth), $from.after($from.depth)); // just the empty trailing line
    } else {
      tr.delete($from.before(1), $from.after(1)); // the callout itself, now fully empty
    }
    const insertAt = tr.mapping.map(afterCallout);
    const next = tr.doc.nodeAt(insertAt);
    if (!(next && next.isTextblock && next.content.size === 0)) {
      tr.insert(insertAt, state.schema.nodes.paragraph.create());
    }
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 1)));
    tr.scrollIntoView();
  }
  return true;
}

// The refusal reporter the slice guard needs, declared as a type (rather than left inferred) so
// `Callout.configure({ onBlocked })` typechecks at the call site in PostEditor — the same shape
// MarkdownTable takes, and the same single notice they both write to (useEditorNotice).
export type CalloutOptions = {
  onBlocked: (message: string) => void;
};

export const Callout = TiptapNode.create<CalloutOptions>({
  name: CALLOUT_NAME,
  group: 'block',
  content: 'block+',
  defining: true,
  // Treat the callout's edges as hard boundaries (like a table cell): regular edits —
  // Backspace at the start of the following block, Delete at the end of the callout — won't
  // cross them, so an adjacent block can't be joined into the callout. Without this, ProseMirror's
  // default joinBackward pulls e.g. a code block right below the callout into its body.
  isolating: true,

  addAttributes() {
    return {
      // Round-trips through the `data-callout` attribute handled in render/parseHTML,
      // so it needs no per-attribute rendering of its own.
      type: { default: 'note', rendered: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-callout]',
        // Only the body lives in the content column; the label chip is chrome.
        contentElement: `.${CALLOUT_CONTENT_CLASS}`,
        getAttrs: (element) => ({ type: toCalloutType(element.getAttribute('data-callout')) }),
      },
    ];
  },

  renderHTML({ node }) {
    const type = calloutTypeOf(node);
    return [
      'div',
      { 'data-callout': type, class: `${CALLOUT_CLASS} ${calloutTypeClass(type)}` },
      [
        'p',
        { class: CALLOUT_TITLE_CLASS, contenteditable: 'false' },
        ['span', { class: CALLOUT_TITLE_LABEL_CLASS }, CALLOUT_TITLES[type]],
      ],
      ['div', { class: CALLOUT_CONTENT_CLASS }, 0],
    ];
  },

  // Live view: the same two-column DOM the public page renders (globals.css paints the
  // accent/tint/icon from the classes), with the label chip as contenteditable=false
  // chrome and only `.markdown-alert-content` as the editable content hole.
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      const title = document.createElement('p');
      title.className = CALLOUT_TITLE_CLASS;
      title.setAttribute('contenteditable', 'false');
      const label = document.createElement('span');
      label.className = CALLOUT_TITLE_LABEL_CLASS;
      title.appendChild(label);
      const content = document.createElement('div');
      content.className = CALLOUT_CONTENT_CLASS;
      dom.appendChild(title);
      dom.appendChild(content);

      const applyType = (type: CalloutType) => {
        dom.className = `${CALLOUT_CLASS} ${calloutTypeClass(type)}`;
        dom.setAttribute('data-callout', type);
        label.textContent = CALLOUT_TITLES[type];
      };
      applyType(calloutTypeOf(node));

      return {
        dom,
        contentDOM: content,
        update: (updated: PMNode) => {
          if (updated.type.name !== 'callout') return false;
          applyType(calloutTypeOf(updated));
          return true;
        },
        // The label chip is chrome: ignore any DOM mutation outside the content hole so
        // ProseMirror never tries to read it back as document content. (`mutation` is
        // ProseMirror's ViewMutationRecord, typed contextually from the NodeView.)
        ignoreMutation: (mutation) => {
          if (mutation.type === 'selection') return false;
          return !content.contains(mutation.target);
        },
      };
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize: serializeCallout,
        parse: { updateDOM: updateCalloutDOM },
      },
    };
  },

  addOptions(): CalloutOptions {
    // Defaults to a no-op so the extension stays usable — and testable — without the host wiring
    // one up; PostEditor supplies the real reporter.
    return { onBlocked: () => {} };
  },

  // Keep dropped and pasted slices from carrying a callout into a callout, or building one where
  // nobody asked for it (see callout-slice-guard.ts).
  addProseMirrorPlugins() {
    return [calloutSliceGuard(this.options.onBlocked)];
  },

  addCommands() {
    return {
      setCallout:
        (type: CalloutType) =>
        ({ state, commands }) => {
          // Callouts are top-level only — the input rules refuse to nest them, so keep this
          // command consistent: on an existing callout, switch its type in place instead of
          // inserting a nested one. Covers both the toolbar menu and the `/` slash command.
          //
          // selectionTouches rather than `editor.isActive(this.name)`, for the reason the guards
          // below share (see selection-scan.ts): isActive only holds while the callout covers the
          // whole selection, so a range overlapping a callout's edge fell through to the insert
          // below — and insertContent *replaces* a range, which left the selected text swapped for
          // a new empty callout beside the remains of the old one. Nothing outside the selection
          // was lost and the markdown stayed valid, so this was untidiness rather than corruption,
          // but it is the same defect as the four below and it now answers the same way.
          //
          // updateAttributes handles every selection shape this admits: measured, it retypes the
          // one callout an overlapping range touches, and retypes *both* when a selection spans a
          // pair — which is what "apply this type to what I selected" should mean. A selection
          // touching a callout and a blockquote at once still lands here rather than in the
          // blockquote refusal below, which is what keeps a loaded `> > [!NOTE]` retypable.
          if (selectionTouches(state, this.name)) {
            return commands.updateAttributes(this.name, { type });
          }
          // A table cell can't hold a callout (paragraph-only cells — markdown has no
          // way to store one), and inserting from inside a table would split it in two
          // around the callout. Refuse, mirroring the input rules' top-level-only checks.
          //
          // Same refusal inside a quote. This one is about meaning rather than storage —
          // it round-trips fine (`> > [!NOTE]`, and lib/remark-github-alerts.ts transforms
          // a nested alert correctly) — but a blockquote is someone else's words while a
          // callout is the author's own aside, so nesting one in the other misattributes
          // it. Nested *quotes* stay allowed: `> >` is native markdown that pasted or
          // imported content can carry, so the editor has to represent it either way.
          // Switching an existing nested callout's type still works — that's the
          // isActive(callout) branch above, which runs first.
          //
          // Both ask selectionTouches rather than `editor.isActive(...)`, which only holds for a
          // caret (see selection-scan.ts). A selection reaching from the paragraph above into
          // either one used to pass, and insertContent then *replaced* the range: the table
          // vanished outright, and the quote lost the text the selection had covered.
          //
          // `detailsSummary` is the third, and it is the one that breaks *structurally*. An
          // accordion's title is `text*`, so it holds no block at all — and ProseMirror does not
          // refuse, it makes room: the fitter splits the accordion in two around the callout and
          // grows a second, untitled one from the title's remainder, which then saves as two
          // `<details>`. Measured (docs/accordion-requirements.md §6.5 records the same tear for
          // the footnote). Naming `detailsSummary` and never `details` is deliberate: §6.3 blesses
          // a callout in the accordion's *body*, which is `block+` and takes one cleanly.
          if (selectionTouches(state, 'table', 'blockquote', 'detailsSummary')) return false;
          return commands.insertContent({
            type: this.name,
            attrs: { type },
            content: [{ type: 'paragraph' }],
          });
        },
    };
  },

  // `isolating` (above) stops Backspace from crossing the callout's edges, reshaping two boundary
  // presses — we tune both so they feel right:
  //   • at the start of an *empty* callout → unwrap it to a plain paragraph (there's no toolbar
  //     toggle to clear a callout, so this is how you remove one from inside);
  //   • at the start of the block right *after* a callout → step the caret into the callout's end
  //     (backspaceIntoPreviousIsolating), shared with the code block, not a bare node-selection.
  // A non-empty callout's own start is left alone (clear it first).
  //
  // Delete gets the mirror treatment at the callout's *end*: stepIntoNextIsolating deletes a
  // following empty block outright; a non-empty one is already a safe no-op via `isolating`.
  //
  // Enter at that same end (an empty trailing line) exits the callout instead of splitting
  // forever inside it — see exitCalloutOnEmptyEnter's comment for why `isolating` needs a
  // hand-built transaction here rather than the default liftEmptyBlock.
  addKeyboardShortcuts() {
    const calloutType = this.type;
    return {
      Backspace: ({ editor }) =>
        editor.commands.command((props) => {
          const { state, tr, dispatch } = props;
          const { selection } = state;
          if (!selection.empty) return false;
          const { $from } = selection;

          // Case 1 (callout-specific): inside an *empty* callout — a single empty textblock —
          // unwrap it to a plain paragraph. A non-empty callout is left alone (clear it first).
          let depth = $from.depth;
          while (depth > 0 && $from.node(depth).type !== calloutType) depth -= 1;
          if (depth > 0) {
            const callout = $from.node(depth);
            const child = callout.childCount === 1 ? callout.firstChild : null;
            if (!child || !child.isTextblock || child.content.size > 0) return false;
            if (dispatch) {
              const from = $from.before(depth);
              tr.replaceWith(from, from + callout.nodeSize, state.schema.nodes.paragraph.create());
              tr.setSelection(TextSelection.create(tr.doc, from + 1));
              tr.scrollIntoView();
            }
            return true;
          }

          // Case 2 (shared): from the block just below, step into the callout's end.
          return stepIntoPreviousIsolating(calloutType, props);
        }),
      Delete: ({ editor }) =>
        editor.commands.command((props) => stepIntoNextIsolating(calloutType, props)),
      // Exit the callout on Enter at an empty trailing line — see exitCalloutOnEmptyEnter.
      Enter: ({ editor }) =>
        editor.commands.command((props) => exitCalloutOnEmptyEnter(calloutType, props)),
    };
  },

  // Two typing shortcuts, both committed with a trailing space or Enter (like `#`, `>`): the
  // Zenn/Qiita `:::info` directive on a top-level paragraph, and the GitHub `> [!NOTE]` marker
  // on a top-level blockquote's first line. Both leave the caret in the callout body.
  addInputRules() {
    const calloutType = this.type;
    return [
      new InputRule({
        find: DIRECTIVE,
        handler: ({ state, range, match }) => {
          const type = DIRECTIVE_TYPES[match[1]];
          // Top-level only ($start.depth === 1): never wrap inside a quote, list, cell, or
          // another callout.
          if (!type || state.doc.resolve(range.from).depth !== 1) return null;
          const { tr } = state;
          tr.delete(range.from, range.to);
          const blockRange = tr.doc.resolve(range.from).blockRange();
          const wrapping = blockRange && findWrapping(blockRange, calloutType, { type });
          if (!wrapping) return null;
          tr.wrap(blockRange, wrapping);
          return undefined;
        },
      }),
      new InputRule({
        find: CALLOUT_MARKER_INPUT,
        handler: ({ state, range, match }) => {
          const type = toCalloutType(match[1].toLowerCase());
          // The marker must be the first line of a top-level blockquote (doc > blockquote >
          // paragraph); anything else is left as a plain quote.
          const $from = state.doc.resolve(range.from);
          if (
            $from.depth !== 2 ||
            $from.node(1).type.name !== 'blockquote' ||
            $from.index(1) !== 0
          ) {
            return null;
          }
          // Body = the blockquote's blocks after the marker paragraph, or a fresh empty one.
          const body: PMNode[] = [];
          $from.node(1).forEach((child, _offset, index) => {
            if (index > 0) body.push(child);
          });
          const content =
            body.length > 0
              ? Fragment.fromArray(body)
              : Fragment.from(state.schema.nodes.paragraph.create());
          const callout = calloutType.create({ type }, content);
          const { tr } = state;
          tr.replaceWith($from.before(1), $from.after(1), callout);
          tr.setSelection(TextSelection.near(tr.doc.resolve($from.before(1) + 2)));
          return undefined;
        },
      }),
    ];
  },
});
