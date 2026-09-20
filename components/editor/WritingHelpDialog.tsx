'use client';

import { Fragment, useEffect, useId, useRef, type ReactNode } from 'react';
import { isMac, shortcutParts } from './ToolbarButton';
import { SHORTCUT_CATALOG } from './shortcut-catalog';
import { useBodyScrollLock } from './useBodyScrollLock';

// 「ヘルプ」 — the editor's one reference sheet: the markdown input rules, the slash menu, and the
// keyboard shortcuts (docs/cms-features.md「書き方ヘルプ」§4).
//
// **The order is by how hard each part is to find, not by how often it is used.** Every toolbar
// button already prints its key in a tooltip, so the shortcut table is the part that is least
// missing and comes last; the input rules have no surface anywhere and come first. That ordering
// is the whole reason this is a reference sheet rather than the shortcut list it started as.
//
// It takes no `editor`. Everything here is content *about* the editor rather than a command *on*
// one, which is why the header can offer it even when the editor itself failed to mount — the same
// reason the publish button sits outside that gate (PostEditor.tsx).
//
// Rendered only while open (PostEditor holds the flag), so the `navigator` read below never happens
// during an SSR pass: a click is the only way to mount this.

function Key({ children }: { children: string }) {
  return (
    <kbd className='whitespace-nowrap rounded border border-zinc-300 bg-zinc-50 px-1 font-mono text-[11px] text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'>
      {children}
    </kbd>
  );
}

// **One cap per key, with the `+` outside them.** `<kbd>` means one key, so a whole combination in
// a single element says there is a key called "Ctrl+Shift+S"; three caps also make "press three
// things" legible as a shape rather than as a string to read character by character.
//
// Except on a Mac, where the run is one cap: Apple writes ⌘⇧S with no separator, and splitting it
// into ⌘ ⇧ S is not how that platform spells a shortcut. The rule stays one rule — **a cap is what
// the platform writes as a key** — and `formatShortcut`'s own joiner is where that is decided.
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
    <code // `whitespace-nowrap`: `---` broke across two lines at this column width, which reads as
      // two different triggers (measured 2026-09-20).
      className='whitespace-nowrap rounded bg-zinc-100 px-1 font-mono text-[12px] dark:bg-zinc-800'>
      {children}
    </code>
  );
}

// **Hand-maintained, and that is the decision rather than an omission** (acceptance criterion 3h).
// The rules live inside `addInputRules` handlers whose own depth guards — `$from.depth !== 1` for
// the `:::` directives, a three-part blockquote test for the `[!TYPE]` markers — have no projection
// into two columns. The rules themselves are measured in e2e; what this table can go wrong about is
// being out of date, which is a different failure and is answered by keeping it here, next to
// nothing else, where it is read whenever the sheet is.
const SYNTAX: readonly { trigger: ReactNode; result: string }[] = [
  {
    trigger: (
      <>
        <Type>{'## '}</Type> / <Type>{'### '}</Type>
      </>
    ),
    // **「2 階層のみ」は閉じた集合の宣言で、そこが効いている。** `## ` と `### ` を並べるだけでは
    // 「代表例を 2 つ載せた」とも読め、`# ` を打って黙って何も起きない読者に答えを渡せない。
    // `# `/`#### ` を独立した行で否定していた形から 2026-09-20 に畳んだ（行が 1 つ減り、表から
    // 否定形が消える）。
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
    // Written with the trailing space the rule needs, like `## ` and `> ` above — the left column is
    // the characters typed, so the commit key does not need a note in the right one.
    //
    // **Only the `:::` vocabulary is listed.** `> [!NOTE]` reaches the same three tiers and is what
    // gets stored, but it adds no capability here, and the two vocabularies disagree on one word
    // (`:::warning` is 注意, `[!WARNING]` is 警告): listing both would put a contradiction in front
    // of a reader who has no use for the second one.
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
  // `**太字**` / `*斜体*` / `~~打ち消し~~` / `` `コード` `` は載せない（2026-09-20）。4 つとも鍵が
  // 下の節に出ており（前の 3 つはツールバーのボタンも持つ）、記法の行が足す能力は無い。選んでから
  // 押すか、打ちながら書くかという書き方の違いであって、できることの違いではない。
  //
  // **区切り線だけは残る。** `---` と打つのが唯一の作り方で、ツールバーにもスラッシュにも
  // `setHorizontalRule` を呼ぶ導線が無く、鍵も無い。
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

  // Focus in on open, back out on close. The opener is captured here rather than handed in as a
  // prop: it is whatever had focus, and putting it back is this dialog's own business — nothing in
  // the header has to remember to do it. Deferred a frame for the reason InsertDialog's is: the
  // button exists in this commit but has not been laid out yet.
  //
  // **Focus goes back to the button, never to the editor.** `view.dom.focus()` is what InsertDialog
  // does, because it is about to insert at the caret; this sheet inserts nothing, and that call
  // would scroll the caret back under the sticky header for no reason (`focus-then-run.ts`).
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
      // Stopped, or the editor's own Escape handling runs underneath and dismisses whatever the
      // author left open behind this sheet (a link card, the slash menu) as a side effect of
      // closing a reference table.
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
      className='fixed inset-0 z-[55] flex items-start justify-center bg-black/40 p-8'
      // mousedown, not click: a row that unmounts on mousedown lets the mouseup fall through to the
      // document (editor-popup-row-mousedown-unmount の前例)。
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}>
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby={headingId}
        className='flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900'
        onMouseDown={(event) => event.stopPropagation()}>
        <div className='flex items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-950'>
          <h2 id={headingId} className='text-sm font-bold'>
            ヘルプ
          </h2>
          {/* type='button' everywhere: PostEditor wraps the editor in one <form>, and a
              default-type button inside it submits the post. */}
          <button
            ref={closeRef}
            type='button'
            aria-label='閉じる'
            onClick={onClose}
            className='rounded-full border border-zinc-300 px-2 py-0.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'>
            ×
          </button>
        </div>

        {/* One scroll over the three sections — no tabs. What an author does here is scan for one
            row, and a tab hides two thirds of the rows behind a guess about which third it is in. */}
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
