// "Goes somewhere else": the trailing mark on a row that navigates (記事の設定's 履歴,
// docs/editor-requirements.md §12.31). Not ChevronIcon rotated — that one says "opens a menu here"
// and turns over while the menu is open, which a row that leaves the screen never does.
export function ChevronRightIcon() {
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
      <path d='m9 6 6 6-6 6' />
    </svg>
  );
}
