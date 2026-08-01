'use client';

import { useEffect, useState } from 'react';
import type { TocEntry } from '@/lib/render';

// A heading counts as reached once its top crosses this line — far enough down that a heading
// doesn't light up the moment it appears at the bottom of the screen, and comfortably below
// where a jumped-to heading comes to rest (#post-body's scroll-margin-top is 1rem,
// app/globals.css), so clicking a TOC link always leaves its own entry the active one.
const BAND_TOP_PX = 64;

// Shared by TocNavMobile/TocNavDesktop below. Note that BOTH always mount: the toc:hidden /
// hidden toc:block split is CSS visibility, not conditional rendering, so React runs both
// components' effects at every viewport and two scroll listeners are always live. That's
// deliberate rather than lifted into one shared instance — both read the same heading positions
// against the same line, so they independently arrive at the same id and cannot drift apart; the
// cost is one redundant rAF pass, against a context/provider for state that only ever has one
// correct value. Making the split conditional instead (rendering one or the other) would need
// the breakpoint in JS, which server-rendered markup can't know.
function useActiveHeadingId(toc: TocEntry[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const headingEls = toc
      .map((entry) => document.getElementById(entry.id))
      .filter((el): el is HTMLElement => el !== null);
    if (headingEls.length === 0) return;

    // Derived from position on every pass, never from remembered state: the active entry is the
    // last heading whose top has crossed BAND_TOP_PX — the section being read — falling back to
    // the first heading while the reader is still above it, so the list always points somewhere.
    // The previous version tracked which headings an IntersectionObserver had last reported
    // inside a band and kept the old value whenever that set went empty, which made the answer
    // depend on how the reader got there (scrolling back to the top left the first entry lit,
    // while a fresh load left nothing lit) and on whether the first heading happened to fall
    // inside the band at all — it does at ~1080px of window height here, but not at ~800px.
    const update = () => {
      let active = headingEls[0];
      for (const el of headingEls) {
        if (el.getBoundingClientRect().top > BAND_TOP_PX) break;
        active = el;
      }
      setActiveId(active.id);
    };

    // A scroll listener rather than an IntersectionObserver: IO reports nothing when an element
    // goes from not-intersecting to not-intersecting, so an instant jump that carries a heading
    // clear past the band between two frames — a TOC link under prefers-reduced-motion, or a
    // #hash landing — would leave the highlight stale. On this page that is usually masked by
    // the smooth scrolling app/globals.css gives `html:has(#post-body)`, which animates the jump
    // through the band — but that rule is off under prefers-reduced-motion, exactly when the
    // jump is instant.
    // rAF-throttled, so a scroll frame costs at most one pass over the headings.
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
        <li key={entry.id} className={entry.level === 3 ? 'pl-4' : undefined}>
          <a
            href={`#${entry.id}`}
            aria-current={entry.id === activeId ? 'location' : undefined}
            className={`toc-link block truncate text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 ${entry.id === activeId ? 'is-active' : ''}`}>
            {entry.text}
          </a>
        </li>
      ))}
    </ol>
  );
}

// Collapsed by default: it renders as the top section of the post-body card (app/posts/[slug]/
// page.tsx), ahead of the article body, so it must not push the actual content down before the
// reader even starts reading. A border-bottom (not its own box) is deliberate: a full
// bordered/rounded box here would nest inside the card's own border and read as a box-in-a-box.
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

// The `sticky` + `top` combo only tracks properly because the grid parent (app/posts/[slug]/
// page.tsx) sets `items-start`: without it, a grid item stretches to the row's full height and
// has no room left to stick within. `toc:col-start-3` places this in the grid's fluid `1fr` rail
// track (it can never overflow — see the grid comment in page.tsx); `ml-6` is the gap from the
// article, and `max-w-60` stops the rail from sprawling wide on an ultrawide viewport. Same
// card styling as the post-body card (app/posts/[slug]/page.tsx) — border/bg/radius match, so
// the two read as one consistent "content module" language on the page.
export function TocNavDesktop({ toc }: { toc: TocEntry[] }) {
  const activeId = useActiveHeadingId(toc);
  return (
    <nav
      aria-label='目次'
      className='hidden toc:block toc:col-start-3 toc:ml-6 toc:max-w-60 sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900'>
      <p className='font-semibold text-sm mb-3'>目次</p>
      <TocList toc={toc} activeId={activeId} />
    </nav>
  );
}
