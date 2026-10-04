// Redo: UndoIcon mirrored. Kept as its own file rather than a `scale(-1 1)` wrapper around that
// one, because a mirrored stroke also mirrors the line caps and the two would stop matching at
// 16px — the geometry is short enough to state twice.
export function RedoIcon() {
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
      <path d='m15 14 5-5-5-5' />
      <path d='M20 9H9.5a5.5 5.5 0 0 0 0 11H13' />
    </svg>
  );
}
