// "This one": the mark on a リビジョン履歴 row whose content is what the editor holds now
// (docs/revision-requirements.md §5).
export function CheckIcon() {
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
      <path d='M20 6 9 17l-5-5' />
    </svg>
  );
}
