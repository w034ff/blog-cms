import Link from 'next/link';

// 記事一覧 with no posts: the first screen an author who has just joined sees. It carries the
// screen's only 新規作成 — the heading row drops its own (app/admin/(list)/page.tsx) — so there is
// one way forward. The supplement names the two kinds of post (lib/content.ts CATEGORIES).
export function EmptyPostList() {
  return (
    <div className='flex flex-col items-center px-4 py-14 text-center'>
      <div className='empty-illustration flex h-46 w-46 items-center justify-center'>
        <Typewriter />
      </div>
      {/* Each phrase is an inline-block, so a narrow screen wraps between phrases (「ここか／ら」
          otherwise); `word-break: auto-phrase` would do it in Chromium only. */}
      <h2 className='mt-6 text-lg font-semibold'>
        <span className='inline-block'>あなたのアウトプットを、</span>
        <span className='inline-block'>ここから</span>
      </h2>
      <p className='mt-2 text-sm text-zinc-600 dark:text-zinc-400'>
        <span className='inline-block'>試して確かめたこと、</span>
        <span className='inline-block'>考えたことや振り返りを</span>
        <span className='inline-block'>記事として残せます。</span>
      </p>
      <Link href='/admin/posts/new' className='button-primary mt-6 px-5 py-2.5 font-medium'>
        新規作成
      </Link>
    </div>
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
