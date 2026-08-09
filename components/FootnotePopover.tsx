'use client';

import { useEffect } from 'react';

// The reading preview for published footnotes (docs/footnote-popover-requirements.md).
//
// The whole feature is an addition to markup that already works: remark-gfm gives every reference
// an `href` pointing at its definition's `id` on the same page, so the popover's content is a clone
// of a node that is already here (§2) and the reference stays an ordinary anchor. Nothing below
// rewrites `href` or `id` — with no script the page behaves exactly as it did (§3.4).

const OPEN_DELAY_MS = 200; // §6: a `sup` is a small target, and a pointer on its way elsewhere crosses it
// §6: the preview can be entered now, so leaving the reference cannot close it at once — the
// pointer has to cross the gap that keeps the box off the reference (§5.3) to get there.
const CLOSE_DELAY_MS = 200;
const VIEWPORT_MARGIN = 16; // 1rem — the same number as the width's `calc(100vw - 2rem)` (§5.2.1)
const REFERENCE_GAP = 8; // §5.3: the popover must not cover the reference the reader is about to click

type PopoverElement = HTMLDivElement & {
  showPopover: () => void;
  hidePopover: () => void;
};

type PopoverKind = 'preview' | 'pinned';

// `#user-content-fn-<label>`, percent-encoded when the label is not ASCII (a hand-written note can
// carry one — the editor's own labels are generated hex, docs/footnote-requirements.md §4).
function definitionFor(reference: HTMLAnchorElement): HTMLElement | null {
  const href = reference.getAttribute('href');
  if (!href?.startsWith('#')) return null;
  const raw = href.slice(1);
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    // Malformed escape: fall back to the literal id rather than throwing out of a listener.
  }
  return document.getElementById(id) ?? document.getElementById(raw);
}

// Builds the popover's content from the definition, or answers false when there is nothing to show
// (§3.6: a reference whose definition is missing keeps its plain-anchor behaviour).
function fill(popover: PopoverElement, reference: HTMLAnchorElement, kind: PopoverKind): boolean {
  const definition = definitionFor(reference);
  if (!definition) return false;

  const note = definition.cloneNode(true) as HTMLElement;
  // `↩` means "back to where you are standing" in here, so it has nothing to say (§4.1).
  note.querySelectorAll('a[data-footnote-backref]').forEach((backref) => backref.remove());
  if (!note.textContent?.trim()) return false;

  // The clamp goes on the note's own <p>, never on a wrapper: a `-webkit-box` holding block
  // children counts lines unreliably, and §4.3.2's 184px was measured on the paragraph itself.
  //
  // A definition is inline-only (docs/footnote-requirements.md §2), so that paragraph is the whole
  // note and this loses nothing. Only externally authored markdown can put more blocks in a
  // footnote, and there the tail is dropped rather than clamped block-by-block — eight lines per
  // paragraph would let one note cover the page, which is the thing §1 exists to prevent, and the
  // full note is still one jump away.
  const body = note.firstElementChild ?? note;
  body.classList.add('footnote-popover-note');
  popover.replaceChildren(body);

  if (kind === 'pinned') {
    // §4.2: the jump this design left on the reference for desktop, given back to touch — and the
    // only way to reach a clamped note's remainder there (§4.3.1).
    const jump = document.createElement('a');
    jump.className = 'footnote-popover-jump';
    jump.href = reference.getAttribute('href') ?? '';
    jump.textContent = '定義へ';
    popover.appendChild(jump);
  }
  return true;
}

// Above the reference, centred on it, flipped below when it does not fit (§5.2). Everything is in
// viewport coordinates: the popover is in the top layer, so no ancestor's scroll or offset parent
// enters into it (§5.2.3).
function place(popover: PopoverElement, reference: HTMLAnchorElement): void {
  popover.style.maxHeight = '';
  const ref = reference.getBoundingClientRect();
  const view = document.documentElement;
  const box = popover.getBoundingClientRect();

  // Centre, then move inward by the overflow — near a viewport edge the two cannot both hold, and
  // a box off screen cannot be read while an off-centre one can (§5.2.1).
  const rightMost = Math.max(VIEWPORT_MARGIN, view.clientWidth - VIEWPORT_MARGIN - box.width);
  const left = Math.min(
    Math.max(ref.left + ref.width / 2 - box.width / 2, VIEWPORT_MARGIN),
    rightMost,
  );

  const spaceAbove = ref.top - REFERENCE_GAP - VIEWPORT_MARGIN;
  const spaceBelow = view.clientHeight - ref.bottom - REFERENCE_GAP - VIEWPORT_MARGIN;
  let top: number;
  if (box.height <= spaceAbove) {
    top = ref.top - REFERENCE_GAP - box.height; // the default: it covers what has been read
  } else if (box.height <= spaceBelow) {
    top = ref.bottom + REFERENCE_GAP;
  } else if (spaceAbove >= spaceBelow) {
    // Neither side fits (§5.2.2). The clamp's own media query has already shortened the note by
    // here; this is the last resort, and it is the one case where a height cap is allowed to take
    // over from the line clamp.
    popover.style.maxHeight = `${Math.max(spaceAbove, 0)}px`;
    top = VIEWPORT_MARGIN;
  } else {
    popover.style.maxHeight = `${Math.max(spaceBelow, 0)}px`;
    top = ref.bottom + REFERENCE_GAP;
  }

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

type Controller = {
  open: (reference: HTMLAnchorElement) => void;
  close: () => void;
  // Half of the hover bridge: the reference schedules on the way out and cancels on the way back,
  // and so does the popover itself.
  scheduleClose: () => void;
  cancelClose: () => void;
  isOpen: () => boolean;
  isOpenFor: (reference: HTMLAnchorElement) => boolean;
  destroy: () => void;
};

function createPopover(kind: PopoverKind): Controller {
  const popover = document.createElement('div') as PopoverElement;
  // `manual` for the preview, `auto` for the pinned one (§5.1.1): auto's light dismiss and Escape
  // are what a pinned popover wants, and one close condition too many for a preview that already
  // closes when the pointer leaves. The cost is that manual gives up Escape too — the document
  // listener below is what pays it (WCAG SC 1.4.13 Dismissible).
  popover.setAttribute('popover', kind === 'preview' ? 'manual' : 'auto');
  popover.className = `footnote-popover footnote-popover--${kind} prose prose-zinc dark:prose-invert`;
  // Neither popover is hidden from assistive technology any more (§3.5.1, revised 2026-08-09): the
  // preview can be entered, so its cloned links are real targets, and `aria-hidden` or `inert` over
  // reachable controls is the pairing that section rules out.
  document.body.appendChild(popover);

  let anchor: HTMLAnchorElement | null = null;
  let frame = 0;
  let closeTimer = 0;

  const cancelClose = () => {
    if (closeTimer) window.clearTimeout(closeTimer);
    closeTimer = 0;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer = window.setTimeout(() => {
      closeTimer = 0;
      close();
    }, CLOSE_DELAY_MS);
  };

  const reposition = () => {
    if (frame || !anchor) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      if (anchor) place(popover, anchor);
    });
  };
  const scrollOptions: AddEventListenerOptions = { passive: true, capture: true };

  // Scroll and resize move it, never close it — the close conditions are §6's and nowhere else
  // (§5.2.3).
  const listen = () => {
    window.addEventListener('scroll', reposition, scrollOptions);
    window.addEventListener('resize', reposition);
  };
  const unlisten = () => {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    window.removeEventListener('scroll', reposition, scrollOptions);
    window.removeEventListener('resize', reposition);
  };

  // Following 「定義へ」 is a same-page hash jump, so nothing unloads and light dismiss never fires
  // (the click is inside the popover) — it would be left hanging over the definition it just
  // travelled to.
  if (kind === 'pinned') {
    popover.addEventListener('click', (event) => {
      if (event.target instanceof HTMLElement && event.target.closest('.footnote-popover-jump')) {
        close();
      }
    });
  }

  // The pinned popover can also be closed by the platform (light dismiss, Escape), which does not
  // come back through close() — keep our own state in step with the element's.
  popover.addEventListener('toggle', () => {
    if (popover.matches(':popover-open')) return;
    anchor = null;
    unlisten();
  });

  const close = () => {
    cancelClose();
    if (!anchor) return;
    anchor = null;
    unlisten();
    popover.hidePopover();
  };

  // The hover bridge (§6). The reference and the popover are two boxes with a gap between them, and
  // a pointer travelling from one to the other is outside both for a moment — so leaving either
  // only schedules the close, and arriving at the other cancels it. This is the machinery §9 spent
  // a while avoiding; it exists because the preview is enterable, and only for that reason.
  if (kind === 'preview') {
    popover.addEventListener('pointerenter', cancelClose);
    popover.addEventListener('pointerleave', scheduleClose);
  }

  return {
    open(reference) {
      cancelClose();
      if (anchor === reference) return;
      // Reopening for another reference has to go through close(): `showPopover()` throws on an
      // element that is already showing, and `manual` has no "only one at a time" rule to lean on
      // (§5.1.1). Guarded here rather than at the call sites — there are three of them.
      if (anchor) close();
      if (!fill(popover, reference, kind)) return;
      anchor = reference;
      // Measured before it can be seen: the size is only knowable once it is in the top layer, and
      // `visibility` keeps that first frame from landing at the UA's centred position.
      popover.style.visibility = 'hidden';
      popover.showPopover();
      place(popover, reference);
      popover.style.visibility = '';
      listen();
    },
    close,
    scheduleClose,
    cancelClose,
    isOpen: () => anchor !== null,
    isOpenFor: (reference) => anchor === reference,
    destroy() {
      close();
      popover.remove();
    },
  };
}

// Enhances the server-rendered post body (`#${targetId}`) with a footnote preview. Same shape as
// CodeCopyButtons: the body stays server-rendered, this only attaches behaviour after mount and
// puts every bit of it back on cleanup. Renders nothing into the React tree — the two popover
// elements are created imperatively, one each for the whole document (§7).
export function FootnotePopover({ targetId }: { targetId: string }) {
  useEffect(() => {
    const root = document.getElementById(targetId);
    if (!root) return;

    const preview = createPopover('preview');
    const pinned = createPopover('pinned');
    const undo: Array<() => void> = [];

    root.querySelectorAll<HTMLAnchorElement>('a[data-footnote-ref]').forEach((reference) => {
      if (reference.dataset.footnotePopover) return; // idempotent
      if (!definitionFor(reference)) return; // §3.6: leave a plain working anchor
      reference.dataset.footnotePopover = 'on';

      let openTimer = 0;
      // Set on every pointerdown, so a mouse click can never inherit an earlier tap's type — that
      // would eat a plain desktop click, which is the property §3.1 is built to protect.
      let pointerType = '';

      const cancelOpen = () => {
        if (openTimer) window.clearTimeout(openTimer);
        openTimer = 0;
      };

      const onPointerEnter = (event: PointerEvent) => {
        if (event.pointerType === 'touch') return; // touch has no hover; the tap path handles it
        cancelOpen();
        // Coming back to the reference from the popover is the other half of the bridge.
        preview.cancelClose();
        // Another reference's note is dropped at once rather than after this one's open delay:
        // otherwise the previous note hangs over the reference now under the pointer for 200ms,
        // and — where a pinned popover makes the timer below return early — with no close pending
        // at all. Two references in one sentence is enough to meet both.
        if (!preview.isOpenFor(reference)) preview.close();
        openTimer = window.setTimeout(() => {
          openTimer = 0;
          if (pinned.isOpen()) return; // a hybrid device can have one pinned already
          preview.open(reference);
        }, OPEN_DELAY_MS);
      };

      const onPointerLeave = () => {
        cancelOpen();
        // Scheduled, not immediate: the pointer may be on its way into the popover (§6).
        preview.scheduleClose();
      };

      const onFocus = () => {
        // Keyboard focus only. A click focuses the reference too, and that path is a jump.
        if (!reference.matches(':focus-visible') || pinned.isOpen()) return;
        preview.close();
        preview.open(reference); // no delay: a Tab is deliberate, so there is no misfire to absorb
      };

      const onBlur = () => {
        cancelOpen();
        preview.close();
      };

      const onPointerDown = (event: PointerEvent) => {
        pointerType = event.pointerType; // 'pen' counts as a mouse — it hovers (§3.2)
      };

      const onClick = (event: MouseEvent) => {
        const wasTouch = pointerType === 'touch';
        pointerType = '';
        if (!wasTouch) {
          // Untouched: the anchor jumps, and modifier-click, middle-click and "open in new tab"
          // keep working because nothing here calls preventDefault (§3.1, §3.3).
          preview.close();
          return;
        }
        event.preventDefault();
        preview.close();
        pinned.open(reference);
      };

      reference.addEventListener('pointerenter', onPointerEnter);
      reference.addEventListener('pointerleave', onPointerLeave);
      reference.addEventListener('focus', onFocus);
      reference.addEventListener('blur', onBlur);
      reference.addEventListener('pointerdown', onPointerDown);
      reference.addEventListener('click', onClick);

      undo.push(() => {
        cancelOpen();
        reference.removeEventListener('pointerenter', onPointerEnter);
        reference.removeEventListener('pointerleave', onPointerLeave);
        reference.removeEventListener('focus', onFocus);
        reference.removeEventListener('blur', onBlur);
        reference.removeEventListener('pointerdown', onPointerDown);
        reference.removeEventListener('click', onClick);
        delete reference.dataset.footnotePopover;
      });
    });

    // The preview's Escape (§6). `manual` gets no light dismiss, and content shown on hover or
    // focus has to be dismissable without moving either — so focus stays on the reference here.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') preview.close();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      undo.forEach((step) => step());
      preview.destroy();
      pinned.destroy();
    };
  }, [targetId]);

  return null;
}
