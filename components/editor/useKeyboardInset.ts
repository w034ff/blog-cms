'use client';

import { useEffect, type RefObject } from 'react';

// How far the software keyboard covers the bottom of the window, published as `--editor-kb-inset`
// on `host` (the <form>). The format toolbar is fixed to `bottom: var(--editor-kb-inset, 0px)` on a
// phone (docs/editor-requirements.md §12.5), so this is what lifts it clear of the keyboard instead
// of leaving it underneath.
//
// **One formula, both platforms.** Android is handled by `interactiveWidget: 'resizes-content'` in
// app/admin/posts/layout.tsx: the layout viewport itself shrinks, `bottom: 0` is already above the
// keyboard, and the difference below comes out at ~0 — so the two mechanisms do not stack and the
// bar is not lifted twice. iOS Safari does not honour that key at all (it resizes only the visual
// viewport), which is why the measurement exists.
//
// `offsetTop` is in the sum because iOS scrolls the visual viewport within the layout viewport when
// the keyboard opens: without that term the bar drifts as the page is scrolled with the keyboard up.
//
// A passive effect, not a layout one, unlike useMeasuredHeight: nothing here is read back during
// the same paint, and the value only matters once a keyboard has opened — which is an event, never
// the first frame.
export function useKeyboardInset(host: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const target = host.current;
    const viewport = window.visualViewport;
    // No visualViewport (older browsers, and jsdom): the CSS fallback of 0px stands, which is the
    // arrangement this screen had before the bar moved — correct, not degraded.
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
