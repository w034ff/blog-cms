'use client';

import { useEffect, useState } from 'react';
import type { TocEntry } from '@/lib/render';

// A heading is reached once its top crosses this line: not at the screen's bottom, and below where
// a jumped-to heading rests (scroll-margin-top 1rem), so a clicked entry stays active
// (docs/toc-requirements.md §8.3).
const BAND_TOP_PX = 64;

// Shared by both navs, which always both mount (the split is CSS; JS cannot know the breakpoint on
// the server). Each computes the same id from the same positions, so they cannot drift; one
// redundant pass beats a provider for a single value (docs/toc-requirements.md §7).
function useActiveHeadingId(toc: TocEntry[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const headingEls = toc
      .map((entry) => document.getElementById(entry.id))
      .filter((el): el is HTMLElement => el !== null);
    if (headingEls.length === 0) return;

    // From position every pass, never remembered state: the last heading past BAND_TOP_PX, else the
    // first, so the list always points somewhere (docs/toc-requirements.md §8).
    const update = () => {
      let active = headingEls[0];
      for (const el of headingEls) {
        if (el.getBoundingClientRect().top > BAND_TOP_PX) break;
        active = el;
      }
      setActiveId(active.id);
    };

    // A scroll listener, not an IntersectionObserver, which misses a jump carrying a heading past
    // the band between frames (an instant jump under reduced motion, a #hash landing) (§8.1).
    // rAF-throttled.
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [toc]);

  return activeId;
}

function TocList({ toc, activeId }: { toc: TocEntry[]; activeId: string | null }) {
  return (
    <ol className='space-y-1.5 text-sm'>
      {toc.map((entry) => (
        <li key={entry.id} className={entry.level === 3 ? 'toc-h3 pl-4' : 'toc-h2'}>
          {/* Two clamped lines, not `truncate`, which leaves ~8 characters at the narrowest
              rail (docs/toc-requirements.md §10.1); the desktop nav already scrolls. No
              `block`: the clamp sets its own display. `break-words` for a long Latin token,
              which offers no break. */}
          <a
            href={`#${entry.id}`}
            aria-current={entry.id === activeId ? 'location' : undefined}
            className={`toc-link line-clamp-2 break-words text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 ${entry.id === activeId ? 'is-active' : ''}`}>
            {entry.text}
          </a>
        </li>
      ))}
    </ol>
  );
}

// Collapsed by default, heading the post-body card (components/PostArticle.tsx) so it does not push
// the content down (§7.1). A border-bottom, not a box inside the card's box.
export function TocNavMobile({ toc }: { toc: TocEntry[] }) {
  const activeId = useActiveHeadingId(toc);
  return (
    <details className='toc:hidden mb-6 border-b border-zinc-200 pb-4 dark:border-zinc-800'>
      <summary className='cursor-pointer font-semibold text-sm'>目次</summary>
      <nav aria-label='目次' className='mt-3'>
        <TocList toc={toc} activeId={activeId} />
      </nav>
    </details>
  );
}

// Sticky works because the grid (components/PostArticle.tsx) sets `items-start`; a stretched item
// has no room to stick. A fixed `w-60` in the grid's `1fr` rail (§6): `--breakpoint-toc` is set so
// the rail always has room for it. No card: the list sits on the page ground. `p-1` keeps the
// links' focus ring inside the scroll box, which clips it.
export function TocNavDesktop({ toc }: { toc: TocEntry[] }) {
  const activeId = useActiveHeadingId(toc);
  return (
    <nav
      aria-label='目次'
      className='toc-rail hidden toc:block toc:col-start-3 toc:ml-6 toc:w-60 sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto p-1'>
      <p className='font-semibold text-sm mb-3'>目次</p>
      <TocList toc={toc} activeId={activeId} />
    </nav>
  );
}
