// A padlock: body + shackle, same 24px viewBox / 16px render / stroke-2 convention as the toolbar
// set (UndoIcon.tsx). Stands in for 限定公開 in the header (PostEditor.tsx) where there isn't
// room for the word.
export function LockIcon() {
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
      <rect x='5' y='11' width='14' height='10' rx='2' />
      <path d='M8 11V7a4 4 0 0 1 8 0v4' />
    </svg>
  );
}
