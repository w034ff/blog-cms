'use client';

import { useLayoutEffect, useState, type RefObject } from 'react';

// Publishes an element's height as a CSS custom property on `host` (the <form>), for chrome whose
// height wraps and changes: `--editor-header-h` (the toolbar pins below the header) and
// `--editor-toolbar-h` (the post is padded above the phone's bottom toolbar,
// docs/editor-requirements.md §12.5). app/globals.css carries first-paint fallbacks.
//
// A layout effect, so no frame paints with the toolbar overlapping the header. **A callback ref,
// not a `useRef`:** the toolbar mounts after `editor` exists, and an effect keyed on a ref would
// never re-run to see it.
export function useMeasuredHeight<T extends HTMLElement>(
  host: RefObject<HTMLElement | null>,
  variable: string,
): (node: T | null) => void {
  const [measured, setMeasured] = useState<T | null>(null);
  useLayoutEffect(() => {
    const target = host.current;
    if (!measured || !target) return;
    const apply = () => {
      target.style.setProperty(variable, `${measured.offsetHeight}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(measured);
    return () => observer.disconnect();
  }, [host, measured, variable]);
  return setMeasured;
}
