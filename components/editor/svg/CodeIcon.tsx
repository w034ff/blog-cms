// Inline-code glyph: a pair of angle brackets — the near-universal "code" mark, in the
// same stroke style as the other toolbar icons. Inherits the button's color via currentColor.
export function CodeIcon() {
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
      <polyline points='16 18 22 12 16 6' />
      <polyline points='8 6 2 12 8 18' />
    </svg>
  );
}
