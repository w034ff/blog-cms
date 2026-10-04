'use client';

import { useEffect } from 'react';

// Freezes `document.body`'s scroll while a `fixed` full-screen overlay (the ＋ drawer, the insert
// dialog) is up; neither is a native `<dialog>`, so neither gets `showModal()`'s lock, and the
// post scrolled behind the backdrop.
//
// A count, not a boolean: InsertDialog can be open over the ＋ sheet, so one closing must not
// release the other's lock.
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
