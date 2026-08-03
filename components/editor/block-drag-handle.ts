import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';

// Top-level-only reorder targets. A nested instance (e.g. a blockquote inside a callout) gets
// no handle of its own — doc.forEach below only sees direct children of the doc, which already
// excludes it, so no extra filtering is needed. Extend this set to broaden scope later (headings
// need the section-range question settled first — see the design discussion — so they're not here).
const DRAGGABLE_TYPES = new Set([
  'blockquote',
  'callout',
  'details',
  'image',
  'table',
  'codeBlock',
]);

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
//
// `excludeFrom` skips the dragged node itself (always exactly one top-level child, at that
// offset) — see applyMove()'s comment for why excluding it, rather than collapsing its layout
// away, is the current approach.
function findBoundary(view: EditorView, clientY: number, excludeFrom: number): Boundary {
  const children: { offset: number; top: number; bottom: number; left: number; width: number }[] =
    [];
  view.state.doc.forEach((_node, offset) => {
    if (offset === excludeFrom) return;
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

// What the plugin (and the handle's mousedown) can ask of a live drag session.
interface DragController {
  // True from mousedown-on-handle until the session ends (drop, Escape, or an aborting doc
  // change) — covers the pre-DRAG_THRESHOLD "picked up but not yet moving" window too. The
  // plugin's handleKeyDown reads this to run the drag modally (swallow edit keys while it holds).
  isDragging: () => boolean;
  // Cancel an in-flight drag without applying any move — used by both Escape and the doc-changed
  // backstop. It tears down listeners, the body class, and the indicator.
  abort: () => void;
  start: (
    node: ProseMirrorNode,
    from: number,
    to: number,
    handleEl: HTMLElement,
    clientX: number,
    clientY: number,
  ) => void;
  destroy: () => void;
}

// Drives one drag session end-to-end via plain mouse tracking instead of native HTML5
// drag-and-drop. Native drag was dropped because its no-drop cursor is governed by DOM
// containment (prosemirror-view's dragover/drop handlers only fire while `event.target` stays a
// descendant of `view.dom`), which made the handle's own on-screen position load-bearing for
// something that has nothing to do with it. A plain `mousemove`/`mouseup` pair has no such
// constraint — the pointer can go anywhere.
function createDragController(view: EditorView): DragController {
  let session: DragSession | null = null;
  let indicator: HTMLElement | null = null;
  let preview: HTMLElement | null = null;

  function ensureIndicator(): HTMLElement {
    if (!indicator) {
      const el = document.createElement('div');
      el.className = 'block-drag-indicator';
      el.style.display = 'none';
      document.body.appendChild(el);
      indicator = el;
    }
    return indicator;
  }

  // The `prose prose-zinc dark:prose-invert` classes are the same ones PostEditor.tsx puts on
  // `.ProseMirror` itself, so a cloned blockquote/table/code-block keeps its normal typographic
  // styling even outside that container.
  function ensurePreview(): HTMLElement {
    if (!preview) {
      const el = document.createElement('div');
      el.className = 'block-drag-preview prose prose-zinc dark:prose-invert';
      el.style.display = 'none';
      document.body.appendChild(el);
      preview = el;
    }
    return preview;
  }

  // `to` (put it back right after itself) means "put it back where it came from" — skip the
  // transaction rather than issuing a no-op undo-history entry. `from` can no longer actually
  // occur (findBoundary() excludes the dragged node's own offset from its candidates, so no
  // result ever carries that value) — the check is kept anyway since it's harmless and cheap.
  //
  // This exclusion is the current fix for a boundary-crossing bug: without it, findBoundary()
  // would count the dragged node itself among the top-level siblings it scans (its DOM hasn't
  // gone anywhere until drop), so its `from`/`to` gaps — both no-ops per this guard — would sit a
  // full block-height apart, forcing the pointer to cross both before reaching the next real
  // boundary. An earlier version fixed this by collapsing the dragged node's own layout to ~0
  // height instead (so the two gaps merged visually) — reverted after trying it in the browser:
  // the reflow (surrounding content sliding to fill the gap) was hard to track, especially for a
  // large element like a table. Excluding the node outright was tried even earlier than that and
  // reverted too, for a different reason — without the source's layout changing at all, the drop
  // indicator could jump ahead to the next real gap while the pointer was still visually over the
  // (still full-size) dragged node, reading as desynced. It's back now, paired with two things
  // that weren't in the earlier attempt: the cursor-following preview (`ensurePreview()`) gives
  // positive "here's what you're carrying" feedback instead of relying on the source block itself,
  // and handleMouseMove()'s own `pos === session.to` check suppresses the indicator entirely for
  // that no-op candidate — so the only thing the indicator can ever show is a real target, never
  // the jump-to-a-no-op-gap that originally read as broken.
  function applyMove(node: ProseMirrorNode, from: number, to: number, target: number): void {
    if (target === from || target === to) return;
    const tr = view.state.tr.delete(from, to);
    const pos = tr.mapping.map(target);
    tr.insert(pos, node);
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    view.dispatch(tr);
    view.focus();
  }

  function endSession(): void {
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
    document.body.classList.remove('block-dragging');
    session?.handleEl.classList.remove('is-dragging');
    if (indicator) indicator.style.display = 'none';
    if (preview) {
      preview.style.display = 'none';
      preview.replaceChildren();
    }
    session = null;
  }

  function handleMouseMove(event: MouseEvent): void {
    const current = session;
    if (!current) return;
    if (!current.dragging) {
      if (
        Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < DRAG_THRESHOLD
      ) {
        return;
      }
      current.dragging = true;
      document.body.classList.add('block-dragging');
      // CSS `:hover`/`:has(+ :hover)` (globals.css) stop tracking the real cursor once a native
      // HTML5 drag starts (a well-known browser quirk — hover freezes at the drag-start position
      // until drop), which is what kept the source handle visible throughout the old native-drag
      // implementation. Plain `mousemove` has no such freeze, so once the pointer leaves the
      // dragged block, `:hover` correctly stops matching and the handle would otherwise vanish
      // mid-drag. This class forces it to stay visible for the session's duration instead.
      current.handleEl.classList.add('is-dragging');
      // A cursor-following clone of what's being dragged — the source block itself stays exactly
      // where it is (no collapse/reflow, see applyMove()'s comment for why), so this is the
      // drag's only positive "here's what you're carrying" signal.
      const dom = view.nodeDOM(current.from);
      if (dom instanceof HTMLElement) {
        const el = ensurePreview();
        el.replaceChildren(dom.cloneNode(true) as Node);
        const cloneRoot = el.firstElementChild;
        if (cloneRoot instanceof HTMLElement) {
          cloneRoot.classList.remove('ProseMirror-selectednode');
          cloneRoot.setAttribute('contenteditable', 'false');
        }
        el.style.display = 'block';
      }
    }
    const { pos, y, left, width } = findBoundary(view, event.clientY, current.from);
    // `to` (the gap right after the dragged node's own original position) is always a no-op per
    // applyMove()'s guard — suppress the indicator for it rather than showing a target that would
    // just put the block back where it started. This is the resolved candidate for the whole zone
    // from the dragged node's own top down through the next sibling's midpoint — including right
    // at drag start, when the pointer is barely past the handle and still visually over the
    // (unmoving — see applyMove()'s comment) source block itself, where showing a "real-looking"
    // indicator elsewhere would read as reacting before you've gone anywhere.
    if (pos === current.to) {
      current.target = null;
      if (indicator) indicator.style.display = 'none';
    } else {
      current.target = pos;
      const el = ensureIndicator();
      el.style.display = 'block';
      el.style.top = `${y}px`;
      el.style.left = `${left}px`;
      el.style.width = `${width}px`;
    }
    if (preview) {
      preview.style.left = `${event.clientX}px`;
      preview.style.top = `${event.clientY}px`;
    }
  }

  // endSession() clears `session`, so the finished one is captured before it runs.
  function handleMouseUp(): void {
    const finished = session;
    endSession();
    if (!finished || !finished.dragging || finished.target == null) return;
    applyMove(finished.node, finished.from, finished.to, finished.target);
  }

  return {
    isDragging: () => session != null,
    abort: endSession,
    start: (node, from, to, handleEl, clientX, clientY) => {
      session = {
        node,
        from,
        to,
        handleEl,
        startX: clientX,
        startY: clientY,
        dragging: false,
        target: null,
      };
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    destroy: () => {
      endSession();
      indicator?.remove();
      indicator = null;
      preview?.remove();
      preview = null;
    },
  };
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
// sibling then share the same offsetParent (`.ProseMirror`), so the target's plain `offsetTop`
// *is* the correct `top` for the handle: no getBoundingClientRect/scroll-position math needed,
// just the browser's own layout of the two boxes. A target that is itself positioned is fine —
// blockquote carries `position: relative` for its corner quote glyph (globals.css) — since an
// element's own positioning never changes its *own* offsetParent, and handles only ever exist as
// direct children of `.ProseMirror` (see the top-level-only note above), so no handle can end up
// anchored to a target instead. Horizontal placement is a fixed CSS offset (every
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
          const controller = createDragController(editorView);
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
