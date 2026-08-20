// A framed block with a play triangle in it — the embed as it is drawn on the published page
// (lib/rehype-embed.ts), so the bubble's button shows what pressing it produces rather than naming
// it. The sibling of CardIcon, and deliberately the same frame: the two buttons occupy the same
// slot and differ only in what fills the frame. Inherits the button's color via currentColor.
export function PlayIcon() {
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
      <rect x='3' y='5' width='18' height='14' rx='2' />
      <path d='M10.5 9.5l4.5 2.5-4.5 2.5z' fill='currentColor' />
    </svg>
  );
}
