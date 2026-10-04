// Numbered-list glyph: the same three ruled lines as ListIcon, with "1 2 3" at the left instead of
// dots. The digits are `<text>`, the only `<text>` in the set: traced numeral paths smudged at 16px,
// where a font's hinting holds up.
export function OrderedListIcon() {
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
      <line x1='10' y1='6' x2='21' y2='6' />
      <line x1='10' y1='12' x2='21' y2='12' />
      <line x1='10' y1='18' x2='21' y2='18' />
      <text x='1.5' y='8.5' fontSize='7' fontWeight='700' stroke='none' fill='currentColor'>
        1
      </text>
      <text x='1.5' y='14.5' fontSize='7' fontWeight='700' stroke='none' fill='currentColor'>
        2
      </text>
      <text x='1.5' y='20.5' fontSize='7' fontWeight='700' stroke='none' fill='currentColor'>
        3
      </text>
    </svg>
  );
}
