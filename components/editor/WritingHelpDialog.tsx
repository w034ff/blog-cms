'use client';

import { Fragment, useEffect, useId, useRef, type ReactNode } from 'react';
import { isMac, shortcutParts } from './ToolbarButton';
import { SHORTCUT_CATALOG } from './shortcut-catalog';
import { useBodyScrollLock } from './useBodyScrollLock';
import { CloseButton } from './CloseButton';

// 「ヘルプ」 — the editor's one reference sheet: the markdown input rules, the slash menu, and the
// keyboard shortcuts (docs/cms-features.md「書き方ヘルプ」§4).
//
// **Ordered by how hard each part is to find:** input rules have no other surface and come first;
// shortcuts already show in tooltips and come last.
//
// It takes no `editor`, so the header can offer it even when the editor failed to mount. Rendered
// only while open, so the `navigator` read below never runs during SSR.

function Key({ children }: { children: string }) {
  return (
    <kbd className='whitespace-nowrap rounded-chip border border-zinc-300 bg-zinc-50 px-1 font-mono text-[11px] text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'>
      {children}
    </kbd>
  );
}

// **A cap is what the platform writes as a key:** one `<kbd>` per key with `+` outside them, but
// one cap for a Mac run like ⌘⇧S, which Apple writes without separators. `formatShortcut`'s joiner
// decides it.
function Shortcut({ token, mac }: { token: string; mac: boolean }) {
  const parts = shortcutParts(token, mac);
  if (mac) return <Key>{parts.join('')}</Key>;
  return (
    <span className='flex items-center gap-1'>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <span className='text-zinc-400 dark:text-zinc-500'>+</span>}
          <Key>{part}</Key>
        </Fragment>
      ))}
    </span>
  );
}

function Type({ children }: { children: string }) {
  return (
    <code // `whitespace-nowrap`: a wrapped `---` reads as two triggers.
      className='whitespace-nowrap rounded-chip bg-zinc-100 px-1 font-mono text-[12px] dark:bg-zinc-800'>
      {children}
    </code>
  );
}

// **Hand-maintained by decision** (acceptance criterion 3h): the rules' depth guards inside
// `addInputRules` have no two-column projection. The rules are measured in e2e; this table's only
// risk is staleness.
const SYNTAX: readonly { trigger: ReactNode; result: string }[] = [
  {
    trigger: (
      <>
        <Type>{'## '}</Type> / <Type>{'### '}</Type>
      </>
    ),
    // 「2 階層のみ」は閉じた集合の宣言。`## ` と `### ` を並べるだけでは代表例とも読め、`# ` を
    // 打って何も起きない読者に答えを渡せない。
    result: '大見出し / 小見出し（見出しは 2 階層のみ）',
  },
  {
    trigger: (
      <>
        <Type>{'- '}</Type> / <Type>{'1. '}</Type>
      </>
    ),
    result: '箇条書き / 番号付き',
  },
  { trigger: <Type>{'> '}</Type>, result: '引用' },
  {
    // **Only the `:::` vocabulary is listed:** `> [!NOTE]` adds no capability, and the two disagree
    // on one word (`:::warning` is 注意, `[!WARNING]` is 警告).
    trigger: (
      <>
        <Type>{':::info '}</Type> / <Type>{':::warning '}</Type> / <Type>{':::danger '}</Type>
      </>
    ),
    result: '囲み枠（情報 / 注意 / 警告）',
  },
  { trigger: <Type>{':::details '}</Type>, result: 'アコーディオン' },
  {
    trigger: (
      <>
        <Type>```</Type> / <Type>```ts</Type> / <Type>```ts:file.ts</Type>
      </>
    ),
    result: 'コードブロック',
  },
  // インラインの記法は載せない。4 つとも下の節に鍵があり、足す能力が無い。区切り線だけは `---` が
  // 唯一の作り方なので残す。
  { trigger: <Type>---</Type>, result: '区切り線' },
  { trigger: <Type>{'[text](url)'}</Type>, result: 'リンク' },
  { trigger: <Type>{'[^'}</Type>, result: '脚注' },
];

export function WritingHelpDialog({ onClose }: { onClose: () => void }) {
  const headingId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);
  const mac = isMac();

  useBodyScrollLock(true);

  // Focus in on open (a frame later, once laid out) and back to the opener on close. **Never to the
  // editor:** this sheet inserts nothing, and `view.dom.focus()` would scroll the caret under the
  // sticky header.
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
      if (event.key !== 'Escape') return;
      // Stopped, or the editor's Escape also dismisses whatever is open behind this sheet.
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      // `z-[55]` for InsertDialog's own reason: the ＋ sheet portals to document.body at `z-50`, and
      // an equal z-index would leave paint order to mount timing.
      // `writing-help-backdrop` / `-panel` carry the entrance (app/globals.css, docs/editor-requirements.md §12.36).
      className='writing-help-backdrop fixed inset-0 z-[55] flex items-start justify-center bg-black/40 p-8'
      // mousedown, not click: a row that unmounts on mousedown lets the mouseup fall through to the
      // document (docs/editor-pitfalls.md §13.3 の前例)。
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}>
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby={headingId}
        className='writing-help-panel flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-panel border border-zinc-300 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900'
        onMouseDown={(event) => event.stopPropagation()}>
        <div className='flex items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-950'>
          <h2 id={headingId} className='text-base font-bold'>
            ヘルプ
          </h2>
          {/* type='button' everywhere: PostEditor wraps the editor in one <form>, and a
              default-type button inside it submits the post. */}
          <CloseButton ref={closeRef} onClick={onClose} />
        </div>

        {/* One scroll, no tabs: the author scans for one row, and tabs would hide most rows. */}
        <div className='space-y-5 overflow-y-auto px-4 py-4 text-sm'>
          <section>
            <h3 className='mb-2 text-xs font-bold text-zinc-500 dark:text-zinc-400'>記法</h3>
            <table className='w-full border-collapse'>
              <tbody>
                {SYNTAX.map((row, i) => (
                  <tr
                    key={i}
                    className='border-t border-zinc-200 first:border-t-0 dark:border-zinc-800'>
                    <td className='w-1/2 py-1.5 pr-3 align-top leading-relaxed'>{row.trigger}</td>
                    <td className='py-1.5 align-top leading-relaxed text-zinc-600 dark:text-zinc-400'>
                      {row.result}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h3 className='mb-2 text-xs font-bold text-zinc-500 dark:text-zinc-400'>
              スラッシュコマンド
            </h3>
            <p className='leading-relaxed'>
              行頭で <Type>/</Type> を打つとメニューが開きます。
            </p>
          </section>

          <section>
            <h3 className='mb-2 text-xs font-bold text-zinc-500 dark:text-zinc-400'>
              ショートカット
            </h3>
            <ul className='grid grid-cols-2 gap-x-6'>
              {SHORTCUT_CATALOG.map((row) => (
                <li
                  key={row.token}
                  // The two-column grid means the first *two* items are a top row, not just the first.
                  className='flex items-center justify-between gap-3 border-t border-zinc-200 py-1.5 [&:nth-child(-n+2)]:border-t-0 dark:border-zinc-800'>
                  <span>{row.label}</span>
                  <Shortcut token={row.token} mac={mac} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
