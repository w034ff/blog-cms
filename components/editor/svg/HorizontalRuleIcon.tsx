// Horizontal-rule glyph: a single divider line spanning the width — the mark the 区切り線
// button inserts (an <hr>). Inherits the button's color via currentColor.
export function HorizontalRuleIcon() {
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
      <line x1='4' y1='12' x2='20' y2='12' />
    </svg>
  );
}
