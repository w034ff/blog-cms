'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';

// The editor screen has two stacked sticky layers: the post's own header bar (the way out,
// the autosave state, 記事の設定, 更新) and the format toolbar inside the editor frame. The
// toolbar pins *below* the header, so it needs the header's height — and that height is not a
// constant to write down: the bar wraps to a second line at narrow widths, 保存に失敗 is wider
// than 保存済み ✓, and a refused publish adds its notice to the same box.
//
// So it is measured, and published as `--editor-header-h` on `host` — the <form>, the nearest
// element that contains both layers. The toolbar reads it as `top-(--editor-header-h)`.
// app/globals.css carries a fallback value for the first paint.
//
// The measurement is a layout effect reading the node the observer is given, not a ref read on
// some later commit: a passive effect would leave one painted frame with the toolbar still at
// `top: 0`, overlapping the header it is supposed to sit under.
export function useStickyHeaderOffset<T extends HTMLElement>(
  host: RefObject<HTMLElement | null>,
): RefObject<T | null> {
  const headerRef = useRef<T>(null);
  useLayoutEffect(() => {
    const header = headerRef.current;
    const target = host.current;
    if (!header || !target) return;
    const apply = () => {
      target.style.setProperty('--editor-header-h', `${header.offsetHeight}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(header);
    return () => observer.disconnect();
  }, [host]);
  return headerRef;
}
