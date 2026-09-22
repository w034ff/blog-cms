// Triangle-exclamation glyph for the 警告 (warning) callout tier — the stroke-icon-set
// equivalent of the filled Octicon `app/globals.css` draws for the published alert
// (`.markdown-alert-warning`'s `--alert-icon`), so the drilled-in picker reads with the same
// per-tier shape the reader ends up seeing, not just the same 囲み枠 mark for all three.
export function AlertTriangleIcon() {
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
      <path d='M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' />
      <line x1='12' y1='9' x2='12' y2='13' />
      <line x1='12' y1='17' x2='12.01' y2='17' />
    </svg>
  );
}
