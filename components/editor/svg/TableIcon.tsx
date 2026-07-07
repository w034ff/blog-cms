// Grid glyph for the table-insert button: a framed box with a continuous header
// row across the top and a 2×2 body, in the same stroke style as the other icons.
export function TableIcon() {
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
      <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
      <line x1='3' y1='9' x2='21' y2='9' />
      <line x1='3' y1='15' x2='21' y2='15' />
      <line x1='12' y1='9' x2='12' y2='21' />
    </svg>
  );
}
