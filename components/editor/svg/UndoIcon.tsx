// Undo: an arrow that leaves to the left and curves back under itself. The pair with RedoIcon is
// drawn as one shape mirrored, so the two read as a set at 16px — the arrowhead is what tells them
// apart, and it sits on the outside of each curve where the row's other stroke icons put theirs.
export function UndoIcon() {
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
      <path d='M9 14 4 9l5-5' />
      <path d='M4 9h10.5a5.5 5.5 0 0 1 0 11H11' />
    </svg>
  );
}
