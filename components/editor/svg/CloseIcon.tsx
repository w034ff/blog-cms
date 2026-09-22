// The × on a dialog's close button (CloseButton.tsx). Drawn rather than typed: the text glyph sits
// wherever the font puts it, which drifted off the centre of the round button once it grew to
// 36px. Stroke-first like the rest of the editor's icons.
export function CloseIcon() {
  return (
    <svg
      viewBox='0 0 24 24'
      className='block h-4 w-4'
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      aria-hidden='true'>
      <line x1='6' y1='6' x2='18' y2='18' />
      <line x1='18' y1='6' x2='6' y2='18' />
    </svg>
  );
}
