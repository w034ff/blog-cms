'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CloseButton } from '@/components/editor/CloseButton';
import { EditorTooltip } from '@/components/editor/EditorTooltip';
import { HelpIcon } from '@/components/editor/svg/HelpIcon';
import { useBodyScrollLock } from '@/components/editor/useBodyScrollLock';

// タグの管理's 使い方 (docs/editor-requirements.md §12.33): the three ideas the rows cannot show —
// two names per tag, エイリアス and 統合 — each with a small example drawn in the page's own parts, so
// a change to the screen needs no retaken picture. The editor's ヘルプ (WritingHelpDialog) is the
// shape it follows: the same icon, sheet and entrance.

function Mono({ children }: { children: string }) {
  return (
    <code className='rounded-chip bg-zinc-100 px-1 font-mono text-xs dark:bg-zinc-800'>
      {children}
    </code>
  );
}

function Chip({ children }: { children: string }) {
  return <span className='tag-chip px-2.5 py-0.5 text-xs'>#{children}</span>;
}

function Note({ children }: { children: string }) {
  return <span className='text-xs text-(--accent)'>{children}</span>;
}

// One example row: the thing on the left, what it does on the right.
function Example({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <div className='mt-2 grid gap-2 rounded-box border border-zinc-200 bg-zinc-50 px-3.5 py-3 dark:border-zinc-800 dark:bg-zinc-950'>
      {rows.map(([thing, effect], i) => (
        <div key={i} className='grid grid-cols-[10rem_1fr] items-center gap-3 text-[13px]'>
          <div>{thing}</div>
          <div>{effect}</div>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className='text-xs font-bold text-zinc-500 dark:text-zinc-400'>{title}</h3>
      {children}
    </section>
  );
}

function TagHelpDialog({ onClose }: { onClose: () => void }) {
  const headingId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);

  useBodyScrollLock(true);

  // Focus in on open (a frame later, once laid out) and back to the opener on close.
  useEffect(() => {
    openerRef.current = document.activeElement;
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      const opener = openerRef.current;
      if (opener instanceof HTMLElement) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      // `writing-help-backdrop` / `-panel` carry the editor ヘルプ's entrance (app/globals.css).
      className='writing-help-backdrop fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 sm:p-8'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}>
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby={headingId}
        className='writing-help-panel flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-panel border border-zinc-300 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900'>
        <div className='flex items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-950'>
          <h2 id={headingId} className='text-base font-bold'>
            タグの管理の使い方
          </h2>
          <CloseButton ref={closeRef} onClick={onClose} />
        </div>
        <div className='space-y-5 overflow-y-auto px-4 py-4 text-sm leading-relaxed'>
          <Section title='識別子と表示名'>
            <p className='mt-1'>
              識別子はタグのページの URL に使う名前、表示名は記事やタグの一覧に出る名前です。
            </p>
            <Example
              rows={[
                [
                  <span key='s' className='font-semibold'>
                    nextjs
                  </span>,
                  <>
                    <Note>識別子</Note> → URL は <Mono>/tags/nextjs</Mono>
                  </>,
                ],
                [
                  'Next.js',
                  <>
                    <Note>表示名</Note> → 記事には <Chip>Next.js</Chip>
                  </>,
                ],
              ]}
            />
          </Section>
          <Section title='エイリアス'>
            <p className='mt-1'>
              同じタグを指す、別の識別子です。エディタで next を選ぶと Next.js が付きます。
            </p>
            <Example
              rows={[
                [
                  <Mono key='a'>next</Mono>,
                  <>
                    <Note>エイリアス</Note> → 選ぶと <Chip>Next.js</Chip>
                  </>,
                ],
              ]}
            />
          </Section>
          <Section title='統合'>
            <p className='mt-1'>
              識別子を既にあるタグの識別子に変えると、2 つのタグが 1
              つに統合されます。元の識別子はエイリアスとして残ります。
            </p>
            <Example
              rows={[
                [
                  <>
                    <Mono>golang</Mono> → <Mono>go</Mono>
                  </>,
                  <>
                    <Note>統合</Note> → <Mono>golang</Mono> の記事にも <Chip>Go</Chip>
                  </>,
                ],
              ]}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}

export function TagHelp() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type='button'
        aria-label='タグの管理の使い方'
        aria-haspopup='dialog'
        onClick={() => setOpen(true)}
        // `group/tt relative` hosts the tooltip, as the editor's ヘルプ does. Its word sits inside the
        // button's name, so what the pointer shows and what assistive tech reads agree.
        className='group/tt relative inline-flex items-center rounded-chip p-1 text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-800'>
        <HelpIcon />
        <EditorTooltip label='使い方' />
      </button>
      {open && <TagHelpDialog onClose={() => setOpen(false)} />}
    </>
  );
}
