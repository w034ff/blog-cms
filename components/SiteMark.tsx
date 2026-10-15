import {
  MARK_GLYPH_PATH,
  MARK_SIZE,
  MARK_STROKE_WIDTH,
  MARK_TILE_RADIUS,
  MARK_VIEW_BOX,
} from '@/lib/site-mark';

// The site's mark in the page (lib/site-mark.ts). It reads the page's colour variables, so the
// dark scheme inverts it with everything else. Decorative: whatever carries it says the name.
export function SiteMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden='true' viewBox={MARK_VIEW_BOX} className={className}>
      <rect
        width={MARK_SIZE}
        height={MARK_SIZE}
        rx={MARK_TILE_RADIUS}
        className='fill-(--foreground)'
      />
      <path
        d={MARK_GLYPH_PATH}
        fill='none'
        strokeWidth={MARK_STROKE_WIDTH}
        strokeLinecap='round'
        className='stroke-(--surface)'
      />
    </svg>
  );
}
