'use client';

import { useEffect } from 'react';

// The reading preview for published footnotes (docs/footnote-popover-requirements.md). An addition
// to markup that already works: remark-gfm links each reference to its definition's `id`, so the
// content is a clone of a node on the page (§2). Nothing rewrites `href` or `id`; without script
// the page is unchanged (§3.4).

const OPEN_DELAY_MS = 200; // §6: a `sup` is a small target, and a pointer on its way elsewhere crosses it
// §6: the preview is enterable, so leaving the reference must allow crossing the gap (§5.3).
const CLOSE_DELAY_MS = 200;
// §6: how far the page must move before a pinned popover gives up: touch has no pointer leave, so a
// scroll means the reader moved on. Not zero: iOS scrolls for an address bar or a rubber band.
const SCROLL_DISMISS_PX = 24;
const VIEWPORT_MARGIN = 16; // 1rem — the same number as the width's `calc(100vw - 2rem)` (§5.2.1)
const REFERENCE_GAP = 8; // §5.3: the popover must not cover the reference the reader is about to click

type PopoverElement = HTMLDivElement & {
  showPopover: () => void;
  hidePopover: () => void;
};

type PopoverKind = 'preview' | 'pinned';

// `#user-content-fn-<label>`, percent-encoded for a non-ASCII hand-written label (the editor's are
// hex, docs/footnote-requirements.md §4).
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

// The content from the definition, or false when there is none (§3.6: a plain anchor stays).
function fill(popover: PopoverElement, reference: HTMLAnchorElement, kind: PopoverKind): boolean {
  const definition = definitionFor(reference);
  if (!definition) return false;

  const note = definition.cloneNode(true) as HTMLElement;
  // `↩` means "back to where you are" here, so it goes (§4.1).
  note.querySelectorAll('a[data-footnote-backref]').forEach((backref) => backref.remove());
  if (!note.textContent?.trim()) return false;

  // The clamp goes on the note's own <p>: a `-webkit-box` around blocks counts lines unreliably,
  // and §4.3.2 measured the paragraph. Definitions are inline-only (docs/footnote-requirements.md
  // §2); external markdown's extra blocks are dropped, since eight lines each could cover the page
  // (§1) and the full note is one jump away.
  const body = note.firstElementChild ?? note;
  body.classList.add('footnote-popover-note');
  popover.replaceChildren(body);

  if (kind === 'pinned') {
    // §4.2: the reference's jump, given back to touch; the only way to a clamped note's rest
    // (§4.3.1).
    const jump = document.createElement('a');
    jump.className = 'footnote-popover-jump';
    jump.href = reference.getAttribute('href') ?? '';
    jump.textContent = '定義へ';
    popover.appendChild(jump);
  }
  return true;
}

// Above the reference, centred, flipped below if it does not fit (§5.2). Viewport coordinates: the
// top layer escapes every ancestor's scroll and offset (§5.2.3).
function place(popover: PopoverElement, reference: HTMLAnchorElement): void {
  popover.style.maxHeight = '';
  const ref = reference.getBoundingClientRect();
  const view = document.documentElement;
  const box = popover.getBoundingClientRect();

  // Centre, then pull inward: an off-centre box can be read, an off-screen one cannot (§5.2.1).
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
    // Neither side fits (§5.2.2): after the media query has shortened the note, the one case where
    // a height cap may take over from the line clamp.
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
  // The hover bridge: leaving schedules, returning cancels, for the reference and the popover
  // alike.
  scheduleClose: () => void;
  cancelClose: () => void;
  isOpen: () => boolean;
  isOpenFor: (reference: HTMLAnchorElement) => boolean;
  destroy: () => void;
};

function createPopover(kind: PopoverKind): Controller {
  const popover = document.createElement('div') as PopoverElement;
  // `manual` for the preview, `auto` for the pinned one (§5.1.1): light dismiss and Escape suit a
  // pinned popover and are one close condition too many for a preview. Manual loses Escape too; the
  // document listener below restores it (WCAG SC 1.4.13 Dismissible).
  popover.setAttribute('popover', kind === 'preview' ? 'manual' : 'auto');
  popover.className = `footnote-popover footnote-popover--${kind} prose prose-zinc dark:prose-invert`;
  // Not hidden from assistive technology (§3.5.1): the preview is enterable, its links reachable.
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

  let openedAt = 0;

  const reposition = () => {
    if (frame || !anchor) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      if (anchor) place(popover, anchor);
    });
  };

  // A scroll dismisses the pinned popover (§6); the preview follows it, since a pointer resting in
  // the box means the reader is still reading.
  const onScroll = () => {
    if (kind === 'pinned' && anchor && Math.abs(window.scrollY - openedAt) > SCROLL_DISMISS_PX) {
      close();
      return;
    }
    reposition();
  };

  // Resize never dismisses (an address bar can cause it) and resets the baseline, so the next
  // scroll check measures only the reader.
  const onResize = () => {
    openedAt = window.scrollY;
    reposition();
  };
  const scrollOptions: AddEventListenerOptions = { passive: true, capture: true };

  // Scroll and resize move it; closing is §6's alone (§5.2.3).
  const listen = () => {
    window.addEventListener('scroll', onScroll, scrollOptions);
    window.addEventListener('resize', onResize);
  };
  const unlisten = () => {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    window.removeEventListener('scroll', onScroll, scrollOptions);
    window.removeEventListener('resize', onResize);
  };

  // 「定義へ」 is a same-page hash jump inside the popover: no unload, no light dismiss, so close it.
  if (kind === 'pinned') {
    popover.addEventListener('click', (event) => {
      if (event.target instanceof HTMLElement && event.target.closest('.footnote-popover-jump')) {
        close();
      }
    });
  }

  // The platform can close it too (light dismiss, Escape), bypassing close(): keep state in step.
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

  // The hover bridge (§6): leaving either box only schedules the close, and reaching the other
  // cancels it. It exists only because the preview is enterable.
  if (kind === 'preview') {
    popover.addEventListener('pointerenter', cancelClose);
    popover.addEventListener('pointerleave', scheduleClose);
  }

  return {
    open(reference) {
      cancelClose();
      if (anchor === reference) return;
      // Through close(): `showPopover()` throws on a showing element, and `manual` has no
      // one-at-a-time rule (§5.1.1). Guarded here for all three callers.
      if (anchor) close();
      if (!fill(popover, reference, kind)) return;
      anchor = reference;
      openedAt = window.scrollY; // the baseline the pinned dismissal measures against
      // Measured unseen: size is known only in the top layer, and `visibility` hides the first
      // frame's UA centring.
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

// Enhances `#${targetId}` with footnote previews, as CodeCopyButtons does: behaviour attached after
// mount and removed on cleanup. The two popovers are created imperatively, one each (§7).
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
      // Set on every pointerdown, so a mouse click never inherits a tap's type (§3.1).
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
        // Another reference's note drops at once, or it would hang over this one for the open
        // delay, and with a pinned popover the timer below returns early and nothing closes it.
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
          // Untouched: the anchor jumps, and modifier/middle click keep working (no preventDefault,
          // §3.1, §3.3).
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

    // The preview's Escape (§6): `manual` has no light dismiss, and focus stays on the reference.
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
