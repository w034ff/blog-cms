// A card with a title rule and two columns below it: the まとめ block's 総評 over its two lists
// (docs/summary-requirements.md), in the stroke style of the drawer's other icons.
export function SummaryIcon() {
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
      <line x1='7' y1='9' x2='17' y2='9' />
      <line x1='12' y1='13' x2='12' y2='17' />
    </svg>
  );
}
