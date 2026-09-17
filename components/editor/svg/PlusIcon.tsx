// The ＋ that opens the insert menu on a phone (InsertMenu.tsx). Two crossed strokes and nothing
// else: the trigger stands alone in the page header, beside text controls, so the glyph has to
// read as "add" without a label at 16px. Stroke-first like the rest of the row, so it takes the
// same weight as 記事の設定's neighbours rather than sitting heavier as a filled shape would.
export function PlusIcon() {
  return (
    <svg
      viewBox='0 0 24 24'
      className='block h-4 w-4'
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      aria-hidden='true'>
      <line x1='12' y1='5' x2='12' y2='19' />
      <line x1='5' y1='12' x2='19' y2='12' />
    </svg>
  );
}
