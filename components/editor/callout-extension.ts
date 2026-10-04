import { InputRule, Node as TiptapNode } from '@tiptap/core';
import type { CommandProps } from '@tiptap/core';
import { Fragment, type Node as PMNode, type NodeType } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { CALLOUT_NAME, calloutSliceGuard } from './callout-slice-guard';
import { findWrapping } from '@tiptap/pm/transform';
import { stepIntoNextIsolating, stepIntoPreviousIsolating } from './isolating-boundary';
import { BLOCK_ATOMS, selectionTouches } from './selection-scan';
import { BLOCK_REFUSING_BOXES } from './summary-rules';
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

// Enter on an empty paragraph that is a direct, trailing child of the callout exits into a
// paragraph after it, as a blockquote does via liftEmptyBlock: the whole callout goes if the
// paragraph was its only child. `isolating` stops liftEmptyBlock from crossing the edge, so without
// this Enter would split inside the callout forever.
//
// Only at depth 2: Callout's Enter wins over nested nodes' own, so a deeper empty line must keep
// its structure's normal behaviour. The trailing paragraph TrailingNode keeps after a last-node
// callout is reused rather than stacking a second blank line.
function exitCalloutOnEmptyEnter(
  calloutType: NodeType,
  { state, tr, dispatch }: CommandProps,
): boolean {
  const { selection } = state;
  if (!selection.empty) return false;
  const { $from } = selection;
  if ($from.depth !== 2 || $from.node(1).type !== calloutType) return false;
  if ($from.parent.content.size > 0) return false;
  // Only the last child exits, as in liftEmptyBlock (`$cursor.after() != $cursor.end(depth - 1)`);
  // a blank line between body blocks takes the default split.
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

// Declared so `Callout.configure({ onBlocked })` typechecks; the same shape MarkdownTable takes.
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
    // A no-op default, so the extension works (and tests) without the host's reporter.
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
          // On an existing callout, retype it in place rather than nesting. selectionTouches, not
          // isActive, so a range overlapping the edge is caught too; updateAttributes retypes
          // every callout the selection touches. Checked before the quote refusal below, which
          // keeps a loaded `> > [!NOTE]` retypable.
          if (selectionTouches(state, this.name)) {
            return commands.updateAttributes(this.name, { type });
          }
          // Refused where a callout cannot go, asked with selectionTouches (a range reaching into
          // the host would otherwise be replaced):
          //  - a table cell (paragraph-only; the table would split around it);
          //  - a quote: storage is fine, but a quote is someone else's words and a callout the
          //    author's aside (docs/editor-pitfalls.md §6.1);
          //  - an accordion title, which is `text*`, so the fitter would split the accordion
          //    (docs/accordion-requirements.md §6.5). Never `details`: its body takes a callout;
          //  - a まとめ or a TL;DR, which hold prose only (docs/summary-requirements.md §3.1);
          //  - a selected block atom (BLOCK_ATOMS, selection-scan.ts).
          if (
            selectionTouches(
              state,
              'table',
              'blockquote',
              'detailsSummary',
              ...BLOCK_REFUSING_BOXES,
              ...BLOCK_ATOMS,
            )
          )
            return false;
          return commands.insertContent({
            type: this.name,
            attrs: { type },
            content: [{ type: 'paragraph' }],
          });
        },
    };
  },

  // `isolating` stops Backspace at the edges, so the boundary presses are defined here:
  //   • Backspace at the start of an *empty* callout unwraps it (the only way to remove one from
  //     inside); at a non-empty one's start it does nothing;
  //   • Backspace at the start of the next block steps into the callout's end;
  //   • Delete at the end removes a following empty block;
  //   • Enter on an empty trailing line exits (exitCalloutOnEmptyEnter).
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
