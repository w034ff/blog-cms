// TableIcon's frame with only its horizontal dividers kept — three equal bands, no vertical
// split, so it reads as "rows" specifically rather than a repeat of the generic table glyph.
export function TableRowsIcon() {
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
      <rect x='3' y='4' width='18' height='16' rx='2' />
      <line x1='3' y1='9.33' x2='21' y2='9.33' />
      <line x1='3' y1='14.67' x2='21' y2='14.67' />
    </svg>
  );
}
