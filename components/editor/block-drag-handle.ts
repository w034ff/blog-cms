import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, Selection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { resolveEmbed } from '@/lib/embed-provider';
import { buildIcon, embedMarkShapes } from './svg/icon-shapes';
import type { EditorView } from '@tiptap/pm/view';

// Top-level-only reorder targets (`doc.forEach` below sees only direct children). Headings are not
// here until the section-range question is settled. Exported for draggable-types.test.ts: every
// `draggable: true` node must be listed, or it is a native drag source with no handle and nothing
// refusing its `dragstart` (docs/link-card-requirements.md §7.7).
export const DRAGGABLE_TYPES = new Set([
  'blockquote',
  'callout',
  'details',
  'image',
  'table',
  'codeBlock',
  'linkCard',
  'embed',
]);

// Movement (px) before a handle press counts as a drag; below it, a click leaves the NodeSelection.
const DRAG_THRESHOLD = 4;

// The edge band where the page autoscrolls under the pointer, and the step at the very edge (px per
// frame, ramped across the band). A mousemove-driven drag gets no native autoscroll, so a target
// below the fold was unreachable and the modal drag looked frozen.
const AUTOSCROLL_ZONE = 64;
const AUTOSCROLL_MAX_STEP = 18;
// The step is per 60Hz frame, scaled by the real interval.
const AUTOSCROLL_FRAME_MS = 1000 / 60;

// How far the markCut veil extends past the block: enough to cover its 2px+2px selection ring.
const CUT_INFLATE = 4;

interface DragSession {
  node: ProseMirrorNode;
  from: number;
  to: number;
  handleEl: HTMLElement;
  startX: number;
  startY: number;
  // The last pointer coordinates, since a scroll under a stationary pointer changes the target.
  clientX: number;
  clientY: number;
  dragging: boolean;
  target: number | null;
  // Picked up by the body rather than the handle; only that click has a caret to give back.
  viaBody: boolean;
}

interface Boundary {
  pos: number;
  y: number;
  left: number;
  width: number;
}

// Where the document stops accepting blocks: before the footnote section when there is one (its
// place is fixed by `block+ footnoteSection?`), found off `doc.lastChild` as trailing-node does.
function endOfBlocks(doc: ProseMirrorNode): number {
  const last = doc.lastChild;
  const sectionType = doc.type.schema.nodes.footnoteSection;
  return last && last.type === sectionType ? doc.content.size - last.nodeSize : doc.content.size;
}

// The drop position for a pointer Y and where to draw the indicator (at the blocks' own width, not
// `.ProseMirror`'s padded box). Only gaps between top-level siblings, which are valid by
// construction, so no `dropPoint`; the tail is clamped by endOfBlocks. Built from `view.nodeDOM` +
// rects because `posAtCoords` returns null outside the content area. The footnote section is
// skipped, resolving its band to the tail gap, and `excludeFrom` skips the dragged node (see
// applyMove).
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

// The top-level DRAGGABLE_TYPES block the selection holds whole, or null.
function selectedHandledBlock(state: EditorState): { node: ProseMirrorNode; from: number } | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection)) return null;
  if (selection.$from.depth !== 0) return null;
  if (!DRAGGABLE_TYPES.has(selection.node.type.name)) return null;
  return { node: selection.node, from: selection.from };
}

// Did the press land on a node prosemirror-view made a native drag source
// (`if (node.type.spec.draggable) dom.draggable = true`, or `LeftMouseDown` inside a
// NodeSelection)? Asked of the DOM attribute, the same thing Chrome asked, rather than the model.
// Scoped to the attribute so a TextSelection dragged out of a quote still works; only
// image/linkCard/embed declare it, all with handles (docs/editor-pitfalls.md §5.3).
function pressedNativeDragSource(view: EditorView, target: EventTarget | null): boolean {
  const el =
    target instanceof HTMLElement ? target : target instanceof Node ? target.parentElement : null;
  const source = el?.closest('[draggable="true"]');
  return source instanceof HTMLElement && view.dom.contains(source);
}

// What the plugin (and the handle's mousedown) can ask of a live drag session.
interface DragController {
  // True only past DRAG_THRESHOLD, which is when handleKeyDown goes modal; before that, the
  // doc-changed backstop covers the only hazard (docs/editor-pitfalls.md §5.1).
  isDragging: () => boolean;
  // Cancel without moving (Escape, the doc-changed backstop).
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

// One drag session by plain mouse tracking rather than native HTML5 drag, whose drop handling
// only works while the target stays inside `view.dom`.
function createDragController(view: EditorView): DragController {
  let session: DragSession | null = null;
  let indicator: HTMLElement | null = null;
  let preview: HTMLElement | null = null;
  // The markCut veil.
  let veil: HTMLElement | null = null;
  // The pending autoscroll frame (0 when idle) and the previous frame's timestamp.
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

  // The same prose classes as `.ProseMirror`, so the clone keeps its styling.
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

  // `to` is a no-op, so no transaction. `from` never arrives: findBoundary skips the dragged node.
  //
  // The dragged node is excluded from findBoundary's candidates, or its own two no-op gaps sat a
  // block-height apart. Collapsing its layout instead was tried and reverted (the reflow was hard to
  // follow); exclusion alone once made the indicator jump ahead while the pointer was over the
  // source. It works now with the cursor-following preview and the suppressed no-op indicator.
  function applyMove(node: ProseMirrorNode, from: number, to: number, target: number): void {
    if (target === to) return;
    const tr = view.state.tr.delete(from, to);
    const pos = tr.mapping.map(target);
    // `Transform.insert` refuses silently (no step added), and NodeSelection.create below then threw
    // out of mouseup. Counting steps keeps any such target a no-op; `tr.docChanged` can't tell,
    // since the delete already set it.
    const steps = tr.steps.length;
    tr.insert(pos, node);
    if (tr.steps.length === steps) return;
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    view.dispatch(tr);
    view.focus();
  }

  // What the cursor carries (docs/editor-pitfalls.md §5.5). **An embed is only named**, as a
  // one-line token (the provider's mark and `EmbedTarget.label`, without a redundant kind): a cloned
  // `<iframe>` is a live frame that loads again and answers under the original's name, which
  // shrank the real block (docs/embed-requirements.md §10.10). Everything else is cloned, with any
  // `<iframe>` removed before attaching.
  function previewContent(node: ProseMirrorNode, dom: HTMLElement): HTMLElement {
    if (node.type.name === 'embed') return embedToken(node);
    const clone = dom.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('iframe').forEach((frame) => frame.remove());
    stripCardControls(clone);
    // The ring is the document's state, not the ghost's.
    clone.classList.remove('ProseMirror-selectednode');
    clone.setAttribute('contenteditable', 'false');
    return clone;
  }

  // **A ghost carries the card's face, never its controls** (docs/link-card-requirements.md §7.5):
  // the control band didn't fit the ghost and crowded out, or clipped away, the title. Removing
  // `.link-card-head` and `.link-card-results` takes the buttons, search box and rows; a picker left
  // with nothing gets a naming line in the title's slot.
  function stripCardControls(clone: HTMLElement): void {
    clone.querySelectorAll('.link-card-head, .link-card-results').forEach((el) => el.remove());
    if (!clone.classList.contains('link-card')) return;
    // Only a resolved card has a title span.
    if (clone.querySelector('.link-card-title')) return;
    const body = clone.querySelector('.link-card-body');
    if (!body) return;
    const line = document.createElement('span');
    line.className = 'link-card-title';
    line.textContent = 'リンク先未設定のカード';
    body.appendChild(line);
  }

  function embedToken(node: ProseMirrorNode): HTMLElement {
    const href = typeof node.attrs.href === 'string' ? node.attrs.href : '';
    const target = resolveEmbed(href);
    const el = document.createElement('div');
    el.className = 'embed-drag-token';
    // No mark for an unclaimed reference: every mark names a provider.
    if (target) el.appendChild(buildIcon(embedMarkShapes(target.provider)));
    const body = document.createElement('span');
    body.className = 'embed-drag-token-body';
    // The same words the block shows, plus the URL.
    const label = target?.label ?? { lead: '埋め込みにできない参照', detail: href };
    const lead = document.createElement('span');
    lead.className = 'embed-drag-token-lead';
    lead.textContent = label.lead;
    body.appendChild(lead);
    if (label.detail !== '') {
      const detail = document.createElement('span');
      detail.className = 'embed-drag-token-detail';
      detail.textContent = label.detail;
      body.appendChild(detail);
    }
    el.appendChild(body);
    return el;
  }

  // px to scroll this frame; 0 outside the edge bands.
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

  // Runs only while the pointer is in an edge band and the page can still scroll. The indicator is
  // redrawn by handleScroll, the one path for "the page moved under the pointer".
  function autoscrollTick(now: number): void {
    autoscrollFrame = 0;
    const current = session;
    const step = current?.dragging ? autoscrollStep(current.clientY) : 0;
    if (step === 0) {
      autoscrollAt = 0;
      return;
    }
    // Clamped, so a skipped frame doesn't jump the page.
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

  // The page moved under the pointer (wheel, trackpad, autoscroll), so the target must be
  // recomputed, or a scroll mid-drag silently dropped against the old layout.
  function handleScroll(): void {
    updateTarget();
  }

  // A native drag starting mid-session swallows mousemove and mouseup, stranding the modal session
  // (docs/editor-pitfalls.md §5.2). Cancelling `dragstart` is the root fix, on the window in the
  // capture phase so any source is covered.
  function handleDragStart(event: DragEvent): void {
    if (!session) return;
    event.preventDefault();
  }

  // Backstops: a native drag's end, and `blur` for a release outside the window.
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
    markCut(false);
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
    // No button down and no mouseup seen: abort, as prosemirror-view's own
    // `if (event.buttons == 0) this.done()` does. An unwitnessed release is not a drop.
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
      // Keeps the handle visible once the pointer leaves the block, which `:hover` (unlike during a
      // native drag) correctly stops matching.
      current.handleEl.classList.add('is-dragging');
      // The cursor-following ghost: the drag's "what you're carrying" signal, since the source
      // block doesn't move.
      const dom = view.nodeDOM(current.from);
      if (dom instanceof HTMLElement) {
        const el = ensurePreview();
        el.replaceChildren(previewContent(current.node, dom));
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

  function ensureVeil(): HTMLElement {
    if (!veil) {
      const el = document.createElement('div');
      el.className = 'block-drag-cut';
      el.style.display = 'none';
      document.body.appendChild(el);
      veil = el;
    }
    return veil;
  }

  // Shows the source block **cut out** (faded, dashed) exactly while a real target is on offer, so
  // with the indicator it states the move (docs/link-card-requirements.md §7.6). Shown on the
  // no-op instead, it read as a cut; a 「ここに戻ります」 line looked like the drop indicator.
  //
  // **A class on the block's DOM does not survive:** `decorations()` rebuilds its widgets without a
  // `key` on every state change, so the descs around them are rebuilt and `view.nodeDOM(from)`
  // returned a different element on the next move. So this is a `position: absolute` box over the
  // block, inflated by CUT_INFLATE to cover the selection ring.
  function markCut(on: boolean): void {
    const current = session;
    const dom = on && current ? view.nodeDOM(current.from) : null;
    if (!(dom instanceof HTMLElement)) {
      if (veil) veil.style.display = 'none';
      return;
    }
    const rect = dom.getBoundingClientRect();
    const el = ensureVeil();
    el.style.display = 'block';
    // Document coordinates, so the veil moves with the block instead of lagging a scroll event.
    el.style.top = `${rect.top + window.scrollY - CUT_INFLATE}px`;
    el.style.left = `${rect.left + window.scrollX - CUT_INFLATE}px`;
    el.style.width = `${rect.width + CUT_INFLATE * 2}px`;
    el.style.height = `${rect.height + CUT_INFLATE * 2}px`;
  }

  // Resolve the target and redraw; also called from handleScroll.
  function updateTarget(): void {
    const current = session;
    if (!current?.dragging) return;
    const { pos, y, left, width } = findBoundary(view, current.clientY, current.from);
    // `to` is a no-op, so no indicator: it covers the zone from the node's top to the next
    // sibling's midpoint, including the start of the drag. The cut preview is off there too, so a
    // no-op is drawn as the block as it is.
    if (pos === current.to) {
      current.target = null;
      if (indicator) indicator.style.display = 'none';
      markCut(false);
    } else {
      markCut(true);
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

  // endSession() clears `session`, so it is captured first.
  function handleMouseUp(): void {
    const finished = session;
    endSession();
    if (!finished) return;
    if (!finished.dragging) {
      // A body press that never became a drag is a click: place the caret the prevented mousedown
      // didn't (docs/editor-pitfalls.md §5.2), via `Selection.near`. Not for a handle press, which
      // means "select the block", nor for an atom, whose blank band resolves through a boundary
      // position and near() found text in the next block.
      if (finished.viaBody) {
        if (finished.node.isAtom) {
          view.dispatch(
            view.state.tr.setSelection(NodeSelection.create(view.state.doc, finished.from)),
          );
          view.focus();
        } else {
          placeCaretAt(finished.clientX, finished.clientY);
        }
      }
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
      // Capture, since `scroll` doesn't bubble and any scrollable ancestor counts.
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
      veil?.remove();
      veil = null;
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
  // preventDefault stops native text selection; the drag is DragController's.
  handle.addEventListener('mousedown', (event) => {
    // Primary button only: a right-drag opened a modal session under the context menu.
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

// Handles are `position: absolute` children of `.ProseMirror`, sharing the target's offsetParent,
// so the target's `offsetTop` is the handle's `top`. Horizontal placement is a fixed CSS offset.
function alignHandles(view: EditorView): void {
  view.dom.querySelectorAll<HTMLElement>(':scope > .block-drag-handle').forEach((handle) => {
    const sibling = handle.nextElementSibling;
    if (sibling instanceof HTMLElement) handle.style.top = `${sibling.offsetTop}px`;
  });
}

// A hover-revealed grip in the left gutter of every type in DRAGGABLE_TYPES above — blockquotes,
// callouts, accordions, images, tables, code blocks and link cards — selecting and dragging the
// whole block (mouse only). A widget decoration (`side: -1`), not a NodeView, so one plugin covers
// every type, including those whose DOM is a plain `toDOM`. Natively draggable nodes get one too:
// unlike a native drag, the handle can only aim at findBoundary's top-level gaps. CSS
// (`:has(+ :hover)`) reveals it.
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
            // **No NodeSelection is a native drag source** (docs/editor-pitfalls.md §5.3): any
            // NodeSelection gets `draggable`, with no type or depth check (Ctrl+click makes one on a
            // paragraph), and that drag froze the editor. Nor is the selection the whole scope:
            // unringed image/linkCard/embed are drag sources through `pressedNativeDragSource`, and
            // Chrome's picture drag carried a File that re-uploaded the image
            // (docs/link-card-requirements.md §7.7). The handle, or a press on a ringed block,
            // still moves it. A TextSelection drag (including the footnote reference's, criterion 14)
            // is untouched.
            dragstart(view, event) {
              if (
                !(view.state.selection instanceof NodeSelection) &&
                !pressedNativeDragSource(view, event.target)
              ) {
                return false;
              }
              event.preventDefault();
              return true;
            },
            // Pressing a ringed block picks it up as its handle does. False either way, so
            // ProseMirror keeps its mousedown handling. NodeView chrome claimed by `stopEvent`
            // never reaches here.
            mousedown(view, event) {
              if (event.button !== 0) return false;
              const block = selectedHandledBlock(view.state);
              if (!block) return false;
              const dom = view.nodeDOM(block.from);
              if (!(dom instanceof HTMLElement)) return false;
              if (!(event.target instanceof Node) || !dom.contains(event.target)) return false;
              // The handle is the widget right before the block, kept visible for the session.
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
              // Suppress the browser's drag-selection as the handle's mousedown does
              // (docs/editor-pitfalls.md §5.2); handleMouseUp gives a plain click its caret back.
              event.preventDefault();
              return false;
            },
          },
          // Modal while moving (docs/editor-pitfalls.md §5.1): Delete/Backspace would remove the
          // NodeSelected block and applyMove's from/to would point past the end. Runs before
          // ProseMirror's keymaps; Escape cancels.
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
          // Realign on doc changes (not selection-only updates) and on content-box resizes (rewrap,
          // image loads). Absolute handles can't resize the box, so no loop.
          alignHandles(editorView);
          const resizeObserver = new ResizeObserver(() => alignHandles(editorView));
          resizeObserver.observe(editorView.dom);
          return {
            update: (view, prevState) => {
              if (view.state.doc !== prevState.doc) {
                // A doc change that slipped past the modal keys makes the captured positions stale:
                // abort. A real drop has already ended its session, so this no-ops then.
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
