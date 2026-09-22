// Angle brackets, the generic "code" glyph — the row's own label says "block"; nothing here
// distinguishes it from inline code, the same labelled-not-literal division 脚注/アコーディオン's
// icons use.
export function CodeBlockIcon() {
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
      <polyline points='9 8 5 12 9 16' />
      <polyline points='15 8 19 12 15 16' />
    </svg>
  );
}
