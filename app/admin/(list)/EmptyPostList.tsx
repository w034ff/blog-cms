import Link from 'next/link';
import type { ReactNode } from 'react';
import type { LibraryTab } from '@/lib/admin-post-list';
import { RECENT_VIEWS_LIMIT } from '@/lib/library';

// A list with no rows: the drawing on its disc, a heading, a line of supplement and the screen's
// only 新規作成 — the heading row drops its own (app/admin/(list)/page.tsx and scribbles/page.tsx) —
// so there is one way forward. Each phrase is an inline-block, so a narrow screen wraps between
// phrases (「ここか／ら」 otherwise); `word-break: auto-phrase` would do it in Chromium only.
// `newHref` is omitted on library tabs (docs/library-requirements.md §6.2), which have no creation flow.
function EmptyList({
  drawing,
  heading,
  supplement,
  newHref,
}: {
  drawing: ReactNode;
  heading: readonly string[];
  supplement: readonly string[];
  newHref?: string;
}) {
  return (
    <div className='flex flex-col items-center px-4 py-14 text-center'>
      <div className='empty-illustration flex h-46 w-46 items-center justify-center'>{drawing}</div>
      <h2 className='mt-6 text-lg font-semibold'>
        {heading.map((phrase) => (
          <span key={phrase} className='inline-block'>
            {phrase}
          </span>
        ))}
      </h2>
      <p className='mt-2 text-sm text-zinc-600 dark:text-zinc-400'>
        {supplement.map((phrase) => (
          <span key={phrase} className='inline-block'>
            {phrase}
          </span>
        ))}
      </p>
      {newHref && (
        <Link href={newHref} className='button-primary mt-6 px-5 py-2.5 font-medium'>
          新規作成
        </Link>
      )}
    </div>
  );
}

// 記事一覧 with no posts: the first screen an author who has just joined sees. The supplement names
// the two kinds of post (lib/content.ts CATEGORIES).
export function EmptyPostList() {
  return (
    <EmptyList
      drawing={<Typewriter />}
      heading={['あなたのアウトプットを、', 'ここから']}
      supplement={['試して確かめたこと、', '考えたことや振り返りを', '記事として残せます。']}
      newHref='/admin/posts/new'
    />
  );
}

// 走り書き with none: a note pad rather than the typewriter, since what it asks for is short and
// unfinished (docs/scribble-requirements.md §1).
export function EmptyScribbleList() {
  return (
    <EmptyList
      drawing={<NotePad />}
      heading={['小さな気づきを、', 'ここに']}
      supplement={['調べている途中のことや', '思いついたことを、', '短いメモのまま公開できます。']}
      newHref='/admin/posts/new?kind=scribble'
    />
  );
}

// Colours come from `.empty-illustration` (app/globals.css), fixed to the light palette.
function Typewriter() {
  return (
    <svg aria-hidden='true' width='176' height='128' viewBox='0 0 220 160'>
      {/* The sheet in the platen, a heading and lines typed, the caret after the last. */}
      <rect
        x='66'
        y='8'
        width='88'
        height='70'
        rx='2'
        fill='var(--ill-paper)'
        stroke='var(--ill-body)'
        strokeWidth='2'
      />
      <rect x='78' y='22' width='44' height='6' rx='2' fill='var(--ill-body)' />
      <rect x='78' y='36' width='62' height='4' rx='2' fill='var(--ill-tint)' />
      <rect x='78' y='46' width='56' height='4' rx='2' fill='var(--ill-tint)' />
      <rect x='78' y='56' width='30' height='4' rx='2' fill='var(--ill-tint)' />
      <rect x='110' y='55' width='2' height='7' fill='var(--ill-accent)' />
      {/* Platen with its knobs, and the return lever. */}
      <rect x='44' y='70' width='132' height='14' rx='7' fill='var(--ill-ink)' />
      <circle cx='40' cy='77' r='7' fill='var(--ill-body)' />
      <circle cx='180' cy='77' r='7' fill='var(--ill-body)' />
      <path d='M34 72 L18 62' stroke='var(--ill-accent)' strokeWidth='4' strokeLinecap='round' />
      <path d='M40 86 H180 L194 136 Q195 142 189 142 H31 Q25 142 26 136 Z' fill='var(--ill-body)' />
      <rect x='84' y='90' width='52' height='5' rx='2' fill='var(--ill-tint)' opacity='0.5' />
      {/* Two rows of keys, one in each category's colour, and the space bar. */}
      <g fill='var(--ill-paper)'>
        {[58, 72, 86, 100, 114, 128, 142, 156, 170].map((cx) => (
          <circle key={`a${cx}`} cx={cx} cy='106' r='4.5' />
        ))}
        {[52, 66, 80, 94, 108, 122, 136, 150, 164].map((cx) => (
          <circle key={`b${cx}`} cx={cx} cy='119' r='4.5' />
        ))}
      </g>
      <circle cx='58' cy='106' r='4.5' fill='var(--ill-blog)' />
      <circle cx='122' cy='119' r='4.5' fill='var(--ill-tech)' />
      <rect x='76' y='129' width='68' height='6' rx='3' fill='var(--ill-paper)' />
    </svg>
  );
}

// The same palette and frame as the typewriter, so the two empty screens read as one set.
function NotePad() {
  return (
    <svg aria-hidden='true' width='176' height='128' viewBox='0 0 220 160'>
      {/* A spiral-bound pad, its rings along the top edge. */}
      <rect
        x='56'
        y='16'
        width='104'
        height='128'
        rx='4'
        fill='var(--ill-paper)'
        stroke='var(--ill-body)'
        strokeWidth='2'
      />
      <g fill='none' stroke='var(--ill-ink)' strokeWidth='2'>
        {[70, 84, 98, 112, 126, 140].map((cx) => (
          <circle key={cx} cx={cx} cy='16' r='4' />
        ))}
      </g>
      {/* A hand-written title and three lines of scribble, the last cut short. */}
      <path
        d='M70 40 q5 -6 10 0 t10 0 t10 0 t10 0'
        fill='none'
        stroke='var(--ill-body)'
        strokeWidth='3'
        strokeLinecap='round'
      />
      <g fill='none' stroke='var(--ill-tint)' strokeWidth='3' strokeLinecap='round'>
        <path d='M70 62 q6 -4 12 0 t12 0 t12 0 t12 0 t12 0 t12 0' />
        <path d='M70 80 q6 -4 12 0 t12 0 t12 0 t12 0 t12 0' />
        <path d='M70 98 q6 -4 12 0 t12 0' />
      </g>
      <path
        d='M70 112 l6 6 l12 -14'
        fill='none'
        stroke='var(--ill-accent)'
        strokeWidth='3'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      {/* The pencil, laid across the pad's corner: lead, wood, body and eraser. */}
      <g transform='rotate(-38 160 112)'>
        <path
          d='M118 112 L130 106 L130 118 Z'
          fill='var(--ill-tint)'
          stroke='var(--ill-ink)'
          strokeWidth='1.5'
          strokeLinejoin='round'
        />
        <path d='M118 112 L123 109.5 L123 114.5 Z' fill='var(--ill-ink)' />
        <rect x='130' y='106' width='52' height='12' fill='var(--ill-tech)' />
        <rect x='182' y='106' width='6' height='12' fill='var(--ill-ink)' />
        <rect x='188' y='106' width='10' height='12' rx='3' fill='var(--ill-accent)' />
      </g>
    </svg>
  );
}

// An open book with a bookmark ribbon (docs/library-requirements.md §6.2).
function BookAndBookmark() {
  return (
    <svg aria-hidden='true' width='176' height='128' viewBox='0 0 220 160'>
      {/* Book cover base */}
      <path
        d='M30 126 C55 120, 95 119, 110 125 C125 119, 165 120, 190 126 L190 131 C165 125, 125 124, 110 130 C95 124, 55 125, 30 131 Z'
        fill='var(--ill-body)'
      />
      {/* Pages block */}
      <path
        d='M33 46 C55 40, 95 40, 110 46 C125 40, 165 40, 187 46 L187 122 C165 116, 125 116, 110 122 C95 116, 55 116, 33 122 Z'
        fill='var(--ill-paper)'
        stroke='var(--ill-body)'
        strokeWidth='2'
        strokeLinejoin='round'
      />
      {/* Spine / center divide */}
      <line x1='110' y1='46' x2='110' y2='122' stroke='var(--ill-ink)' strokeWidth='1.5' />
      {/* Left page text lines */}
      <rect x='45' y='58' width='48' height='4' rx='2' fill='var(--ill-tint)' />
      <rect x='45' y='70' width='52' height='4' rx='2' fill='var(--ill-tint)' />
      <rect x='45' y='82' width='44' height='4' rx='2' fill='var(--ill-tint)' />
      <rect x='45' y='94' width='36' height='4' rx='2' fill='var(--ill-tint)' />
      {/* Right page text lines */}
      <rect x='123' y='58' width='52' height='4' rx='2' fill='var(--ill-tint)' />
      <rect x='123' y='70' width='44' height='4' rx='2' fill='var(--ill-tint)' />
      <rect x='123' y='82' width='48' height='4' rx='2' fill='var(--ill-tint)' />
      <rect x='123' y='94' width='32' height='4' rx='2' fill='var(--ill-tint)' />
      {/* Bookmark ribbon (しおり) hanging down the right page past the bottom edge */}
      <path d='M140 38 L154 38 L154 136 L147 129 L140 136 Z' fill='var(--ill-accent)' />
      {/* Bookmark top fold over the head of the book */}
      <path
        d='M140 38 C140 32, 144 28, 147 28 C150 28, 154 32, 154 38 Z'
        fill='var(--ill-accent)'
        opacity='0.85'
      />
    </svg>
  );
}

// The sheet the いいね and 閲覧履歴 drawings share, centred in the frame, with a disc at its lower
// right for the mark. One sheet, so switching between the two tabs does not move or resize it.
function SheetWithBadge({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden='true' width='176' height='128' viewBox='0 0 220 160'>
      <rect
        x='54'
        y='16'
        width='112'
        height='128'
        rx='4'
        fill='var(--ill-paper)'
        stroke='var(--ill-body)'
        strokeWidth='2'
      />
      <rect x='68' y='32' width='56' height='6' rx='2' fill='var(--ill-body)' />
      <rect x='68' y='48' width='84' height='4' rx='2' fill='var(--ill-tint)' />
      <rect x='68' y='60' width='76' height='4' rx='2' fill='var(--ill-tint)' />
      <rect x='68' y='72' width='80' height='4' rx='2' fill='var(--ill-tint)' />
      <rect x='68' y='84' width='48' height='4' rx='2' fill='var(--ill-tint)' />
      <g transform='translate(152, 110)'>
        <circle r='25' fill='var(--ill-paper)' stroke='var(--ill-body)' strokeWidth='2' />
        {children}
      </g>
    </svg>
  );
}

// いいね: a heart on the disc (docs/library-requirements.md §6.2).
function PaperAndHeart() {
  return (
    <SheetWithBadge>
      <path
        d='M0 12 C-1.5 10.5, -12 1.5, -12 -5.5 A6.5 6.5 0 0 1 -1 -10.5 L0 -9.5 L1 -10.5 A6.5 6.5 0 0 1 12 -5.5 C12 1.5, 1.5 10.5, 0 12 Z'
        fill='var(--ill-accent)'
      />
    </SheetWithBadge>
  );
}

// 閲覧履歴: a clock face on the disc, ticks at the quarters.
function PaperAndClock() {
  return (
    <SheetWithBadge>
      <g stroke='var(--ill-tint)' strokeWidth='2' strokeLinecap='round'>
        <line x1='0' y1='-21' x2='0' y2='-17' />
        <line x1='21' y1='0' x2='17' y2='0' />
        <line x1='0' y1='21' x2='0' y2='17' />
        <line x1='-21' y1='0' x2='-17' y2='0' />
      </g>
      <line
        x1='0'
        y1='0'
        x2='0'
        y2='-13'
        stroke='var(--ill-ink)'
        strokeWidth='2.5'
        strokeLinecap='round'
      />
      <line
        x1='0'
        y1='0'
        x2='10'
        y2='4'
        stroke='var(--ill-accent)'
        strokeWidth='2'
        strokeLinecap='round'
      />
      <circle r='2.5' fill='var(--ill-ink)' />
    </SheetWithBadge>
  );
}

// Empty state for /admin/library bookmarks tab.
export function EmptyLibraryBookmarks() {
  return (
    <EmptyList
      drawing={<BookAndBookmark />}
      heading={['読み返したい記事を、', 'ここに']}
      supplement={['記事や走り書きのページでブックマークすると、', 'ここに集まります。']}
    />
  );
}

// Empty state for /admin/library likes tab.
export function EmptyLibraryLikes() {
  return (
    <EmptyList
      drawing={<PaperAndHeart />}
      heading={['心に残った記事を、', 'ここに']}
      supplement={['ほかの人の記事や走り書きにいいねすると、', 'あとからここで振り返れます。']}
    />
  );
}

// Empty state for /admin/library history tab.
export function EmptyLibraryHistory() {
  return (
    <EmptyList
      drawing={<PaperAndClock />}
      heading={['読んだ記事を、', 'もう一度']}
      supplement={[
        'ほかの人の記事や走り書きを開くと、',
        `新しい順に ${RECENT_VIEWS_LIMIT} 件まで残ります。`,
      ]}
    />
  );
}

// Empty states for /admin/library tabs (docs/library-requirements.md §6.2).
export function EmptyLibraryList({ tab }: { tab: LibraryTab }) {
  if (tab === 'likes') return <EmptyLibraryLikes />;
  if (tab === 'history') return <EmptyLibraryHistory />;
  return <EmptyLibraryBookmarks />;
}
