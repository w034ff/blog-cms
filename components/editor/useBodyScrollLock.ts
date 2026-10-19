'use client';

import { useEffect } from 'react';

// Freezes the page's scroll while a full-screen overlay is up: the ＋ drawer and the editor's
// dialogs (`fixed` overlays, not native `<dialog>`s, so no `showModal()`), and the image zoom (a
// `showModal()` dialog, which stops clicks and focus but not the wheel).
//
// A count, not a boolean: InsertDialog can be open over the ＋ sheet, so one closing must not
// release the other's lock.
let lockCount = 0;
let previousOverflow = '';
let previousPadding = '';

// Takes one lock; the returned function releases it, at most once.
//
// The page reserves no scrollbar gutter (docs/project-status.md), so hiding the overflow takes a
// classic scrollbar away and the centred layout would jump sideways. While locked, the body is
// padded by the scrollbar's width instead — only when a scrollbar was showing: a page too short to
// scroll has none, and padding it would cause the very shift it prevents. Padding rather than
// `scrollbar-gutter: stable`: a reserved gutter lies outside the viewport that a `fixed` backdrop
// fills, so the bare page showed through a strip beside the wash. The body has no padding of its
// own (globals.css), so the width is set rather than added.
export function lockPageScroll(): () => void {
  if (lockCount === 0) {
    const { body, documentElement: root } = document;
    const scrollbar = window.innerWidth - root.clientWidth;
    previousPadding = body.style.paddingRight;
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
  }
  lockCount++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount--;
    if (lockCount === 0) {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPadding;
    }
  };
}

export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    return lockPageScroll();
  }, [locked]);
}
