// Bulleted-list glyph: three dots stacked at the left with a bar beside each —
// the platform-standard "list" mark. Inherits the button's color via currentColor.
export function ListIcon() {
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
      <line x1='8' y1='6' x2='21' y2='6' />
      <line x1='8' y1='12' x2='21' y2='12' />
      <line x1='8' y1='18' x2='21' y2='18' />
      <line x1='3' y1='6' x2='3.01' y2='6' />
      <line x1='3' y1='12' x2='3.01' y2='12' />
      <line x1='3' y1='18' x2='3.01' y2='18' />
    </svg>
  );
}
