import { InputRule, Node as TiptapNode } from '@tiptap/core';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { findWrapping } from '@tiptap/pm/transform';
import type { MarkdownSerializerState } from './markdown-serializer-state';

// GitHub-style alert callouts as a first-class editor node. The three tiers
// (情報 → 警告 → 注意) mirror the render transform (lib/remark-github-alerts.ts): the
// marker is NOT stored as editable text — it lives in the node's `type` attribute and
// shows as a non-editable label chip, so it can't be broken by typing after the `]`.
// Markdown stays the storage format: the node serializes back to `> [!TYPE]` and is
// parsed from it, so the public render pipeline and existing posts are unchanged.
export type CalloutType = 'note' | 'warning' | 'caution';

export const CALLOUT_TYPES: readonly CalloutType[] = ['note', 'warning', 'caution'];

// The GitHub-alert tag written to markdown, one per type.
const CALLOUT_MARKERS: Record<CalloutType, string> = {
  note: '[!NOTE]',
  warning: '[!WARNING]',
  caution: '[!CAUTION]',
};

// Japanese callout titles (site UI is Japanese). A local copy of the render module's
// TITLES: this is a client extension and must never import the server-only render code.
export const CALLOUT_TITLES: Record<CalloutType, string> = {
  note: '情報',
  warning: '警告',
  caution: '注意',
};

// The marker must sit alone on the blockquote's first line (GitHub's rule), same
// pattern the render transform uses. Case-insensitive so `[!note]` also matches.
const MARKER = /^\[!(note|warning|caution)\][^\S\n]*(?:\n|$)/i;

// Narrow a raw attribute / capture group to a CalloutType, defaulting to note.
function toCalloutType(value: string | null | undefined): CalloutType {
  return value === 'warning' || value === 'caution' ? value : 'note';
}

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

    const match = (firstNode.nodeValue ?? '').match(MARKER);
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
    callout.setAttribute('class', `markdown-alert markdown-alert-${type}`);
    const content = element.ownerDocument.createElement('div');
    content.setAttribute('class', 'markdown-alert-content');
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

const DIRECTIVE = /^:::(info|warning|danger)\s$/;

// The GitHub-alert marker on a blockquote's first line, ready to commit. Distinct from
// MARKER above, which detects an already-stored marker (followed by newline/end) at parse time.
const MARKER_INPUT = /^\[!(note|warning|caution)\]\s$/i;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      // Insert an empty callout of the given type at the cursor, caret in the body.
      setCallout: (type: CalloutType) => ReturnType;
    };
  }
}

export const Callout = TiptapNode.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

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
        contentElement: '.markdown-alert-content',
        getAttrs: (element) => ({ type: toCalloutType(element.getAttribute('data-callout')) }),
      },
    ];
  },

  renderHTML({ node }) {
    const type = calloutTypeOf(node);
    return [
      'div',
      { 'data-callout': type, class: `markdown-alert markdown-alert-${type}` },
      [
        'p',
        { class: 'markdown-alert-title', contenteditable: 'false' },
        ['span', { class: 'markdown-alert-title-label' }, CALLOUT_TITLES[type]],
      ],
      ['div', { class: 'markdown-alert-content' }, 0],
    ];
  },

  // Live view: the same two-column DOM the public page renders (globals.css paints the
  // accent/tint/icon from the classes), with the label chip as contenteditable=false
  // chrome and only `.markdown-alert-content` as the editable content hole.
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      const title = document.createElement('p');
      title.className = 'markdown-alert-title';
      title.setAttribute('contenteditable', 'false');
      const label = document.createElement('span');
      label.className = 'markdown-alert-title-label';
      title.appendChild(label);
      const content = document.createElement('div');
      content.className = 'markdown-alert-content';
      dom.appendChild(title);
      dom.appendChild(content);

      const applyType = (type: CalloutType) => {
        dom.className = `markdown-alert markdown-alert-${type}`;
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

  addCommands() {
    return {
      setCallout:
        (type: CalloutType) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { type },
            content: [{ type: 'paragraph' }],
          }),
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
        find: MARKER_INPUT,
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
