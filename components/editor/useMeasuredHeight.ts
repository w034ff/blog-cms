'use client';

import { useLayoutEffect, useState, type RefObject } from 'react';

// Publishes an element's height to CSS as a custom property on `host`. Two pieces of the editor's
// chrome need one, and neither height is a constant that could be written down:
//
// `--editor-header-h` — the post's header bar (the way out, the autosave state, 記事の設定, 更新).
// The format toolbar pins *below* it on a pointer, so it needs the bar's height; the bar wraps to a
// second line at narrow widths, 保存に失敗 is wider than 保存済み ✓, and a refused publish adds its
// notice to the same box.
//
// `--editor-toolbar-h` — the format toolbar itself. On a phone it is fixed to the bottom of the
// screen (docs/table-requirements.md §12.5), so the post needs that much padding under it or the
// last line is written underneath the bar. It wraps to a second row at 320px, which is why a
// constant would be the same mistake here as above.
//
// `host` is the <form> in both cases — the nearest element that contains every layer. app/globals.
// css carries fallback values for the first paint.
//
// The measurement is a layout effect, not a passive one: a passive effect would leave one painted
// frame with the toolbar still at `top: 0`, overlapping the header it is supposed to sit under.
//
// **A callback ref, not a `useRef`.** The toolbar is inside `editor &&` — it is not in the tree on
// the commit that mounts this screen — and an effect keyed on the host alone would read a null ref
// then and never run again, leaving the fallback value standing for the life of the page. Holding
// the node in state is what re-runs the effect on the commit that actually renders it. (The header
// is present from the first commit and would not have noticed; the two share one hook, so the
// weaker of the two requirements is not the one to write against.)
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
