// A clock with a turning-back arrow: the way to リビジョン履歴 from a revision's preview banner
// (docs/revision-requirements.md §5).
export function HistoryIcon() {
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
      <path d='M3 12a9 9 0 1 0 3-6.7L3 8' />
      <path d='M3 3v5h5' />
      <path d='M12 7v5l3 2' />
    </svg>
  );
}
