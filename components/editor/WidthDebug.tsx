'use client';

import { useEffect, useState } from 'react';

// **Temporary.** A read-out of what is making the page scroll sideways, for a failure that happens
// only on a real phone (docs/link-requirements.md §5.5.19): three fixes landed against measured
// causes and the report survived all three, so the next step is to have the device say what it sees
// instead of guessing again from an emulator.
//
// Off unless `?wdebug=1` is in the URL, and returns null in production. **The flag is read in an
// effect, not during render** — the server cannot know the query string this component sees, and
// deciding in render makes the first client tree disagree with the server's (measured: a hydration
// error in the console, which is exactly the kind of noise a debugging aid must not add).
//
// It reports the document's width against the viewport's, and the widest element ending past the
// right edge — the same scan e2e/editor-narrow-menus.spec.ts runs, except on the hardware.
export function WidthDebug() {
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (!new URLSearchParams(window.location.search).has('wdebug')) return;
    let frame = window.requestAnimationFrame(function tick() {
      const vw = document.documentElement.clientWidth;
      const sw = document.documentElement.scrollWidth;
      let worst: { name: string; right: number; width: number } | null = null;
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && Math.round(r.right) > vw && (!worst || r.right > worst.right)) {
          const name = (el.className || el.tagName)
            .toString()
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .join('.');
          worst = {
            name: name.slice(0, 28),
            right: Math.round(r.right),
            width: Math.round(r.width),
          };
        }
      }
      setLine(
        `${sw}/${vw}${sw > vw ? ' ⚠' : ''}` +
          (worst ? ` — ${worst.name} R=${worst.right} w=${worst.width}` : ' — clean'),
      );
      frame = window.requestAnimationFrame(tick);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  if (line === null) return null;
  return (
    <div
      // Fixed and pointer-events-none so it cannot itself widen the page or take a tap: a probe that
      // changes what it measures is worse than no probe.
      className='pointer-events-none fixed bottom-1 left-1 z-[100] max-w-[calc(100vw-0.5rem)] rounded bg-black/80 px-1.5 py-1 font-mono text-[10px] leading-tight text-white'>
      {line}
    </div>
  );
}
