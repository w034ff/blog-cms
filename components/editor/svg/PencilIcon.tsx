// Pencil on a diagonal — "edit". Same thin-stroke style as the other toolbar icons. The nib is a
// separate short stroke so the tip still reads as a point at 16px, where the two body strokes are
// only about two pixels apart.
export function PencilIcon() {
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
      <path d='M4 20h4L20 8a2.83 2.83 0 0 0-4-4L4 16v4z' />
      <line x1='14.5' y1='5.5' x2='18.5' y2='9.5' />
    </svg>
  );
}
