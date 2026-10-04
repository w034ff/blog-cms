// Two lines of text in a card, the second cut short: a TL;DR is a sentence or two
// (docs/summary-requirements.md), in the stroke style of the drawer's other icons.
export function TldrIcon() {
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
      <line x1='7' y1='10' x2='17' y2='10' />
      <line x1='7' y1='14' x2='13' y2='14' />
    </svg>
  );
}
