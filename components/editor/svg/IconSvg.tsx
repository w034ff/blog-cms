import type { IconShape } from './icon-shapes';

// Renders a shape list from icon-shapes.ts. The wrapper exists so the geometry can be shared with
// the link card's NodeView (which builds DOM, not JSX) without either side restating it; the
// attributes here and in `buildIcon` are the same set on purpose.
export function IconSvg({ shapes }: { shapes: readonly IconShape[] }) {
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
      {shapes.map((shape, i) =>
        shape.kind === 'path' ? (
          <path
            key={i}
            d={shape.d}
            {...(shape.filled ? { fill: 'currentColor', stroke: 'none' } : {})}
          />
        ) : shape.kind === 'rect' ? (
          <rect
            key={i}
            x={shape.x}
            y={shape.y}
            width={shape.width}
            height={shape.height}
            rx={shape.rx}
          />
        ) : (
          <line key={i} x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} />
        ),
      )}
    </svg>
  );
}
