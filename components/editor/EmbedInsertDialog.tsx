'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { EMBED_PROVIDERS, embedRefusal, resolveEmbed } from '@/lib/embed-provider';
import { speakerdeckSnippetHref } from '@/lib/speakerdeck-snippet';

// The embed's insert dialog (docs/embed-requirements.md §24.1).
//
// **One URL field and a table of what can be embedded.** The reference site's dialog is a row of
// buttons per provider because its editor writes markdown and the author has to produce
// `@[youtube](動画のID)`; here the provider is derived from the URL, so asking which one first
// would be a step that answers a question already answered. The nine rows are read, not pressed —
// they are the only place an author is told what is supported, which is the job the link card
// picker's explanatory line was doing badly (2 providers named of 9).
//
// The list comes from `EMBED_PROVIDERS`, which is derived from the resolver's own registry. A
// hand-kept list would have been wrong four times in the month this feature grew Figma, the gist,
// CodeSandbox and CodePen.
export function EmbedInsertDialog({
  editor,
  at,
  onClose,
}: {
  editor: Editor;
  // Where the embed goes, captured when the slash row ran.
  at: number;
  onClose: () => void;
}) {
  const [href, setHref] = useState('');
  // Whether what is in the field is finished — it was pasted, or the author moved away from it or
  // pressed Enter on it. **Only then does the refusal appear** (reported 2026-09-02): a URL is not a
  // URL until it is whole, and judging every keystroke means telling an author who has typed
  // 「https://www.you」 that nothing supports it. Cleared on the next keystroke, not on focus:
  // clicking back into the field to fix the URL must not take the reason away before it is read.
  const [attempted, setAttempted] = useState(false);
  // Whether the change about to arrive is a paste. **A ref, and read in `onChange` rather than
  // acted on in `onPaste`**: the paste event fires before the field's value has changed, so setting
  // `attempted` there would be undone by the `onChange` that follows it a moment later.
  const pasted = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const headingId = useId();
  const fieldId = useId();
  const refusalId = useId();

  // The dialog opens on an empty line the slash menu has just cleared, and the author then types
  // somewhere outside the editor. ProseMirror keeps its selection while the DOM focus is
  // elsewhere, so `setEmbed` still lands where the caret was — `e2e/editor-embed-insert.spec.ts`
  // inserts into the middle of a document rather than an empty one, because an empty one would
  // pass whether that holds or not.
  // Closing hands the caret back. Without this the author is left with focus on nothing — the
  // dialog is gone, the editor is not focused, and the next keystroke goes to the document rather
  // than the post (measured 2026-09-02: a second `/` after Escape opened no menu at all).
  const close = () => {
    editor.commands.focus();
    onClose();
  };

  // Takes the resolved reference rather than the field's text, so a pasted embed snippet stores
  // the player URL it names and not the markup around it.
  const insert = (reference: string) => {
    if (reference === '') return;
    // `focus(at)`, not `focus()`. The caret has been outside the editor while the author typed,
    // and a bare focus restores whatever selection the view holds by then — which put the embed at
    // the end of the document about one run in three (§24.1).
    editor.chain().focus(at).setEmbed(reference).run();
    onClose();
  };

  // **Closed means gone.** PostEditor renders this only while it is open, so neither the abandoned
  // URL nor the refusal it earned can outlive a close — there is no way out of the dialog that has
  // to remember to clear them, and no fifth one to be added later that forgets. Not remembered on
  // purpose: the next open is at wherever the caret is *now*, so offering the previous URL would be
  // offering to insert it somewhere else.
  useEffect(() => {
    // Deferred a frame: the element is rendered in this same commit, and focus() on a node the
    // browser has not laid out yet does nothing.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Stopped, or the editor's own Escape handling runs too — and the last thing a dialog should
      // do on the way out is move the caret it is about to insert at.
      event.stopPropagation();
      editor.commands.focus();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
    // `onClose` is stable (PostEditor wraps it), so this registers once per open rather than once
    // per render — a ref to keep it stable instead is what `react-hooks/refs` refuses.
  }, [editor, onClose]);

  const value = href.trim();
  // **What the author pasted, turned into the reference it names.** For eight providers that is
  // the string itself; for Speaker Deck the author has no other move — a deck page's URL carries no
  // id, so `/player/<id>` exists nowhere they can copy it except inside the embed code (§16.3,
  // §16.9). The editor already took that snippet as a paste into the body; this dialog was a fourth
  // entrance that had not been given it.
  //
  // **`speakerdeckSnippetHref` decides nothing about validity** — it only finds a candidate, and
  // what it returns goes straight back through `resolveEmbed` below. So the set of references that
  // can be stored is unchanged; what widened is the shape that may be pasted (§16.9).
  const reference = value === '' ? '' : (speakerdeckSnippetHref(value) ?? value);
  const target = reference === '' ? null : resolveEmbed(reference);
  // Which row lights up. **Found by host rather than read from `target.label.lead`**: that field is
  // the strongest thing the URL says about the item, which for X and the gist is the account, not
  // the provider (§10.4, §18). The table names providers.
  //
  // **Gated on `target`, so a row lights only when the URL can actually be inserted** — `x.com`
  // claims both `/user` and `/user/status/1` and only the second resolves, so lighting by host
  // alone would light X for an account URL beside a disabled button (measured 2026-09-02). A
  // resolved target always has a row: `resolveEmbed` answers only when a registry host matched, so
  // the `?? null` is for the type, not for a state the dialog draws differently.
  //
  // **Read from `reference`, not from the field.** An embed snippet is not a URL, so `hostOf` of
  // what the author pasted is `''` — asking the field would have resolved the deck, enabled the
  // button and lit no row, which is exactly the contradiction the paragraph above says cannot
  // happen.
  const matched =
    target === null
      ? null
      : (EMBED_PROVIDERS.find((provider) => provider.hosts.includes(hostOf(reference))) ?? null);
  // **The line appears only when something is wrong, and only once the author is done typing.** It
  // said three things and two of them were already on screen: with an empty field the label, the
  // placeholder and the disabled button all say "paste a URL", and on a match the table's row is
  // lit. What is left is the one state nothing else explains — a disabled button with no reason
  // and no next move.
  //
  // **It says the URL cannot be embedded, not that no service matches.** Five registered hosts
  // resolve for some URL shapes and not others — Speaker Deck, SlideShare's regional hosts, Figma
  // proto/board/slides, Docswell video, CodeSandbox '/p/devbox/' — and the table is showing those
  // provider names three lines below, so "no service matches" reads as a contradiction there. And
  // **the second sentence is the half that is always true**: for Speaker Deck it is the only
  // recovery, since a deck page carries no id and re-reading the URL cannot fix it (§16.3).
  //
  // **A provider that claimed the host may answer in its own words** (`embedRefusal`, §24.1). Two
  // shapes of answer: where the author can reach a URL that works, it names that and drops the card
  // (Figma, Speaker Deck); where nothing can embed the reference at all, it keeps the card — which
  // really is the next move — and supplies the reason this sentence cannot (Docswell's video,
  // CodeSandbox's devbox). Null for everything else, which is most references.
  const refusal =
    attempted && value !== '' && target === null
      ? (embedRefusal(reference) ?? 'このURLは埋め込めません。リンクカードにしてください。')
      : null;

  return (
    <div
      className='fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 p-0 sm:items-start sm:p-8'
      // A click on the sheet itself must not reach this — mousedown rather than click for the
      // reason the link card's rows learned the hard way: a control that unmounts on mousedown
      // lets the mouseup fall through to the document.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}>
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby={headingId}
        // **Full screen on a phone, a card on a desktop.** It was a bottom sheet first, and that
        // was wrong for this dialog's contents: nine provider rows make it 478px of a 700px screen,
        // so it sat in the bottom 68% with the form fields showing above it — reported 2026-09-02,
        // and with a soft keyboard up (~319px of usable height, §24) it would not have fitted at
        // all. Filling the screen has no dead space to explain, keeps the URL field directly under
        // the header where the keyboard cannot reach it, and lets the table scroll in the middle.
        className='flex h-full w-full flex-col overflow-hidden border-zinc-300 bg-white shadow-xl sm:h-auto sm:max-h-full sm:max-w-lg sm:rounded-lg sm:border dark:border-zinc-700 dark:bg-zinc-900'
        onMouseDown={(event) => event.stopPropagation()}>
        <div className='flex items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-950'>
          <h2 id={headingId} className='text-sm font-bold'>
            埋め込みを挿入
          </h2>
          {/* type='button' everywhere: PostEditor wraps the editor in one <form>, and a
              default-type button inside it submits the post. */}
          <button
            type='button'
            aria-label='閉じる'
            onClick={close}
            className='rounded-full border border-zinc-300 px-2 py-0.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'>
            ×
          </button>
        </div>

        {/* `flex-1` so the footer is pinned to the bottom of a full-screen sheet instead of
            following the table and leaving 250px of white under it (measured at 390x700). On a
            desktop the dialog is `h-auto`, so this takes only what the content needs. */}
        <div className='flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3'>
          <label htmlFor={fieldId} className='text-xs font-bold'>
            URL または埋め込みコード
          </label>
          {/* **The field and its message, in a wrapper of their own.** As a direct child of the
              `gap-2` column the message would take an 8px gap on both sides *even while empty*, and
              it is always mounted (below) — so its reserved line would have cost 28px rather than
              the 20px it is worth. Nesting buys the difference and nothing else: the reservation
              below is what keeps the table still. */}
          <div className='flex flex-col'>
            <input
              id={fieldId}
              ref={inputRef}
              // `text`, not `url`: a Speaker Deck embed snippet is markup, and `url` would have the
              // browser mark the one paste this field exists to accept for that provider as
              // malformed.
              type='text'
              value={href}
              onPaste={() => {
                pasted.current = true;
              }}
              onChange={(event) => {
                setHref(event.target.value);
                // **A pasted URL is judged at once; a typed one waits.** Pasting is a finished action
                // — the URL arrives whole — and it is how a URL gets into this field nearly every
                // time, so making it wait for a blur is what made the dialog feel silent (reported
                // 2026-09-02). A keystroke is not finished, which is the whole reason for the wait.
                setAttempted(pasted.current);
                pasted.current = false;
              }}
              onBlur={() => setAttempted(true)}
              onKeyDown={(event) => {
                // **A keystroke is never a paste.** `onChange` is what consumes the flag, and React
                // raises no change event when a paste does not alter the value — so re-pasting the
                // same URL to check it took would leave the flag set, and the next keystroke would be
                // judged as if it were finished (measured 2026-09-02: the refusal came back mid-typing,
                // which is the report this whole gate exists for). Ctrl+V's own keydown clears it a
                // moment before its paste sets it, so this costs the paste path nothing.
                pasted.current = false;
                if (event.key !== 'Enter') return;
                event.preventDefault();
                // Set before the branch: Enter on a URL nothing claims does not insert, and silence
                // is the one answer that leaves the author with nothing to do next.
                setAttempted(true);
                if (target) insert(reference);
              }}
              placeholder='https://…'
              autoComplete='off'
              // **Announced by the message's own `role='alert'`, not by this.** On the path that
              // matters the URL is pasted, so the field already has focus when the refusal appears —
              // and a description added to an already-focused element is not reliably read. This is
              // for the author who comes back to the field afterwards, which is why it points at the
              // container whether or not it holds anything: an attribute that appears and disappears
              // on a focused element is the shape that goes unread.
              aria-describedby={refusalId}
              aria-invalid={refusal !== null}
              // Detached from PostEditor's form, so a publish running while this is open cannot
              // blank it (React 19 resets form controls after a server action).
              form='__embed-insert-detached'
              className='rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900'
            />
            {/* **Rendered whether or not it says anything.** A `role='alert'` container has to be
              in the accessibility tree *before* its text arrives — mounting it together with the
              text, or hiding it with `display: none`, is what makes the announcement miss.

              **And it holds its one line's height while empty, so nothing moves when the refusal
              arrives.** This is the reservation that was refused twice, and what changed is the
              wording: at 「対応するサービスがありません」 the line was 1 row on a desktop and 2 on a
              phone, so no single reservation fitted both and the worst case put 32px of nothing
              under the field on the smaller screen. The shorter sentence is 279px against the
              343px a 390px-wide phone gives it — **one line on both**, which is what makes a fixed
              `min-h-4` exact rather than a guess. **At 320px it wraps back to two and the table moves
              16px** (measured 2026-09-03) — the reservation holds from 390px up, not everywhere.

              20px of quiet space under a text field is not the thing that was removed from here.
              **That was a sentence** — it competed for the eye and, being the empty state's, was
              the first thing read and the least worth reading (§24.1). Whitespace makes no claim.

              **The refusal is announced, the same way the lit row is.** Success got `aria-current`
              and a left bar because colour alone reached neither a reader who does not see it nor
              one who hears the page; this is that standard applied to the other half. */}
            <p
              id={refusalId}
              role='alert'
              className='mt-1 min-h-4 text-xs text-zinc-500 dark:text-zinc-400'>
              {refusal}
            </p>
          </div>

          <ul className='divide-y divide-zinc-200 overflow-hidden rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800'>
            {EMBED_PROVIDERS.map((provider) => {
              const on = provider === matched;
              return (
                <li
                  key={provider.name}
                  // **The one row that answered, said in something other than colour.** With
                  // 「これになります」 gone the tint was the whole signal, and `bg-blue-50` on white
                  // is 1.05:1 — invisible to a reader who does not see colour and unannounced to one
                  // who hears the page. `aria-current` says it to a screen reader, the left bar says
                  // it to the eye, and the spec asks for the row by the same attribute.
                  aria-current={on ? 'true' : undefined}
                  className={`border-l-2 py-1.5 pr-3 pl-2.5 text-xs ${
                    on
                      ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40'
                      : 'border-transparent'
                  }`}>
                  <div className='flex items-center gap-3'>
                    <span className='w-28 flex-none font-bold'>{provider.name}</span>
                    {/* **What kind of thing this provider embeds** (§24.1, 2026-09-03). The hosts
                        were here until this date and answered the wrong question — which site
                        matches, when every URL an author gets wrong is about which page on it —
                        and at 390px the column had about 210px, so YouTube's and X's host lists
                        were truncated on top of that. The kind is per-provider truth, so it needs
                        no second string kept in step with the matcher.

                        **The note, in parentheses, is Speaker Deck's alone**: the one provider
                        whose address bar is not the answer (§16.10). One text node rather than a
                        nested span, so `e2e/editor-embed-insert.spec.ts` can assert the cell by
                        its exact text. No `font-mono` any more — the column is Japanese nouns
                        now, which is also what lets the note sit in it without breaking register,
                        the objection that kept a sentence out of the hosts column. */}
                    <span className='min-w-0 flex-1 truncate text-zinc-500 dark:text-zinc-400'>
                      {provider.note === undefined
                        ? provider.kind
                        : `${provider.kind}（${provider.note}）`}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className='flex items-center justify-between gap-3 border-t border-zinc-200 px-4 py-2.5 dark:border-zinc-800'>
          <span className='text-xs text-zinc-500 dark:text-zinc-400'>
            対応 {EMBED_PROVIDERS.length} 件
          </span>
          {/* **The label does not change with the URL.** It named the provider for a while
              (「YouTube として挿入する」), which put text that moves and resizes on the control the
              author is aiming at, and said a third time what the lit row and the enabled button
              already say (reported 2026-09-02). */}
          <button
            type='button'
            onClick={() => insert(reference)}
            disabled={target === null}
            className='rounded bg-blue-600 px-4 py-1.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40'>
            挿入する
          </button>
        </div>
      </div>
    </div>
  );
}

// The host of what the author has typed so far, or '' when it is not a URL yet. Only used to
// decide which row lights up; `resolveEmbed` is what decides whether anything can be inserted.
function hostOf(value: string): string {
  try {
    return new URL(value.trim()).hostname;
  } catch {
    return '';
  }
}
