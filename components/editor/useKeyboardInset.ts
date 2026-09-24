'use client';

import { useEffect, type RefObject } from 'react';

// How far the software keyboard covers the bottom of the window, published as `--editor-kb-inset`
// on `host` (the <form>). The format toolbar is fixed to `bottom: var(--editor-kb-inset, 0px)` on a
// phone (docs/editor-requirements.md §12.5), so this is what lifts it clear of the keyboard instead
// of leaving it underneath.
//
// **One formula, both platforms.** On Android, `interactiveWidget: 'resizes-content'`
// (app/admin/posts/layout.tsx) shrinks the layout viewport, so the difference below is ~0 and the
// bar is not lifted twice. iOS Safari ignores that key and resizes only the visual viewport.
// `offsetTop` is included because iOS scrolls the visual viewport when the keyboard opens.
//
// A passive effect: the value matters only after a keyboard opens, never on the first frame.
export function useKeyboardInset(host: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const target = host.current;
    const viewport = window.visualViewport;
    // No visualViewport (older browsers, jsdom): the CSS fallback of 0px is correct.
    if (!target || !viewport) return;
    const apply = () => {
      const covered = window.innerHeight - (viewport.height + viewport.offsetTop);
      target.style.setProperty('--editor-kb-inset', `${Math.max(0, Math.round(covered))}px`);
    };
    apply();
    viewport.addEventListener('resize', apply);
    viewport.addEventListener('scroll', apply);
    return () => {
      viewport.removeEventListener('resize', apply);
      viewport.removeEventListener('scroll', apply);
    };
  }, [host]);
}
