// The X monogram, for the bubble's 「埋め込みにする」 button when the link is a post
// (docs/embed-requirements.md §7.3). The one icon in this set that is a brand mark rather than a
// drawn shape, and the one that carries no frame: `PlayIcon` and `CardIcon` both show the block
// their button produces, but at 16px the frame leaves about 5 rendered pixels for what sits inside
// it, which is not enough for a letterform. The mark names the provider instead.
//
// Filled rather than stroked — `fill='currentColor'` with `stroke='none'`, the opposite of every
// other icon here. Under this directory's usual attributes (`fill='none'`, `strokeWidth={2}`) the
// path would be drawn as a hollow outline of the letter, which at this size is a blot.
export function XPostIcon() {
  return (
    <svg
      viewBox='0 0 24 24'
      className='block h-4 w-4'
      fill='currentColor'
      stroke='none'
      aria-hidden='true'>
      <path d='M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z' />
    </svg>
  );
}
