// 書き方 in the page header (docs/cms-features.md「書き方ヘルプ」§2): Feather's `help-circle`,
// stroke-first like the rest of the header's icons. A bare `?` glyph was the alternative and reads
// as punctuation next to the gear beside it — the ring is what makes it a control.
export function HelpIcon() {
  return (
    <svg
      viewBox='0 0 24 24'
      className='block h-4 w-4'
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'>
      <circle cx='12' cy='12' r='10' />
      <path d='M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' />
      <line x1='12' y1='17' x2='12.01' y2='17' />
    </svg>
  );
}
