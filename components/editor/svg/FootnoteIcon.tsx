// Two lines of body text, long over short. No numeral: at 16px a "1" beside a line read as an
// equals sign. The row's label says "footnote"; the glyph is a generic note mark.
export function FootnoteIcon() {
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
      <line x1='3' y1='9' x2='21' y2='9' />
      <line x1='3' y1='15' x2='13' y2='15' />
    </svg>
  );
}
