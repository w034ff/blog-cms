// TableIcon's frame with only vertical dividers — the column counterpart of TableRowsIcon.
export function TableColumnsIcon() {
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
      <line x1='9' y1='4' x2='9' y2='20' />
      <line x1='15' y1='4' x2='15' y2='20' />
    </svg>
  );
}
