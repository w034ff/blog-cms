import type { ReactElement } from 'react';

// One glyph per provider, next to the name in `EmbedInsertDialog`'s table (docs/embed-requirements.md
// §24.4). Four vector marks carry their own brand colour, fixed in both themes — YouTube red,
// SlideShare blue, Speaker Deck teal and Figma's own four hues (`#24CB71`/`#FF7237`/`#00B6FF`/
// `#FF3737`/`#874FFF`, from the provider's own full-colour asset, not the single flattened outline
// Simple Icons ships). **X, GitHub, CodeSandbox and CodePen are the opposite problem**: their brand
// mark really is near-black, so `fill='currentColor'` with `text-black dark:text-white` inverts it
// rather than rendering true black on a dark row and disappearing. `aria-hidden`: the provider name
// text beside it is already the row's accessible name, so a `<title>` here would have a screen
// reader announce it twice.
//
// **Docswell is the one row with no logo at all** (§24.4, reversed 2026-09-03) — their terms
// require asking permission before using the mark on an external site, which this repo has not
// done. Its glyph is a generic slide pictogram rather than a monogram or a stand-in *for* their
// mark: it borrows no colour, shape or detail from it, the way the hand-drawn mockups earlier in
// this feature's history did before being set aside for looking like a real logo. It shares the
// black/white treatment above for the unrelated reason of matching the other eight rows' weight —
// a muted grey was tried first and was the only faint icon among nine bold ones.
const ICONS: Record<string, ReactElement> = {
  // Two paths, not Simple Icons' one: their single path draws the play triangle as a hole (opposite
  // winding), which shows whatever is *behind* the icon rather than a fixed colour — invisible on
  // light rows, black on dark ones (reported 2026-09-03). A second path painted white on top fixes
  // the triangle to white regardless of theme, matching the actual badge-plus-play-button mark.
  YouTube: (
    <svg className='h-4 w-4 flex-none' viewBox='0 0 24 24' aria-hidden='true'>
      <path
        d='M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z'
        fill='#FF0000'
      />
      <path d='M9.545 15.568V8.432L15.818 12l-6.273 3.568z' fill='#fff' />
    </svg>
  ),
  X: (
    <svg
      className='h-4 w-4 flex-none text-black dark:text-white'
      viewBox='0 0 24 24'
      fill='currentColor'
      aria-hidden='true'>
      <path d='M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z' />
    </svg>
  ),
  SlideShare: (
    <svg className='h-4 w-4 flex-none' viewBox='0 0 24 24' fill='#008ED2' aria-hidden='true'>
      <path d='M3.222.21C1.762.21 1.06 1.337 1.06 2.497v7.883c-.53-.502-1.096-.15-1.058.295.038.439.59 1.546 1.436 2.517.843.968 1.924 1.776 2.94 2.268a11.19 11.19 0 00-.491 3.598c.09 1.096.378 1.95.903 2.75.918 1.407 2.32 1.985 3.674 1.985 1.209 0 2.494-.563 2.698-2.373v-4.694c1.308.552 3.47.363 4.47-.39.19-.14.326-.207.416-.113.095.09.106.166-.113.439a5.6 5.6 0 01-3.103 1.965l.008 2.72a2.532 2.532 0 002.543 2.446c1.64.015 2.48-.556 3.148-1.164.632-.567 1.399-1.754 1.558-3.243a10.128 10.128 0 00-.454-3.926 10.358 10.358 0 002.948-2.268C23.213 12.5 24 11.185 24 10.675c0-.51-.556-.782-1.036-.302V2.497c0-.824-.48-2.29-2.135-2.29zm.423 1.35H20.41c.756 0 1.17.28 1.17 1.224v8.904a8.73 8.73 0 01-3.555 1.534c-1.606.352-2.94.087-3.666.148-.718.06-1.428.529-1.296 1.79-.491-.154-1.236-.683-1.682-1.117-.438-.428-.87-.711-1.534-.692-1.013.03-1.663.102-2.57.01a9.656 9.656 0 01-4.838-1.786V2.78c0-.87.378-1.22 1.206-1.22zm4.497 4.988a2.994 2.994 0 100 5.987 2.993 2.993 0 000-5.983zm7.71 0a2.994 2.994 0 100 5.987 2.993 2.993 0 000-5.983z' />
    </svg>
  ),
  // Cropped to the mark's own bounding box (x 312–712, y 340–940 of the source's 1024×1280
  // canvas) rather than the full canvas, which is mostly empty space around it.
  Figma: (
    <svg className='h-4 w-4 flex-none' viewBox='312 340 400 600' aria-hidden='true'>
      <path
        d='M312 840C312 784.772 356.772 740 412 740H512V840C512 895.228 467.228 940 412 940C356.772 940 312 895.228 312 840Z'
        fill='#24CB71'
      />
      <path
        d='M512 340V540H612C667.228 540 712 495.228 712 440C712 384.772 667.228 340 612 340H512Z'
        fill='#FF7237'
      />
      <circle cx='611.167' cy='640' r='100' fill='#00B6FF' />
      <path
        d='M312 440C312 495.228 356.772 540 412 540H512V340H412C356.772 340 312 384.772 312 440Z'
        fill='#FF3737'
      />
      <path
        d='M312 640C312 695.228 356.772 740 412 740H512V540H412C356.772 540 312 584.772 312 640Z'
        fill='#874FFF'
      />
    </svg>
  ),
  // A generic slide pictogram, not a monogram — its kind is already 「スライド」, so a frame with
  // two content lines says the same thing a letter would without inventing an initial for it.
  // Same `text-black dark:text-white` as the other four monochrome marks, not because black is
  // Docswell's colour (it is not one at all), but because a muted grey was the only faint icon
  // among nine bold ones and read as its own kind of outlier (reported 2026-09-03).
  Docswell: (
    <svg
      className='h-4 w-4 flex-none text-black dark:text-white'
      viewBox='0 0 24 24'
      fill='none'
      aria-hidden='true'>
      <rect x='3' y='5' width='18' height='14' rx='2' stroke='currentColor' strokeWidth='1.8' />
      <path d='M7 10h8M7 14h5' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' />
    </svg>
  ),
  'Speaker Deck': (
    <svg className='h-4 w-4 flex-none' viewBox='0 0 24 24' fill='#009287' aria-hidden='true'>
      <path d='M10.025 13.875H4.687a4.688 4.688 0 0 1 0-9.375h6.227a1.875 1.875 0 0 1 0 3.75H4.592a.937.937 0 1 0 0 1.875h5.337a4.687 4.687 0 1 1 0 9.375H1.875a1.875 1.875 0 0 1 0-3.75h8.15a.938.938 0 0 0 0-1.875zM13.97 19.5a5.635 5.635 0 0 0 2.396-3.75h3.026a.93.93 0 0 0 .921-.938V9.189a.93.93 0 0 0-.921-.938h-5.497c.438-.498.704-1.155.704-1.875s-.266-1.377-.704-1.875h6.418C22.35 4.5 24 6.179 24 8.25v7.5c0 2.071-1.65 3.75-3.687 3.75H13.97z' />
    </svg>
  ),
  'GitHub Gist': (
    <svg
      className='h-4 w-4 flex-none text-black dark:text-white'
      viewBox='0 0 24 24'
      fill='currentColor'
      aria-hidden='true'>
      <path d='M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12' />
    </svg>
  ),
  CodeSandbox: (
    <svg
      className='h-4 w-4 flex-none text-black dark:text-white'
      viewBox='0 0 24 24'
      fill='currentColor'
      aria-hidden='true'>
      <path d='M0 24H24V0H0V2.45455H21.5455V21.5455H2.45455V0H0Z' />
    </svg>
  ),
  CodePen: (
    <svg
      className='h-4 w-4 flex-none text-black dark:text-white'
      viewBox='0 0 640 640'
      fill='currentColor'
      aria-hidden='true'>
      <path d='M566.3 223.7L332.3 67.7C324.3 62.8 315.8 62.7 307.7 67.7L73.7 223.7C67.7 227.7 64 234.8 64 242L64 398C64 405.1 67.7 412.3 73.7 416.3L307.7 572.3C315.7 577.2 324.2 577.3 332.3 572.3L566.3 416.3C572.3 412.3 576 405.2 576 398L576 242C576 234.9 572.3 227.7 566.3 223.7zM342 127.1L514.3 242L437.4 293.4L342 229.7L342 127.1zM298 127.1L298 229.7L202.6 293.4L125.7 242L298 127.1zM108 283.1L163.1 320L108 356.8L108 283.1zM298 512.8L125.7 398L202.6 346.6L298 410.3L298 512.8zM320 372L242.3 320L320 268L397.7 320L320 372zM342 512.9L342 410.3L437.4 346.6L514.3 398L342 512.9zM532 356.9L476.9 320L532 283.1L532 356.8z' />
    </svg>
  ),
};

export function EmbedProviderIcon({ name }: { name: string }) {
  return ICONS[name] ?? null;
}
