// The heart and bookmark of the library (docs/library-requirements.md §5, §6.2), one drawing for
// every surface: the post page's buttons, the library's rows and the admin lists' like counts.
// Filled when the mark is on; outlined otherwise.

type IconProps = { filled: boolean; className?: string };

const DEFAULT_CLASS = 'h-4 w-4 shrink-0';

function Icon({ filled, className = DEFAULT_CLASS, d }: IconProps & { d: string }) {
  return (
    <svg
      aria-hidden='true'
      viewBox='0 0 24 24'
      className={className}
      fill={filled ? 'currentColor' : 'none'}
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'>
      <path d={d} />
    </svg>
  );
}

export function HeartIcon(props: IconProps) {
  return (
    <Icon
      {...props}
      d='M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'
    />
  );
}

export function BookmarkIcon(props: IconProps) {
  return <Icon {...props} d='m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z' />;
}
