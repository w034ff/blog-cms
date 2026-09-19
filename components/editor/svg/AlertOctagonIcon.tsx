// Octagon-exclamation glyph for the 注意 (caution) callout tier — the stroke-icon-set
// equivalent of the filled Octicon `app/globals.css` draws for the published alert
// (`.markdown-alert-caution`'s `--alert-icon`); see AlertTriangleIcon for why this mirrors the
// published shape rather than reusing 情報's generic mark.
export function AlertOctagonIcon() {
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
      <polygon points='7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2' />
      <line x1='12' y1='8' x2='12' y2='12' />
      <line x1='12' y1='16' x2='12.01' y2='16' />
    </svg>
  );
}
