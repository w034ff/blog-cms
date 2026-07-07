// Center-align glyph for the table column-alignment button: four horizontal rules,
// the middle two shortened and centered, in the same stroke style as the other
// toolbar icons.
export function AlignCenterIcon() {
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
      <line x1='3' y1='6' x2='21' y2='6' />
      <line x1='6' y1='10' x2='18' y2='10' />
      <line x1='3' y1='14' x2='21' y2='14' />
      <line x1='6' y1='18' x2='18' y2='18' />
    </svg>
  );
}
