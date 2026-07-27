// Chevron beside a menu-opening toolbar button, signalling that it opens a menu
// (the other buttons fire immediately). Rotates to point up while the menu is open.
export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox='0 0 24 24'
      className={`block h-3 w-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'>
      <path d='m6 9 6 6 6-6' />
    </svg>
  );
}
