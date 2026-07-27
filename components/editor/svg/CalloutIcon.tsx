// Info-circle glyph for the callout (alert) insert menu — the same "note" mark the
// published callouts carry, so the toolbar entry reads as "insert an admonition".
// Inherits the button's color via currentColor.
export function CalloutIcon() {
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
      <circle cx='12' cy='12' r='9' />
      <line x1='12' y1='11' x2='12' y2='16' />
      <line x1='12' y1='8' x2='12.01' y2='8' />
    </svg>
  );
}
