'use client';

import { useEffect } from 'react';

// Freezes `document.body`'s own scroll while a `fixed` full-screen overlay (the ＋ drawer, the
// insert dialog) is up — neither is a native `<dialog>`, so neither gets the background-scroll
// lock `showModal()` provides for free (`TableSizeDialog`, the one native dialog in this editor,
// needs no equivalent). Without this, scrolling on the backdrop — or scrolling the overlay's own
// content past its edge, which chains into whatever is behind it — moves the post underneath the
// overlay that is supposed to be covering it (measured 2026-09-20: `window.scrollY` moved on a
// wheel event over the ＋ sheet's backdrop, with the post visibly scrolling behind the dim).
//
// A count, not a boolean: `InsertDialog` can be open at the same time as the ＋ drawer's own sheet
// (リンク opened from the drawer keeps the sheet mounted underneath — InsertDialog.tsx's own `z-55`
// comment), so one closing must not release the lock while the other is still up.
let lockCount = 0;
let previousOverflow = '';

export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    if (lockCount === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    lockCount++;
    return () => {
      lockCount--;
      if (lockCount === 0) document.body.style.overflow = previousOverflow;
    };
  }, [locked]);
}
