import type { DiffBlock, RevisionDiff, Segment } from '@/lib/revision-diff';

// The revision preview's 差分 view (docs/revision-requirements.md §9): the markdown as stored, not
// as rendered — a rendered diff would have to mark up embeds and cards that carry no text to
// compare. Each changed stretch shows its before and after as two tinted blocks, with a − / + in
// the gutter so the two read apart without relying on colour.

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

function Side({ sign, segments }: { sign: '−' | '+'; segments: Segment[] }) {
  if (segments.length === 0) return null;
  const tint =
    sign === '−' ? 'bg-red-50 dark:bg-red-950/40' : 'bg-emerald-50 dark:bg-emerald-950/40';
  return (
    <div className={`flex gap-2 px-3 py-1 ${tint}`}>
      <span aria-hidden='true' className='w-3 shrink-0 select-none text-zinc-400'>
        {sign}
      </span>
      <div className='min-w-0 flex-1'>
        <Segments segments={segments} />
      </div>
    </div>
  );
}

function Block({ block }: { block: DiffBlock }) {
  switch (block.kind) {
    case 'context':
      return (
        <div className='flex gap-2 px-3 py-1 text-zinc-500 dark:text-zinc-400'>
          <span aria-hidden='true' className='w-3 shrink-0' />
          <div className='min-w-0 flex-1'>{block.lines.join('\n')}</div>
        </div>
      );
    case 'collapsed':
      return (
        <div className='border-y border-dashed border-zinc-200 px-3 py-1 text-center text-xs text-zinc-400 dark:border-zinc-800'>
          {block.count} 行省略
        </div>
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

export function RevisionDiffView({ diff }: { diff: RevisionDiff }) {
  return (
    <div className='space-y-4 text-sm'>
      <p className='text-xs text-zinc-500 dark:text-zinc-400'>このリビジョン → 今の内容</p>
      {diff.identical && <p className='text-zinc-500 dark:text-zinc-400'>今の内容と同じです。</p>}
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
        <div className='overflow-hidden rounded border border-zinc-200 leading-relaxed whitespace-pre-wrap break-words dark:border-zinc-800'>
          {diff.body.map((block, index) => (
            <Block key={index} block={block} />
          ))}
        </div>
      )}
    </div>
  );
}
