import { InputRule, Node as TiptapNode } from '@tiptap/core';
import type { CommandProps } from '@tiptap/core';
import {
  Fragment,
  Slice,
  type Node as PMNode,
  type NodeType,
  type ResolvedPos,
} from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { resolveDropTarget } from './drop-target';
import { findWrapping } from '@tiptap/pm/transform';
import { stepIntoNextIsolating, stepIntoPreviousIsolating } from './isolating-boundary';
import { selectionTouches } from './selection-scan';
import type { MarkdownSerializerState } from './markdown-serializer-state';

// GitHub-style alert callouts as a first-class editor node. The three tiers
// (情報 → 警告 → 注意) mirror the render transform (lib/remark-github-alerts.ts): the
// marker is NOT stored as editable text — it lives in the node's `type` attribute and
// shows as a non-editable label chip, so it can't be broken by typing after the `]`.
// Markdown stays the storage format: the node serializes back to `> [!TYPE]` and is
// parsed from it, so the public render pipeline and existing posts are unchanged.
export type CalloutType = 'note' | 'warning' | 'caution';

// Menu display order (toolbar dropdown + slash menu), 情報 → 注意 → 警告. Distinct from the
// render/severity ladder below — it's just the order the insert menus list the types in.
export const CALLOUT_TYPES: readonly CalloutType[] = ['note', 'caution', 'warning'];

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
export function toCalloutType(value: string | null | undefined): CalloutType {
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

const CALLOUT_NAME = 'callout';

// The two containers a callout may not be *placed* into, and the same two setCallout refuses to
// insert one into (see addCommands): another callout, and a blockquote. The first is a shape nothing
// in the editor can author on purpose — the input rules are top-level only and setCallout retypes in
// place instead of nesting. The second is an editorial rule rather than a storage one: `> > [!NOTE]`
// round-trips perfectly well, but a blockquote is someone else's words and a callout is the author's
// own aside, so nesting one in the other misattributes it.
const CALLOUT_HOSTILE_ANCESTORS = new Set([CALLOUT_NAME, 'blockquote']);

// Would the slice put a callout inside one of those? A slice carries a whole callout when the block
// drag handle's NodeSelection picked one up, or when a selection swallowed the box end-to-end on its
// way past — and dropping or pasting that into either container puts the node in as a child.
//
// Both halves have to be true. Either alone is fine: moving a callout around at top level is an
// ordinary edit, and so is dragging plain text into a callout or a quote.
//
// This is the *whole*-callout half of the problem only. A selection that merely crosses a callout's
// edge also arrives carrying a box the user never meant to move; that one is settled separately, by
// halfSelectedEdges below.
//
// Guarding the gesture rather than the schema is deliberate. `content: 'block+'` above is what lets
// a nested callout *load*: `> [!NOTE]` inside another quote level is legal markdown that an imported
// post can carry, and lib/remark-github-alerts.ts renders it. Forbidding the shape in the schema
// would silently drop that content on open; forbidding the gesture leaves stored documents alone.
// Same reasoning, and the same shape, as tableDropGuard in table-extensions.ts.
export function wouldNestCallout($pos: ResolvedPos, slice: Slice): boolean {
  let carriesCallout = false;
  slice.content.descendants((node) => {
    if (node.type.name === CALLOUT_NAME) carriesCallout = true;
  });
  if (!carriesCallout) return false;
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if (CALLOUT_HOSTILE_ANCESTORS.has($pos.node(depth).type.name)) return true;
  }
  return false;
}

// The other half, and the one that made "cover every case" feel endless: a selection that crosses a
// callout's edge — from inside one down into the paragraph below, or the reverse. ProseMirror hands
// that drag the callout node too, and *no* destination does anything sensible with it. Dropped
// inside another callout it nested; dropped outside every callout it built a brand new box around
// the moved text. Enumerating destinations was chasing the wrong axis, because the gesture is
// already unanswerable when it starts: half a box is not a box, and it is not plain text either.
//
// So it is refused wherever it is aimed — one question about the slice, no question about position.
//
// "Half" is read off the open depths. openStart/openEnd say how deep the slice was cut at each end,
// so a callout at the first (or last) child position with a non-zero depth on that side was entered
// mid-way by the selection. What makes it *materialise* is being cut on one side only: the other
// side is a real node boundary, so ProseMirror has to keep the box to close it. A callout open on
// both sides — the whole slice for a selection made wholly inside one — has no closed edge to
// preserve, fits in as plain text wherever it lands, and is deliberately left alone. So is a callout
// the selection covers end-to-end, including the block drag handle's NodeSelection (openStart =
// openEnd = 0, see block-drag-handle.ts): that one really is a box being moved, and it is
// wouldNestCallout above that decides where it may go.
//
// Refusing rather than repairing the slice is deliberate, and it is the source side that forces it.
// A move deletes the dragged range before inserting, and a ranged delete across the callout's edge
// joins the box to the block below it despite `isolating: true` — prosemirror-transform's isolating
// checks guard where a slice may be *placed*, not the frontier a deletion closes over. So even with
// a perfectly normalised slice the drop leaves the callout having swallowed the following paragraph.
// Refusing outright is the only outcome that leaves the document untouched. (The same join is
// reachable from the keyboard — select across the edge, press Backspace — which is a separate,
// pre-existing defect this guard neither causes nor fixes.)
//
// A copy-drag (the modifier held, `handleDrop`'s `move` false) deletes nothing and so could be
// repaired like a paste instead. It is refused with the rest deliberately: the gesture is the same
// gesture, told apart only by a key the user is holding, and one drag behaving two ways depending on
// that is worse than one that behaves once. Paste is a different gesture and gets the other answer.
function halfSelectedEdges(slice: Slice): { start: boolean; end: boolean } {
  const { content, openStart, openEnd } = slice;
  const first = content.firstChild;
  const last = content.lastChild;
  if (!first || !last) return { start: false, end: false };
  const start = openStart > 0 && first.type.name === CALLOUT_NAME;
  const end = openEnd > 0 && last.type.name === CALLOUT_NAME;
  // One callout, cut on both sides: nothing to close around, so nothing to answer for.
  if (content.childCount === 1 && start && end) return { start: false, end: false };
  return { start, end };
}

export function carriesHalfSelectedCallout(slice: Slice): boolean {
  const { start, end } = halfSelectedEdges(slice);
  return start || end;
}

// Paste gets the repair the drop can't have. The slice is the same broken shape — copy across a
// callout's edge and the clipboard carries the box, `data-pm-slice` round-tripping the open depths
// that make it materialise — but the *reason* drops are refused doesn't apply: a paste deletes
// nothing at the source, so there is no join to walk into. Normalising is simply right here, and it
// leaves the paste doing what the gesture plainly meant: the text comes over, the box does not.
//
// Each half-selected edge is replaced by that callout's own children, which drops exactly the one
// level of depth the box occupied. Everything halfSelectedEdges leaves alone is left alone: a whole
// callout in the middle of the slice, or one cut on both sides, still pastes as it did.
export function unwrapHalfSelectedCallouts(slice: Slice): Slice {
  const { start, end } = halfSelectedEdges(slice);
  if (!start && !end) return slice;
  const lastIndex = slice.content.childCount - 1;
  const children: PMNode[] = [];
  slice.content.forEach((child, _offset, index) => {
    if ((start && index === 0) || (end && index === lastIndex)) {
      child.content.forEach((grandChild) => children.push(grandChild));
    } else {
      children.push(child);
    }
  });
  return new Slice(
    Fragment.fromArray(children),
    start ? slice.openStart - 1 : slice.openStart,
    end ? slice.openEnd - 1 : slice.openEnd,
  );
}

// The nesting case, on the paste side. A callout the selection covered end-to-end is a real box and
// stays one — but pasted into either of CALLOUT_HOSTILE_ANCESTORS it is the same forbidden shape a
// drop is refused for, and Ctrl+V reached both just as easily as a drag did. Here the box is dropped
// and its contents kept, which is the paste-shaped answer: nothing was deleted to get here, so
// nothing is lost by letting the text land where the caret is.
//
// Every depth, not just the slice's top level. A callout can sit one or more levels down — copy a
// quote that holds one (`> > [!NOTE]`, which loads from stored markdown even though it can no
// longer be authored) and the slice is blockquote(callout(…)). wouldNestCallout looks at every
// descendant, so a shallow repair reported "this needs fixing" and then returned the slice
// untouched, and the paste nested the box after all — while the same slice dropped was refused.
//
// The one thing that must not move is a node on an open edge. openStart/openEnd count levels down
// the slice's first and last child, and removing a node on either path would leave those depths
// describing content that is no longer there — ProseMirror throws on the mismatch. So the rule is:
// a callout is removable only where both open counts have run out. `startOpen`/`endOpen` follow
// the two paths down (a single child can be on both, which is the cut-on-both-sides case), and
// anything off them is fair game however deep it is.
//
// Restructuring off-path subtrees is safe because `child.copy(inner)` keeps the node itself, so no
// path ever gets shorter. Splicing a callout's `block+` children into its parent stays
// schema-valid throughout: blockquote and callout are both `block+`, listItem is `paragraph block*`
// so a callout can only ever sit at index ≥ 1 there, and cells are paragraph-only so none lives in
// one. Text nodes end the recursion on their own — an empty content fragment comes back unchanged.
//
// Returns the same Fragment when nothing changed, which is what lets the caller keep its identity
// check and skip dispatching a redundant transaction.
function flattenCallouts(fragment: Fragment, openStart: number, openEnd: number): Fragment {
  const lastIndex = fragment.childCount - 1;
  const children: PMNode[] = [];
  let changed = false;
  fragment.forEach((child, _offset, index) => {
    const startOpen = index === 0 ? openStart : 0;
    const endOpen = index === lastIndex ? openEnd : 0;
    if (startOpen === 0 && endOpen === 0 && child.type.name === CALLOUT_NAME) {
      changed = true;
      flattenCallouts(child.content, 0, 0).forEach((grandChild) => children.push(grandChild));
      return;
    }
    const inner = flattenCallouts(
      child.content,
      Math.max(startOpen - 1, 0),
      Math.max(endOpen - 1, 0),
    );
    if (inner === child.content) {
      children.push(child);
      return;
    }
    changed = true;
    children.push(child.copy(inner));
  });
  return changed ? Fragment.fromArray(children) : fragment;
}

function flattenClosedCallouts(slice: Slice): Slice {
  const { content, openStart, openEnd } = slice;
  const flattened = flattenCallouts(content, openStart, openEnd);
  return flattened === content ? slice : new Slice(flattened, openStart, openEnd);
}

const calloutSliceGuardKey = new PluginKey('calloutSliceGuard');

// Both gestures that can hand the editor a callout nobody asked for, and the two different answers
// they get: a drop is refused, a paste is repaired. `handlePaste` rather than `transformPasted`
// because the two are not the same hook — prosemirror-view runs transformPasted over the *drag*
// slice too (handleDrop's `view.dragging.slice`, before any handleDrop prop sees it), so unwrapping
// there would quietly disarm the refusal above and hand the drop back its mangle.
function calloutSliceGuard(): Plugin {
  return new Plugin({
    key: calloutSliceGuardKey,
    props: {
      handlePaste(view, _event, slice) {
        const { $from } = view.state.selection;
        const unwrapped = unwrapHalfSelectedCallouts(slice);
        // A whole box in the slice can't go into a callout or a quote either, same as a drop.
        const repaired = wouldNestCallout($from, unwrapped)
          ? flattenClosedCallouts(unwrapped)
          : unwrapped;
        if (repaired === slice) return false;
        // What ProseMirror's own paste does with the slice, metas included — the only difference is
        // which slice it gets.
        view.dispatch(
          view.state.tr
            .replaceSelection(repaired)
            .scrollIntoView()
            .setMeta('paste', true)
            .setMeta('uiEvent', 'paste'),
        );
        return true;
      },
      handleDrop(view, event, slice, moved) {
        // Asked first, and without looking at where the pointer is: a half-selected callout is
        // refused at every destination (see carriesHalfSelectedCallout).
        if (carriesHalfSelectedCallout(slice)) {
          event.preventDefault();
          return true;
        }
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!coords) return false;
        // resolveDropTarget, not the raw position: a move deletes the dragged range first, and for
        // a selection running out of a callout that deletion joins the callout to what follows —
        // which is how a drop that looked like it landed *outside* still nested (see drop-target.ts).
        // `moved` is prosemirror-view's own move-vs-copy verdict for *this* event, which is why it
        // is threaded through rather than re-read from view.dragging (stale since dragstart).
        if (!wouldNestCallout(resolveDropTarget(view, coords.pos, slice, moved), slice))
          return false;
        // Returning true makes ProseMirror preventDefault and skip the drop entirely, so the
        // dragged text stays where it was instead of being deleted from its source.
        event.preventDefault();
        return true;
      },
    },
  });
}

export const Callout = TiptapNode.create({
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

  // Keep dropped and pasted slices from carrying a callout into a callout, or building one where
  // nobody asked for it (see calloutSliceGuard).
  addProseMirrorPlugins() {
    return [calloutSliceGuard()];
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
          if (selectionTouches(state, 'table', 'blockquote')) return false;
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
