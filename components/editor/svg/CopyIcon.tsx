// Two overlapping sheets — the platform-standard "copy" mark, drawn in the same thin-stroke style
// as the toolbar icons. The back sheet is clipped to an L rather than drawn as a full rect, so the
// two shapes stay legible at 16px instead of collapsing into a grid of parallel lines.
export function CopyIcon() {
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
      <rect x='9' y='9' width='12' height='12' rx='2' ry='2' />
      <path d='M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1' />
    </svg>
  );
}
