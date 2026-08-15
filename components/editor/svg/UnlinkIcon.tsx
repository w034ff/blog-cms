// A horizontal chain with a slash across it — "remove the link". Same thin-stroke style as the
// other toolbar icons.
//
// The two shapes both carry the message and they have to be drawn so as not to fight each other at
// 16px. The chain is horizontal: a diagonal break was tried first and, in the destructive red, read
// as a question mark (measured, both schemes) — the halves have to sit on a level baseline to be
// recognised as a chain at all. The arcs and the connecting bar are then trimmed short of the
// slash's path rather than run under it, so the crossing stays two strokes wide instead of four.
export function UnlinkIcon() {
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
      <path d='M9 17H7A5 5 0 0 1 7 7' />
      <path d='M15 7h2a5 5 0 0 1 4 8' />
      <line x1='8' y1='12' x2='12' y2='12' />
      <line x1='2' y1='2' x2='22' y2='22' />
    </svg>
  );
}
