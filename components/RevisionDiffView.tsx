import type { DiffBlock, RevisionDiff, Segment } from '@/lib/revision-diff';

// The revision preview's 差分 view (docs/revision-requirements.md §9): the markdown as stored, not
// as rendered — a rendered diff would have to mark up embeds and cards that carry no text to
// compare. Each changed stretch shows its before and after as two tinted blocks, with a − / + in
// the gutter so the two read apart without relying on colour — and, for a screen reader, which
// announces neither the gutter nor `<del>` / `<ins>`, a hidden 削除 / 追加 in its place. Monospace,
// since this is source: a fence's indentation and a table's pipes only line up in it.

function Segments({ segments }: { segments: Segment[] }) {
  return segments.map((segment, index) =>
    segment.kind === 'removed' ? (
      <del key={index} className='rounded-sm bg-red-200 line-through dark:bg-red-900/60'>
        {segment.text}
      </del>
    ) : segment.kind === 'added' ? (
      <ins key={index} className='rounded-sm bg-emerald-200 no-underline dark:bg-emerald-900/60'>
        {segment.text}
      </ins>
    ) : (
      <span key={index}>{segment.text}</span>
    ),
  );
}

// The ground of each side, shared with the legend so the two cannot drift apart.
const SIDE_TINT = {
  '−': 'bg-red-50 dark:bg-red-950/40',
  '+': 'bg-emerald-50 dark:bg-emerald-950/40',
} as const;

function Side({ sign, segments }: { sign: '−' | '+'; segments: Segment[] }) {
  if (segments.length === 0) return null;
  return (
    <div className={`flex gap-2 px-3 py-1 ${SIDE_TINT[sign]}`}>
      <span aria-hidden='true' className='w-3 shrink-0 select-none text-zinc-400'>
        {sign}
      </span>
      <span className='sr-only'>{sign === '−' ? '削除:' : '追加:'}</span>
      <div className='min-w-0 flex-1'>
        <Segments segments={segments} />
      </div>
    </div>
  );
}

function Context({ lines }: { lines: string[] }) {
  return (
    <div className='flex gap-2 px-3 py-1 text-zinc-500 dark:text-zinc-400'>
      <span aria-hidden='true' className='w-3 shrink-0' />
      <div className='min-w-0 flex-1'>{lines.join('\n')}</div>
    </div>
  );
}

function Block({ block }: { block: DiffBlock }) {
  switch (block.kind) {
    case 'context':
      return <Context lines={block.lines} />;
    case 'collapsed':
      // A native disclosure: opens without script, and the page stays a server component.
      return (
        <details className='group border-y border-dashed border-zinc-200 open:border-transparent dark:border-zinc-800 dark:open:border-transparent'>
          <summary className='cursor-pointer list-none px-3 py-1 text-center font-sans text-xs text-zinc-400 hover:bg-zinc-50 group-open:hidden dark:hover:bg-zinc-900 [&::-webkit-details-marker]:hidden'>
            {block.lines.length} 行省略
          </summary>
          <Context lines={block.lines} />
        </details>
      );
    case 'change':
      return (
        <div>
          <Side sign='−' segments={block.before} />
          <Side sign='+' segments={block.after} />
        </div>
      );
  }
}

// Runs from what the editor holds now to what the preview's button would leave there, on both
// kinds of preview: one direction, so red always means "goes away if pressed".
// The sentence says what the diff is, and the legend what its colours mean — in words that fit
// both restoring and discarding, so the page is read without remembering which way it runs.
export function RevisionDiffView({
  diff,
  lead,
  unchanged,
}: {
  diff: RevisionDiff;
  lead: string;
  unchanged: string;
}) {
  if (diff.identical)
    return <p className='text-sm text-zinc-500 dark:text-zinc-400'>{unchanged}</p>;
  return (
    <div className='space-y-4 text-sm'>
      <div className='space-y-1'>
        <p>{lead}</p>
        <p className='flex gap-3 text-xs text-zinc-600 dark:text-zinc-400'>
          <span className={`rounded-sm px-1.5 ${SIDE_TINT['−']}`}>− 消える</span>
          <span className={`rounded-sm px-1.5 ${SIDE_TINT['+']}`}>+ 戻る</span>
        </p>
      </div>
      {diff.fields.length > 0 && (
        <dl className='space-y-1'>
          {diff.fields.map((field) => (
            <div key={field.label} className='flex flex-wrap items-baseline gap-x-2'>
              <dt className='text-xs text-zinc-500 dark:text-zinc-400'>{field.label}</dt>
              <dd className='min-w-0 break-words'>
                <del className='rounded-sm bg-red-200 line-through dark:bg-red-900/60'>
                  {field.before || '（なし）'}
                </del>
                {' → '}
                <ins className='rounded-sm bg-emerald-200 no-underline dark:bg-emerald-900/60'>
                  {field.after || '（なし）'}
                </ins>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {diff.body.length > 0 && (
        // The markdown's own line breaks are the layout; long lines wrap rather than scroll.
        <div className='overflow-hidden rounded border border-zinc-200 font-mono leading-relaxed whitespace-pre-wrap break-words dark:border-zinc-800'>
          {diff.body.map((block, index) => (
            <Block key={index} block={block} />
          ))}
        </div>
      )}
    </div>
  );
}
