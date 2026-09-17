// The way out of the editor on a phone, where 記事一覧 is drawn as this arrow instead of as its
// own words (docs/table-requirements.md §12.6). A shaft with a head and nothing else — at 16px in
// the top-left corner of a writing screen, that shape is read as "back" without a label, which is
// the whole reason the words can come off. Stroke-first, so it takes the same weight as the
// controls at the other end of the bar.
export function ArrowLeftIcon() {
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
      <line x1='19' y1='12' x2='5' y2='12' />
      <polyline points='12 19 5 12 12 5' />
    </svg>
  );
}
