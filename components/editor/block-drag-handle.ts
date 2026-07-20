import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';

// Top-level-only reorder targets. A nested instance (e.g. a blockquote inside a callout) gets
// no handle of its own — doc.forEach below only sees direct children of the doc, which already
// excludes it, so no extra filtering is needed. Extend this set to broaden scope later (headings
// need the section-range question settled first — see the design discussion — so they're not here).
const DRAGGABLE_TYPES = new Set(['blockquote', 'callout', 'image', 'table', 'codeBlock']);

// Pointer movement (px) before a mousedown-on-handle counts as a drag rather than a plain click
// (which just leaves the mousedown NodeSelection in place — see the "mousedown creates a
// NodeSelection" behavior this preserves).
const DRAG_THRESHOLD = 4;

interface DragSession {
  node: ProseMirrorNode;
  from: number;
  to: number;
  handleEl: HTMLElement;
  startX: number;
  startY: number;
  dragging: boolean;
  target: number | null;
}

interface Boundary {
  pos: number;
  y: number;
  left: number;
  width: number;
}

// Finds the doc position to drop at for a given pointer Y, plus where to draw the indicator line
// (matching the width of the top-level blocks themselves — not `.ProseMirror`'s own box, which is
// wider by its `px-4` padding on each side and would overhang past the blocks' actual edges).
// Only positions between top-level siblings are candidates — dropping a whole top-level node only
// ever makes sense at another top-level gap, and restricting to gaps that already exist means the
// position is always schema-valid without needing prosemirror-transform's generic (and here
// unnecessary) `dropPoint`. Built from `view.nodeDOM` + `getBoundingClientRect` rather than
// `view.posAtCoords`: the pointer roams outside the content area during a drag (that's the point of
// a custom drag), and `posAtCoords` returns null there.
function findBoundary(view: EditorView, clientY: number): Boundary {
  const children: { offset: number; top: number; bottom: number; left: number; width: number }[] =
    [];
  view.state.doc.forEach((_node, offset) => {
    const dom = view.nodeDOM(offset);
    if (dom instanceof HTMLElement) {
      const rect = dom.getBoundingClientRect();
      children.push({
        offset,
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
      });
    }
  });
  for (const child of children) {
    if (clientY < (child.top + child.bottom) / 2) {
      return { pos: child.offset, y: child.top, left: child.left, width: child.width };
    }
  }
  const last = children[children.length - 1];
  if (!last) return { pos: view.state.doc.content.size, y: 0, left: 0, width: 0 };
  return { pos: view.state.doc.content.size, y: last.bottom, left: last.left, width: last.width };
}

// Drives one drag session end-to-end via plain mouse tracking instead of native HTML5
// drag-and-drop. Native drag was dropped because its no-drop cursor is governed by DOM
// containment (prosemirror-view's dragover/drop handlers only fire while `event.target` stays a
// descendant of `view.dom`), which made the handle's own on-screen position load-bearing for
// something that has nothing to do with it. A plain `mousemove`/`mouseup` pair has no such
// constraint — the pointer can go anywhere.
class DragController {
  private session: DragSession | null = null;
  private indicator: HTMLElement | null = null;
  private readonly onMouseMove = (event: MouseEvent) => this.handleMouseMove(event);
  private readonly onMouseUp = () => this.handleMouseUp();

  constructor(private readonly view: EditorView) {}

  // True from mousedown-on-handle until the session ends (drop, Escape, or an aborting doc change) —
  // covers the pre-DRAG_THRESHOLD "picked up but not yet moving" window too. The plugin's
  // handleKeyDown reads this to run the drag modally (swallow edit keys while it holds).
  isDragging(): boolean {
    return this.session != null;
  }

  // Cancel an in-flight drag without applying any move — used by both Escape and the doc-changed
  // backstop. endSession() already tears down listeners, the body class, and the indicator.
  abort(): void {
    this.endSession();
  }

  start(
    node: ProseMirrorNode,
    from: number,
    to: number,
    handleEl: HTMLElement,
    clientX: number,
    clientY: number,
  ): void {
    this.session = {
      node,
      from,
      to,
      handleEl,
      startX: clientX,
      startY: clientY,
      dragging: false,
      target: null,
    };
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
  }

  destroy(): void {
    this.endSession();
    this.indicator?.remove();
    this.indicator = null;
  }

  private handleMouseMove(event: MouseEvent): void {
    const session = this.session;
    if (!session) return;
    if (!session.dragging) {
      if (
        Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < DRAG_THRESHOLD
      ) {
        return;
      }
      session.dragging = true;
      document.body.classList.add('block-dragging');
      // CSS `:hover`/`:has(+ :hover)` (globals.css) stop tracking the real cursor once a native
      // HTML5 drag starts (a well-known browser quirk — hover freezes at the drag-start position
      // until drop), which is what kept the source handle visible throughout the old native-drag
      // implementation. Plain `mousemove` has no such freeze, so once the pointer leaves the
      // dragged block, `:hover` correctly stops matching and the handle would otherwise vanish
      // mid-drag. This class forces it to stay visible for the session's duration instead.
      session.handleEl.classList.add('is-dragging');
    }
    const { pos, y, left, width } = findBoundary(this.view, event.clientY);
    session.target = pos;
    const el = this.ensureIndicator();
    el.style.display = 'block';
    el.style.top = `${y}px`;
    el.style.left = `${left}px`;
    el.style.width = `${width}px`;
  }

  private handleMouseUp(): void {
    const session = this.session;
    this.endSession();
    if (!session || !session.dragging || session.target == null) return;
    this.applyMove(session.node, session.from, session.to, session.target);
  }

  private endSession(): void {
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    document.body.classList.remove('block-dragging');
    this.session?.handleEl.classList.remove('is-dragging');
    if (this.indicator) this.indicator.style.display = 'none';
    this.session = null;
  }

  private ensureIndicator(): HTMLElement {
    if (!this.indicator) {
      const el = document.createElement('div');
      el.className = 'block-drag-indicator';
      el.style.display = 'none';
      document.body.appendChild(el);
      this.indicator = el;
    }
    return this.indicator;
  }

  // Both gaps flanking the dragged node (`from` and `to`) mean "put it back where it came from" —
  // skip the transaction rather than issuing a no-op undo-history entry.
  //
  // Consequence (considered and kept, not an oversight): since findBoundary() still counts the
  // dragged node itself among the top-level siblings it scans (its DOM hasn't gone anywhere until
  // drop), moving it down by just one slot means the pointer has to cross *two* boundaries — its own
  // trailing gap (`to`, a no-op per this guard) and then the next node's — not one. The fix that
  // looks obvious, excluding the dragged node from findBoundary()'s candidates, was tried and
  // reverted: with it excluded, the closest-boundary search can jump the indicator to the *next*
  // node's gap while the pointer is still visually over the dragged node itself, since the node
  // that would normally "catch" the pointer there is no longer a candidate. That desync between
  // cursor and indicator reads as broken; needing a bit more pointer travel to register a move does
  // not. A real fix would collapse the dragged node's own layout space during the drag (as
  // Notion/Trello do) so the two notions of "candidate gaps" and "what's actually on screen" stay
  // in sync — out of scope here.
  private applyMove(node: ProseMirrorNode, from: number, to: number, target: number): void {
    if (target === from || target === to) return;
    const tr = this.view.state.tr.delete(from, to);
    const pos = tr.mapping.map(target);
    tr.insert(pos, node);
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    this.view.dispatch(tr);
    this.view.focus();
  }
}

const controllers = new WeakMap<EditorView, DragController>();

function handleToDOM(view: EditorView, getPos: () => number | undefined): HTMLElement {
  const handle = document.createElement('div');
  handle.className = 'block-drag-handle';
  handle.setAttribute('contenteditable', 'false');
  handle.setAttribute('aria-label', 'ブロックをドラッグして並べ替え');
  handle.innerHTML =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<circle cx="9" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/>' +
    '<circle cx="15" cy="6" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="18" r="1.5"/>' +
    '</svg>';
  // preventDefault suppresses native text-selection (mousedown-and-drag across contenteditable
  // otherwise selects text the whole way) — the drag itself is driven by DragController below, not
  // by the browser, so there's no native drag-initiation left to worry about suppressing.
  handle.addEventListener('mousedown', (event) => {
    const pos = getPos();
    if (pos == null) return;
    const node = view.state.doc.nodeAt(pos);
    if (!node) return;
    event.preventDefault();
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    view.focus();
    controllers
      .get(view)
      ?.start(node, pos, pos + node.nodeSize, handle, event.clientX, event.clientY);
  });
  return handle;
}

// Each handle is `position: absolute` (globals.css) so it never displaces the block it belongs
// to, anchored against `.ProseMirror`'s own `position: relative`. Both the handle and its target
// sibling then share the same offsetParent (`.ProseMirror` — neither the handle's target sibling
// nor anything between them is itself positioned), so the target's plain `offsetTop` *is* the
// correct `top` for the handle: no getBoundingClientRect/scroll-position math needed, just the
// browser's own layout of the two boxes. Horizontal placement is a fixed CSS offset (every
// target type sits at the same left edge as a top-level doc child), so only `top` needs JS at all.
function alignHandles(view: EditorView): void {
  view.dom.querySelectorAll<HTMLElement>(':scope > .block-drag-handle').forEach((handle) => {
    const sibling = handle.nextElementSibling;
    if (sibling instanceof HTMLElement) handle.style.top = `${sibling.offsetTop}px`;
  });
}

// A hover-revealed grip in the left gutter of blockquotes, callouts, images, tables, and code
// blocks, for selecting (and dragging to reorder) the whole block in one action — mousedown-only
// for now, no keyboard equivalent.
//
// One handle per matching top-level node, via a widget decoration placed immediately before it
// (`side: -1`) rather than a NodeView: none of blockquote/image/table already have one, and a
// single decoration-scan plugin covers all five without adding three new NodeViews. There's no
// mousemove-driven hit-testing for *showing* a handle either — the widget is a real sibling in the
// document flow, and CSS (`:has(+ :hover)`, globals.css) reveals it exactly when the block right
// after it is hovered. Actually *dragging* it, once picked up, is DragController's job (above).
export const BlockDragHandle = Extension.create({
  name: 'blockDragHandle',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('blockDragHandle'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.forEach((node, offset) => {
              if (DRAGGABLE_TYPES.has(node.type.name)) {
                decorations.push(Decoration.widget(offset, handleToDOM, { side: -1 }));
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
          // Run the drag modally: while a session is live, the dragged block carries a
          // NodeSelection, so an unswallowed Delete/Backspace would fire ProseMirror's
          // deleteSelection and remove it mid-drag — the doc then shrinks and applyMove's
          // mousedown-captured from/to point past the end ("Position … out of range" on drop). This
          // fires before ProseMirror's own keymaps (a window listener can't — it runs after them),
          // so swallowing here stops the edit from ever reaching the doc. Escape still cancels; any
          // other key is a no-op for the drag's duration. Idle (not dragging) it's fully transparent.
          handleKeyDown(view, event) {
            const controller = controllers.get(view);
            if (!controller?.isDragging()) return false;
            if (event.key === 'Escape') controller.abort();
            return true;
          },
        },
        view(editorView) {
          const controller = new DragController(editorView);
          controllers.set(editorView, controller);
          // A newly (re)created handle starts at `top: 0` (globals.css) until aligned. Two
          // realignment triggers, each firing only on a real layout change:
          //   1. doc-changing transactions (below) — an edit can add/remove/resize blocks, moving
          //      the offsets every handle is pinned to. Selection-only updates are deliberately
          //      skipped: arrow-key navigation never moves a block, so realigning on it would just
          //      be a forced `offsetTop` reflow per keystroke for no positional change.
          //   2. any size change of the content box (ResizeObserver) — a viewport resize rewraps
          //      text and shifts offsets (a pure width change, no doc edit), and an async image
          //      `load` grows the box's height; the observer catches both. Handles are
          //      `position: absolute`, so realigning them can't itself resize the box — no loop.
          alignHandles(editorView);
          const resizeObserver = new ResizeObserver(() => alignHandles(editorView));
          resizeObserver.observe(editorView.dom);
          return {
            update: (view, prevState) => {
              if (view.state.doc !== prevState.doc) {
                // Backstop for a doc change that slips past handleKeyDown's modal suppression —
                // an external/async transaction (not a swallowed keystroke). The captured
                // from/to/target are stale against the new doc, so abort rather than let the drop
                // apply a move at wrong positions. A legit drop dispatches from applyMove *after*
                // its own endSession(), so `controller` is already idle here and this no-ops.
                controller.abort();
                alignHandles(view);
              }
            },
            destroy: () => {
              resizeObserver.disconnect();
              controllers.delete(editorView);
              controller.destroy();
            },
          };
        },
      }),
    ];
  },
});
