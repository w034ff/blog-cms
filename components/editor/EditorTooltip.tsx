'use client';

// The editor's tooltip. Extracted from ToolbarButton so the link card's two text lines can carry
// the same one rather than falling back to the browser's `title` attribute, which cannot be styled
// and which ToolbarButton dropped on purpose (it renders near the cursor, on a delay the browser
// picks).
//
// Renders the bubble only. The host element supplies `group/tt relative`, because the tooltip is
// positioned against it and the hover that reveals it is the host's.
//
// `aria-hidden`: this is a visual echo of a name assistive tech already has by another route — the
// host's `aria-label`, or its own text. Exposing it again would read the label twice.
export function EditorTooltip({ label, shortcut }: { label?: string; shortcut?: string }) {
  if (!label && !shortcut) return null;
  return (
    // Centered below the host (left-1/2 + -translate-x-1/2, top-full). pointer-events-none so it
    // never blocks hover or click; z-50 clears the sticky header's own content. A short delay on
    // appearance mimics a native tooltip; it hides immediately.
    //
    // Wraps inside a maximum width rather than running off the screen on one line: what the link
    // card puts in here is a URL that was too long to show in full, which is exactly the case a
    // `whitespace-nowrap` tooltip handles worst. Short labels are unaffected — they never reach
    // the width.
    //
    // `w-max` is what makes that work. An absolutely positioned box shrinks to fit its containing
    // block, and `left-1/2` leaves it only half of one — so on a narrow host it wrapped every
    // label into a column two words wide (measured: 「ブログ開設の / お知らせ」 on a 288px line).
    // `w-max` sizes it to its content first, and `max-w-xs` is then the only limit.
    <span
      aria-hidden='true'
      className='editor-tooltip pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 w-max max-w-xs -translate-x-1/2 break-all rounded bg-zinc-900 px-1.5 py-1 text-[10px] leading-tight text-white opacity-0 shadow-sm transition-opacity duration-100 group-hover/tt:opacity-100 group-hover/tt:delay-300 dark:bg-zinc-700'>
      {label}
      {shortcut && <span className={label ? 'ml-1.5 text-white/60' : undefined}>{shortcut}</span>}
    </span>
  );
}
