// A framed block with two text lines and a picture beside them — the link card as it is drawn on
// the published page (lib/rehype-link-card.ts), so the bubble's button shows what pressing it
// produces rather than naming it. Inherits the button's color via currentColor.
export function CardIcon() {
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
      <rect x='3' y='5' width='18' height='14' rx='2' />
      <line x1='6.5' y1='10' x2='12' y2='10' />
      <line x1='6.5' y1='14' x2='10' y2='14' />
      <rect x='14.5' y='9' width='4' height='6' rx='1' />
    </svg>
  );
}
