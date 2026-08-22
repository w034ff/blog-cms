import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, Selection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
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
  'linkCard',
  'embed',
]);

// Pointer movement (px) before a mousedown-on-handle counts as a drag rather than a plain click
// (which just leaves the mousedown NodeSelection in place — see the "mousedown creates a
// NodeSelection" behavior this preserves).
const DRAG_THRESHOLD = 4;

// How close to the viewport's top/bottom edge the pointer has to get before the page starts
// scrolling under it, and how fast it scrolls once it is right at the edge (px per frame, ramped
// linearly across the band so a shallow entry creeps and the last few pixels move properly).
//
// A native HTML5 drag gets this from the browser; a mousemove-driven one (see
// createDragController's note on why this drag is not native) gets nothing, so a target below the
// fold was simply unreachable: the pointer stopped at the edge, the page stayed put, and the whole
// time `body.block-dragging` holds `cursor: grabbing` + `user-select: none` and handleKeyDown
// swallows every key — an editor that reads as frozen rather than as a drag that can't finish.
const AUTOSCROLL_ZONE = 64;
const AUTOSCROLL_MAX_STEP = 18;
// The step above is stated per 60Hz frame and scaled by the real frame interval, so a 120Hz display
// scrolls at the same speed rather than twice it.
const AUTOSCROLL_FRAME_MS = 1000 / 60;

interface DragSession {
  node: ProseMirrorNode;
  from: number;
  to: number;
  handleEl: HTMLElement;
  startX: number;
  startY: number;
  // The pointer's last known viewport coordinates. The drop target has to be recomputed whenever
  // the page scrolls under a *stationary* pointer (autoscroll, or the wheel — which keeps working
  // during a drag), and `findBoundary` reads clientY, so the last mousemove's coordinates are what
  // that recomputation has to be driven from.
  clientX: number;
  clientY: number;
  dragging: boolean;
  target: number | null;
  // Was the block picked up by its own body rather than by the handle? Only that press has a caret
  // to give back when it turns out to be a plain click (see handleMouseUp).
  viaBody: boolean;
}

interface Boundary {
  pos: number;
  y: number;
  left: number;
  width: number;
}

// Where the document stops accepting blocks. Normally the very end, but the footnote definitions'
// section is pinned past it by the doc's content expression — `block+ footnoteSection?`
// (footnote-extension.ts) — so when one exists the last admissible gap is the one *before* it.
// Same question trailing-node-extension.ts answers for where its paragraph goes, and answered the
// same way: off `doc.lastChild`'s type, not a search for the node by name.
function endOfBlocks(doc: ProseMirrorNode): number {
  const last = doc.lastChild;
  const sectionType = doc.type.schema.nodes.footnoteSection;
  return last && last.type === sectionType ? doc.content.size - last.nodeSize : doc.content.size;
}

// Finds the doc position to drop at for a given pointer Y, plus where to draw the indicator line
// (matching the width of the top-level blocks themselves — not `.ProseMirror`'s own box, which is
// wider by its `px-4` padding on each side and would overhang past the blocks' actual edges).
// Only positions between top-level siblings are candidates — dropping a whole top-level node only
// ever makes sense at another top-level gap. For the gaps *between* blocks that also settles
// schema validity for free (the gap already holds a block boundary), so prosemirror-transform's
// generic (and here unnecessary) `dropPoint` is not needed; the gap at the tail is the one
// exception and is clamped by endOfBlocks() above rather than taken as `doc.content.size`. Built
// from `view.nodeDOM` + `getBoundingClientRect` rather than `view.posAtCoords`: the pointer roams
// outside the content area during a drag (that's the point of a custom drag), and `posAtCoords`
// returns null there.
//
// The footnote section is skipped as a candidate for the same reason: it is an ordinary top-level
// child with a full-height box the pointer sweeps over on the way down, but no gap it bounds is a
// place a block may land. Skipping it resolves that whole band to the tail gap instead, drawn at
// the last real block's own edges like every other indicator.
//
// `excludeFrom` skips the dragged node itself (always exactly one top-level child, at that
// offset) — see applyMove()'s comment for why excluding it, rather than collapsing its layout
// away, is the current approach.
function findBoundary(view: EditorView, clientY: number, excludeFrom: number): Boundary {
  const { doc } = view.state;
  const sectionType = doc.type.schema.nodes.footnoteSection;
  const children: { offset: number; top: number; bottom: number; left: number; width: number }[] =
    [];
  doc.forEach((node, offset) => {
    if (offset === excludeFrom || node.type === sectionType) return;
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
  const end = endOfBlocks(doc);
  const last = children[children.length - 1];
  if (!last) return { pos: end, y: 0, left: 0, width: 0 };
  return { pos: end, y: last.bottom, left: last.left, width: last.width };
}

// The top-level block the selection holds whole, when it is one of the types the handle serves —
// which is the same scope decorations() draws a handle for, `$from.depth === 0` being the top-level
// test. Null for everything else: a text selection, an inline NodeSelection (a footnote reference),
// and a card or an image nested inside a quote, none of which this plugin speaks for.
function selectedHandledBlock(state: EditorState): { node: ProseMirrorNode; from: number } | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection)) return null;
  if (selection.$from.depth !== 0) return null;
  if (!DRAGGABLE_TYPES.has(selection.node.type.name)) return null;
  return { node: selection.node, from: selection.from };
}

// What the plugin (and the handle's mousedown) can ask of a live drag session.
interface DragController {
  // True once the pointer has actually moved past DRAG_THRESHOLD, not from mousedown — the
  // plugin's handleKeyDown reads this to run the drag modally (swallow edit keys while it holds),
  // and a plain click on a handle must not put the editor in that state even briefly. The
  // "picked up but not yet moving" window needs no protection of its own: the only hazard there is
  // an edit invalidating the captured from/to, and any such edit changes the doc, which the
  // plugin's `update` backstop already answers by aborting the session outright.
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
    viaBody: boolean,
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
  // The pending autoscroll frame, or 0 when the pointer is not in an edge band (see autoscrollTick),
  // and the timestamp of the previous one (0 whenever the loop is not running).
  let autoscrollFrame = 0;
  let autoscrollAt = 0;

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
    // `Transform.insert` is silent about refusing: `replaceStep` returns null for a slice that
    // cannot be fitted and no step is added, so the only symptom is that the next line finds no
    // node at `pos` and NodeSelection.create throws on `nodeAfter.nodeSize` — a TypeError out of
    // the mouseup handler, with the document left byte-identical. That is what a drop aimed past
    // the footnote section used to produce; findBoundary() no longer offers such a target, and
    // counting steps keeps any future one a no-op rather than a crash. `tr.docChanged` cannot
    // answer this — the delete above already set it.
    const steps = tr.steps.length;
    tr.insert(pos, node);
    if (tr.steps.length === steps) return;
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    view.dispatch(tr);
    view.focus();
  }

  // px to scroll this frame for a pointer at `clientY` — 0 anywhere outside the two edge bands,
  // ramping to AUTOSCROLL_MAX_STEP at the very edge.
  function autoscrollStep(clientY: number): number {
    if (clientY < AUTOSCROLL_ZONE) {
      return -Math.ceil(((AUTOSCROLL_ZONE - clientY) / AUTOSCROLL_ZONE) * AUTOSCROLL_MAX_STEP);
    }
    const edge = window.innerHeight - AUTOSCROLL_ZONE;
    if (clientY > edge) {
      return Math.ceil(((clientY - edge) / AUTOSCROLL_ZONE) * AUTOSCROLL_MAX_STEP);
    }
    return 0;
  }

  // Frame loop, live only while the pointer sits in an edge band. It stops on leaving the band and
  // also when a scroll changed nothing (the document's end), so a pointer parked at the bottom of a
  // fully scrolled page doesn't hold a frame loop open for the rest of the drag; handleMouseMove
  // starts it again the moment the pointer moves. Redrawing the indicator is left to handleScroll
  // rather than done here — a programmatic scroll raises the same `scroll` event as the wheel, and
  // one path for "the page moved under the pointer" is what keeps the two from disagreeing.
  function autoscrollTick(now: number): void {
    autoscrollFrame = 0;
    const current = session;
    const step = current?.dragging ? autoscrollStep(current.clientY) : 0;
    if (step === 0) {
      autoscrollAt = 0;
      return;
    }
    // Clamped, so a frame the browser skipped (a tab regaining focus, a long layout) advances the
    // page by a few frames' worth rather than teleporting it.
    const elapsed =
      autoscrollAt === 0
        ? AUTOSCROLL_FRAME_MS
        : Math.min(now - autoscrollAt, AUTOSCROLL_FRAME_MS * 4);
    autoscrollAt = now;
    const before = window.scrollY;
    window.scrollBy(0, (step * elapsed) / AUTOSCROLL_FRAME_MS);
    if (window.scrollY === before) {
      autoscrollAt = 0;
      return;
    }
    autoscrollFrame = requestAnimationFrame(autoscrollTick);
  }

  // The page moved under the pointer — by the wheel (which keeps working mid-drag), by a trackpad,
  // or by autoscrollTick above. `findBoundary` answers in viewport coordinates, so the gap under a
  // pointer that never moved is a different one now, and the indicator drawn for the old one is
  // both wrong on screen and wrong as the drop target: before this, a wheel-scroll mid-drag landed
  // the block at a boundary computed against the pre-scroll layout, silently.
  function handleScroll(): void {
    updateTarget();
  }

  // The one thing that can strand a session: a native HTML5 drag starting while this one is live.
  // Its OS drag loop swallows both `mousemove` and `mouseup` for the rest of the gesture — measured,
  // a native drag inside the editor logs `mousedown → dragstart → drop` with **no mouseup at all** —
  // so handleMouseUp never runs, and the session stays live forever with `body.block-dragging`
  // (`cursor: grabbing` + `user-select: none`, which is why clicking stops placing a caret) and
  // handleKeyDown's modal swallow still on. That is an editor that is, from the author's side,
  // frozen. Reported 2026-08-22, with the blue frame (the NodeSelection a first click on the handle
  // leaves) as the precondition — and that fits: prosemirror-view's `LeftMouseDown` arms `mightDrag`
  // when the press lands inside an existing NodeSelection and then sets `draggable` on the DOM it
  // resolves for it, which is what hands Chrome a drag source the handle's own `preventDefault`
  // (called before that, on mousedown) can no longer suppress.
  //
  // Cancelling the dragstart is the root fix — whatever element sources it, this drag is ours.
  // Registered on the window in the capture phase so a source outside `view.dom` is covered too.
  function handleDragStart(event: DragEvent): void {
    if (!session) return;
    event.preventDefault();
  }

  // Belt and braces for a native drag that starts anyway (a browser that begins the OS loop before
  // dispatching a cancellable `dragstart`): its end is the last chance to let the session go.
  // `blur` covers a release outside the window entirely — alt-tabbed away mid-drag, or let go over
  // the browser's own chrome, both of which can consume the mouseup as well.
  function handleAbortingEvent(): void {
    endSession();
  }

  function endSession(): void {
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
    window.removeEventListener('scroll', handleScroll, true);
    window.removeEventListener('dragstart', handleDragStart, true);
    window.removeEventListener('dragend', handleAbortingEvent, true);
    window.removeEventListener('drop', handleAbortingEvent, true);
    window.removeEventListener('blur', handleAbortingEvent);
    if (autoscrollFrame !== 0) cancelAnimationFrame(autoscrollFrame);
    autoscrollFrame = 0;
    autoscrollAt = 0;
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
    // The button is not down any more and no mouseup ever arrived — prosemirror-view keeps the same
    // failsafe for its own MouseDown (`move(event) { if (event.buttons == 0) this.done() }`). Some
    // gesture ate the release; whatever it was, the next mouse movement recovers the editor instead
    // of leaving it modal. Abort rather than apply the move: an unwitnessed release is not a drop,
    // and if a native drag was what ate it, its own drop has already moved something.
    if (event.buttons === 0) {
      endSession();
      return;
    }
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
    current.clientX = event.clientX;
    current.clientY = event.clientY;
    updateTarget();
    if (autoscrollFrame === 0 && autoscrollStep(current.clientY) !== 0) {
      autoscrollFrame = requestAnimationFrame(autoscrollTick);
    }
  }

  // Resolve the drop target for the pointer's last known position and redraw the chrome that
  // follows it. Split out of handleMouseMove because the pointer is not the only thing that moves:
  // the page scrolling under a stationary pointer changes the answer just as much (handleScroll).
  function updateTarget(): void {
    const current = session;
    if (!current?.dragging) return;
    const { pos, y, left, width } = findBoundary(view, current.clientY, current.from);
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
      preview.style.left = `${current.clientX}px`;
      preview.style.top = `${current.clientY}px`;
    }
  }

  // endSession() clears `session`, so the finished one is captured before it runs.
  function handleMouseUp(): void {
    const finished = session;
    endSession();
    if (!finished) return;
    if (!finished.dragging) {
      // A press that never travelled DRAG_THRESHOLD is a plain click, and for one that started on
      // the block's own body this is where the caret has to land: the mousedown was
      // preventDefault-ed to keep the browser from painting a selection under the drag, which also
      // stopped prosemirror-view's `LeftMouseDown.up` from moving the selection itself. Without
      // this the block stays selected whole and the next keystroke replaces it (measured).
      //
      // `Selection.near` for posAtCoords' reason: the press can land somewhere no caret can sit
      // (between blocks, on an atom), and near() resolves to the closest place one can. A press
      // from the *handle* is excluded — clicking a handle means "select this block", which is the
      // selection already in place.
      if (finished.viaBody) placeCaretAt(finished.clientX, finished.clientY);
      return;
    }
    if (finished.target == null) return;
    applyMove(finished.node, finished.from, finished.to, finished.target);
  }

  function placeCaretAt(clientX: number, clientY: number): void {
    const at = view.posAtCoords({ left: clientX, top: clientY });
    if (!at) return;
    const { doc } = view.state;
    if (at.pos > doc.content.size) return;
    view.dispatch(view.state.tr.setSelection(Selection.near(doc.resolve(at.pos))));
    view.focus();
  }

  return {
    isDragging: () => session?.dragging === true,
    abort: endSession,
    start: (node, from, to, handleEl, clientX, clientY, viaBody) => {
      session = {
        node,
        from,
        to,
        handleEl,
        startX: clientX,
        startY: clientY,
        clientX,
        clientY,
        dragging: false,
        target: null,
        viaBody,
      };
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      // Capture, because `scroll` does not bubble: this has to hear the document's own scrolling
      // and any scrollable ancestor's alike, since either one moves the blocks under the pointer.
      window.addEventListener('scroll', handleScroll, true);
      window.addEventListener('dragstart', handleDragStart, true);
      window.addEventListener('dragend', handleAbortingEvent, true);
      window.addEventListener('drop', handleAbortingEvent, true);
      window.addEventListener('blur', handleAbortingEvent);
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
    // Primary button only. `event.button` went unchecked, so the secondary button opened a full
    // drag session — measured: a right-drag set `body.block-dragging` and reordered the blockquote
    // outright, under the context menu the same press opens. A session is modal (the body class
    // takes the cursor and text selection, handleKeyDown swallows every key), which is not a state
    // any button but the one that means "pick this block up" should be able to reach.
    if (event.button !== 0) return;
    const pos = getPos();
    if (pos == null) return;
    const node = view.state.doc.nodeAt(pos);
    if (!node) return;
    event.preventDefault();
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    view.focus();
    controllers
      .get(view)
      ?.start(node, pos, pos + node.nodeSize, handle, event.clientX, event.clientY, false);
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

// A hover-revealed grip in the left gutter of every type in DRAGGABLE_TYPES above — blockquotes,
// callouts, accordions, images, tables, code blocks and link cards — for selecting (and dragging to
// reorder) the whole block in one action — mousedown-only for now, no keyboard equivalent.
//
// One handle per matching top-level node, via a widget decoration placed immediately before it
// (`side: -1`) rather than a NodeView: a plain `toDOM` node (blockquote, image) has nothing to hang
// one in, and a single decoration-scan plugin covers all seven uniformly — the types that do have a
// NodeView (callout, codeBlock and linkCard here, details' from @tiptap/extension-details) would each
// otherwise need the same grip built by hand. A
// natively draggable node is not exempt: `image` and `linkCard` both carry `draggable: true`, so
// prosemirror-view sets the DOM attribute (dist: `if (node.type.spec.draggable) dom.draggable = true`
// — it runs for a custom NodeView's `dom` too) and grabbing the block itself already moves it
// (measured for the card 2026-08-14: a native drag reorders it with its `data-href` intact). Both get
// a handle anyway. The handle is the visible, uniform affordance, and unlike the native path it
// cannot aim anywhere but the top-level gaps findBoundary() offers. There's no
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
          handleDOMEvents: {
            // No NodeSelection is a native drag source, full stop.
            //
            // prosemirror-view makes ANY node with a NodeSelection one: `NodeViewDesc.selectNode()`
            // sets `dom.draggable = true` on the selected node, and `LeftMouseDown` arms `mightDrag`
            // for a press inside an existing NodeSelection — with no type or depth check at all.
            // Reported 2026-08-22 for a ringed top-level block (a click on the handle is what rings
            // one) and confirmed from the author's browser: that drag freezes the editor the moment
            // it starts — every key and every click ignored, Escape included, with `view.dragging`
            // left set (so neither `drop` nor `dragend` ever reached `view.dom`). It could not be
            // reproduced from Playwright, whose synthetic input never enters Chrome's OS drag loop
            // (e2e/native-drag.ts), so what strands it there is not settled.
            //
            // First fix (`994c1b0`) scoped the cancel to `selectedHandledBlock` — top-level
            // `DRAGGABLE_TYPES` only — because that was the reported gesture. But the mechanism
            // above has no such scope: Ctrl/Cmd+click (prosemirror-view's own `selectNodeModifier`)
            // turns ANY selectable node into a NodeSelection, paragraphs and headings included, and
            // a plain click already does that for an inline atom like a footnote reference (picking
            // it for deletion, §5.1) — every one of those is then the same native drag source.
            // Measured live: Ctrl+click on a plain paragraph leaves `draggable="true"` on it and an
            // undefended `dragstart`. Cancel for every NodeSelection instead.
            //
            // Costs nothing real: a schema audit found only `image`/`linkCard`/`embed` declare
            // `draggable: true` of their own, and those are exactly the `DRAGGABLE_TYPES` already
            // routed through this plugin's own drag (see mousedown below). The footnote reference's
            // drag (criterion 14, e2e/editor-footnote.spec.ts) moves a TextSelection spanning it, not
            // a NodeSelection on it, so it never reaches this guard either way. A plain TextSelection
            // dragged out of a quote or a code block — the gesture every drop guard in this editor is
            // built on — is likewise untouched, since it is never a NodeSelection.
            dragstart(view, event) {
              if (!(view.state.selection instanceof NodeSelection)) return false;
              event.preventDefault();
              return true;
            },
            // The other half: pressing a ringed block picks it up the way its handle does, so the
            // gesture the dragstart above refuses still moves the block. Returns false either way —
            // ProseMirror keeps its own mousedown handling (the caret, the selection), and a press
            // that never travels DRAG_THRESHOLD is still just a click.
            //
            // A press on chrome a NodeView claims (the card's search box, the code block's
            // filename field) never arrives here at all: `eventBelongsToView` gives up as soon as a
            // `stopEvent` claims the target, before handleDOMEvents is consulted.
            mousedown(view, event) {
              if (event.button !== 0) return false;
              const block = selectedHandledBlock(view.state);
              if (!block) return false;
              const dom = view.nodeDOM(block.from);
              if (!(dom instanceof HTMLElement)) return false;
              if (!(event.target instanceof Node) || !dom.contains(event.target)) return false;
              // The handle is the widget decoration immediately before the block (side: -1), and
              // the drag needs it only to keep it visible for the session (`is-dragging`).
              const handle = dom.previousElementSibling;
              if (!(handle instanceof HTMLElement)) return false;
              if (!handle.classList.contains('block-drag-handle')) return false;
              controllers
                .get(view)
                ?.start(
                  block.node,
                  block.from,
                  block.from + block.node.nodeSize,
                  handle,
                  event.clientX,
                  event.clientY,
                  true,
                );
              // Suppress the browser's own drag-selection, exactly as the handle's mousedown does:
              // without it the press paints a text selection behind the moving pointer (measured
              // 2026-08-22 in selection-blue pixels over the dragged block — 188 at rest, 3709
              // mid-drag), because ProseMirror's mousedown turns the NodeSelection into a caret and
              // `.ProseMirror-hideselection` stops applying. Restoring the NodeSelection at
              // DRAG_THRESHOLD does not undo it: `selectionToDOM` declines to touch the DOM
              // selection while a mouse press is live.
              //
              // The cost is that `LeftMouseDown.up` no longer moves the selection either, so a
              // press that turns out to be a plain click would leave the block selected whole and
              // the next keystroke would replace it. handleMouseUp gives that back (see the caret
              // it places for a session that never became a drag).
              event.preventDefault();
              return false;
            },
          },
          // Run the drag modally: while a drag is *moving* (isDragging, which is the post-threshold
          // window — a session that hasn't moved yet is left transparent, since the doc-changed
          // backstop below already covers the only hazard there), the dragged block carries a
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
