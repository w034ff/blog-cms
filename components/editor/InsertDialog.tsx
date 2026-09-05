'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { EMBED_PROVIDERS, embedRefusal } from '@/lib/embed-provider';
import { resolveInsertTarget, SELF_REFERENCE_NOTE } from '@/lib/insert-target';
import { EmbedProviderIcon } from './embed-provider-icon';
import { speakerdeckSnippetHref } from '@/lib/speakerdeck-snippet';
import {
  internalCardImage,
  CARD_PLACEHOLDER_DARK_SRC,
  type CardImage,
} from '@/lib/link-card-image';
import { isOwnPostHref } from '@/lib/link-card-href';
import { DEFAULT_CATEGORY } from '@/lib/content';
import type { PostSearchResult } from '@/lib/types';

// The shared insert dialog (docs/embed-requirements.md §24.2, docs/link-card-requirements.md §21):
// one modal for both a link card and an embed. Two tabs, never a sub-tab choosing between the two
// outcomes — the URL always decides that (§24:2095), so a card/embed sub-tab would only announce
// what the field below it is about to say for itself. What the two tabs split is the two ways an
// author starts: pasting a URL, or searching this blog's own posts.
//
// Built by extending the embed-only dialog (docs/embed-requirements.md §24.1) rather than writing a
// new one: the embed side had no undecided state to design around (an empty `href` renders 「参照が
// ありません」, an error, not a picker), so the URL field, the provider table, the paste-vs-typed
// timing and the accessible-alert plumbing below are all unchanged from that dialog. What moved in
// is the link card's picker (`renderPicker`, link-card-extension.ts) — its row builder and its
// URL-resolution rule (now `lib/insert-target.ts`, shared so the two surfaces cannot disagree).
export function InsertDialog({
  editor,
  at,
  onClose,
  ownSlug,
}: {
  editor: Editor;
  // Where the result goes, captured when the slash row ran.
  at: number;
  onClose: () => void;
  // The post open in the editor, so its own address is not offered back to it (§18).
  ownSlug: string;
}) {
  const [tab, setTab] = useState<'url' | 'posts'>('url');

  const [href, setHref] = useState('');
  // Whether what is in the field is finished — it was pasted, or the author moved away from it or
  // pressed Enter on it. **Only then does a refusal or a card/embed line appear** (reported
  // 2026-09-02): a URL is not a URL until it is whole, and judging every keystroke means telling an
  // author who has typed 「https://www.you」 that it already resolves to something. Cleared on the
  // next keystroke, not on focus: clicking back into the field to fix the URL must not take the
  // line away before it is read.
  const [attempted, setAttempted] = useState(false);
  // Whether the change about to arrive is a paste. **A ref, and read in `onChange` rather than
  // acted on in `onPaste`**: the paste event fires before the field's value has changed, so setting
  // `attempted` there would be undone by the `onChange` that follows it a moment later.
  const pasted = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const headingId = useId();
  const fieldId = useId();
  const statusId = useId();

  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<PostSearchResult[]>([]);
  const searchTicket = useRef(0);

  // The dialog opens on an empty line the slash menu has just cleared, and the author then types
  // somewhere outside the editor. ProseMirror keeps its selection while the DOM focus is
  // elsewhere, so `setEmbed`/`setLinkCard` still land where the caret was.
  // Closing hands the caret back. Without this the author is left with focus on nothing — the
  // dialog is gone, the editor is not focused, and the next keystroke goes to the document rather
  // than the post (measured 2026-09-02: a second `/` after Escape opened no menu at all).
  const close = () => {
    editor.commands.focus();
    onClose();
  };

  // `focus(at)`, not `focus()`. The caret has been outside the editor while the author typed, and
  // a bare focus restores whatever selection the view holds by then — which put the embed at the
  // end of the document about one run in three (§24.1).
  const commitEmbed = (reference: string) => {
    if (reference === '') return;
    editor.chain().focus(at).setEmbed(reference).run();
    onClose();
  };
  const commitCard = (cardHref: string) => {
    if (cardHref === '') return;
    editor.chain().focus(at).setLinkCard(cardHref).run();
    onClose();
  };

  // **Closed means gone.** PostEditor renders this only while it is open, so neither the abandoned
  // URL, the search query, nor the line either earned can outlive a close — there is no way out of
  // the dialog that has to remember to clear them, and no fifth one to be added later that
  // forgets. Not remembered on purpose: the next open is at wherever the caret is *now*, so
  // offering the previous URL would be offering to insert it somewhere else.
  useEffect(() => {
    // Deferred a frame: the element is rendered in this same commit, and focus() on a node the
    // browser has not laid out yet does nothing.
    const id = requestAnimationFrame(() => {
      (tab === 'url' ? inputRef.current : searchInputRef.current)?.focus();
    });
    return () => cancelAnimationFrame(id);
    // Only on open and on a tab switch — not on every keystroke, which would fight the caret.
  }, [tab]);

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

  // The post search (docs/link-card-requirements.md §5.2-3, §5.3): the same query the card's own
  // NodeView picker runs, moved here for a fresh insert. Only while the tab is open — switching
  // away and back re-fetches for the query already in the field rather than caching across visits,
  // which keeps this in step with a title that changed elsewhere in the same admin session.
  useEffect(() => {
    if (tab !== 'posts') return;
    const ticket = ++searchTicket.current;
    const controller = new AbortController();
    fetch(`/api/posts/search?q=${encodeURIComponent(searchQuery)}`, { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<PostSearchResult[]>) : null))
      .then((data) => {
        // A stale answer must not replace the list the author is looking at with results for a
        // query they have since typed past.
        if (data !== null && ticket === searchTicket.current) setResults(data);
      })
      .catch(() => {
        // Nothing to draw; the list keeps whatever it last had.
      });
    return () => controller.abort();
  }, [tab, searchQuery]);

  const value = href.trim();
  // **What the author pasted, turned into the reference it names.** For eight providers that is
  // the string itself; for Speaker Deck the author has no other move — a deck page's URL carries no
  // id, so `/player/<id>` exists nowhere they can copy it except inside the embed code (§16.3,
  // §16.9). `speakerdeckSnippetHref` decides nothing about validity — it only finds a candidate,
  // and what it returns goes straight back through `resolveInsertTarget` below.
  const reference = value === '' ? '' : (speakerdeckSnippetHref(value) ?? value);
  const target = resolveInsertTarget(reference, ownSlug, window.location.origin);
  // Which row lights up. **Found by host rather than read from a provider's own label**, and
  // **gated on `target.kind === 'embed'`, so a row lights only when the URL can actually be
  // inserted** — `x.com` claims both `/user` and `/user/status/1` and only the second resolves, so
  // lighting by host alone would light X for an account URL beside a disabled button.
  const matched =
    target.kind === 'embed'
      ? (EMBED_PROVIDERS.find((provider) => provider.hosts.includes(hostOf(reference))) ?? null)
      : null;
  // **A provider that claimed the host may still have something to say even once this resolves as
  // a card** — Docswell's video and CodeSandbox's devbox refuse to embed but name the card as the
  // real next move (`Provider.cardFallback`, §24.1's 「残す」 class), and their own reason is worth
  // more than a generic line here for the same reason Figma's specific refusal is (§24.1). Read
  // directly rather than through `target`, which only says whether the card is offered, not why.
  const providerNote = reference !== '' ? embedRefusal(reference) : null;
  // **Before `attempted`, this line carries a standing orientation instead of staying blank** —
  // "what happens to a URL not in the list below" is true regardless of what is typed, so it is
  // not a per-URL judgment and does not need to wait for one. This is why a permanent hint was
  // declined for the embed-only dialog (docs/embed-requirements.md §24.1: "the answer arrives
  // instantly, so a standing line is read before it") does not apply here: that hint would have
  // stayed on screen *next to* the resolved answer; this one is replaced by it the moment
  // `attempted` turns true, so the two are never both on screen at once.
  //
  // **After `attempted`, this is a per-URL judgment**, and it waits for the same reason the
  // embed-only dialog's refusal did: a URL is not whole until the author is done with it, and a
  // card is offered for almost any syntactically valid one — reacting mid-keystroke would
  // announce "this becomes a card" for an unfinished address.
  const status: { text: string; alert: boolean } = !attempted
    ? { text: '一覧にない URL はリンクカードになります。', alert: false }
    : target.kind === 'embed-refused'
      ? { text: target.message, alert: true }
      : target.kind === 'card-refused-self'
        ? { text: SELF_REFERENCE_NOTE, alert: true }
        : target.kind === 'card'
          ? { text: providerNote ?? 'この URL はリンクカードになります。', alert: false }
          : { text: '', alert: false };

  // **A card is offered for almost any syntactically valid URL, so its button waits for `attempted`
  // too** — unlike an embed match, which needs a provider's exact shape (an ID of a fixed length,
  // say) and so can never fire on a URL that is still mid-typing. Without this gate, typing
  // 「https://www.you」 character by character would make 「挿入する」 clickable long before the
  // address is finished, the same premature judgment `attempted` exists to keep the refusal text
  // from making.
  const canInsert = target.kind === 'embed' || (attempted && target.kind === 'card');
  const commit = () => {
    if (target.kind === 'embed') commitEmbed(reference);
    else if (target.kind === 'card') commitCard(target.href);
  };

  const offered = results.filter((post) => !isOwnPostHref(`/posts/${post.slug}`, ownSlug));

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
        // **Full screen on a phone, a card on a desktop.** Carried over from the embed-only dialog
        // (§24.1) rather than reverted to a bottom sheet for this step: a bottom sheet already
        // failed here once with nine provider rows alone (478px of a 700px screen), and this
        // dialog now also holds a second scrollable list (the post search) — a second list can
        // only make that overflow worse, never better.
        className='flex h-full w-full flex-col overflow-hidden border-zinc-300 bg-white shadow-xl sm:h-auto sm:max-h-full sm:max-w-lg sm:rounded-lg sm:border dark:border-zinc-700 dark:bg-zinc-900'
        onMouseDown={(event) => event.stopPropagation()}>
        <div className='flex items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-950'>
          <h2 id={headingId} className='text-sm font-bold'>
            リンクを挿入
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

        {/* No sub-tab chooses card vs. embed — only these two, which split how the author starts
            rather than what they end up with (docs/embed-requirements.md §24:2095). */}
        <div
          role='tablist'
          aria-label='挿入する方法'
          className='flex gap-1 border-b border-zinc-200 px-2 dark:border-zinc-800'>
          <button
            type='button'
            role='tab'
            aria-selected={tab === 'url'}
            aria-controls={`${headingId}-url`}
            onClick={() => setTab('url')}
            className={`border-b-2 px-3 py-2 text-sm ${
              tab === 'url'
                ? 'border-blue-600 font-bold text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}>
            URLを貼り付け
          </button>
          <button
            type='button'
            role='tab'
            aria-selected={tab === 'posts'}
            aria-controls={`${headingId}-posts`}
            onClick={() => setTab('posts')}
            className={`border-b-2 px-3 py-2 text-sm ${
              tab === 'posts'
                ? 'border-blue-600 font-bold text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}>
            記事から選ぶ
          </button>
        </div>

        <div
          id={`${headingId}-url`}
          role='tabpanel'
          hidden={tab !== 'url'}
          className='flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3'>
          <label htmlFor={fieldId} className='text-xs font-bold'>
            URL または埋め込みコード
          </label>
          {/* **The field and its message, in a wrapper of their own.** As a direct child of the
              `gap-2` column the message would take an 8px gap on both sides *even while empty*, and
              it is always mounted (below) — so its reserved line would have cost 28px rather than
              the 20px it is worth. */}
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
                // **A pasted URL is judged at once; a typed one waits.** Pasting is a finished
                // action — the URL arrives whole — and it is how a URL gets into this field nearly
                // every time, so making it wait for a blur is what made the dialog feel silent
                // (reported 2026-09-02). A keystroke is not finished, which is the whole reason for
                // the wait.
                setAttempted(pasted.current);
                pasted.current = false;
              }}
              onBlur={() => setAttempted(true)}
              onKeyDown={(event) => {
                // **A keystroke is never a paste.** `onChange` is what consumes the flag, and React
                // raises no change event when a paste does not alter the value — so re-pasting the
                // same URL to check it took would leave the flag set, and the next keystroke would
                // be judged as if it were finished. Ctrl+V's own keydown clears it a moment before
                // its paste sets it, so this costs the paste path nothing.
                pasted.current = false;
                if (event.key !== 'Enter') return;
                event.preventDefault();
                // Set before the branch: Enter on a URL nothing claims does not insert, and silence
                // is the one answer that leaves the author with nothing to do next.
                setAttempted(true);
                // **`target.kind`, not `canInsert`.** `canInsert` was computed from last render's
                // `attempted`, which the `setAttempted` above has not yet turned into a re-render —
                // reading it here would silently ignore the very first Enter on a URL nobody had
                // paste/blurred out of yet, and need a second press to actually insert.
                if (target.kind === 'embed' || target.kind === 'card') commit();
              }}
              placeholder='https://…'
              autoComplete='off'
              // **Announced by the message's own live region, not by this.** On the path that
              // matters the URL is pasted, so the field already has focus when the line appears —
              // and a description added to an already-focused element is not reliably read. This is
              // for the author who comes back to the field afterwards, which is why it points at
              // the container whether or not it holds anything.
              aria-describedby={statusId}
              aria-invalid={status.alert}
              // Detached from PostEditor's form, so a publish running while this is open cannot
              // blank it (React 19 resets form controls after a server action).
              form='__insert-dialog-detached'
              className='rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900'
            />
            {/* **Always mounted, holding the standing hint from the first paint — never truly
                empty.** A live-region container has to be in the accessibility tree *before* its
                text changes, which mounting it together with new text, or behind `display: none`,
                would miss — and starting non-blank means that property holds from the very first
                render, not just from the first refusal. `role='alert'` for a refusal (an
                interruption worth announcing at once); `role='status'` for the hint and the card
                line, both information rather than a problem. */}
            <p
              id={statusId}
              role={status.alert ? 'alert' : 'status'}
              className='mt-1 min-h-4 text-xs text-zinc-500 dark:text-zinc-400'>
              {status.text}
            </p>
          </div>

          <ul className='divide-y divide-zinc-200 overflow-hidden rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800'>
            {EMBED_PROVIDERS.map((provider) => {
              const on = provider === matched;
              return (
                <li
                  key={provider.name}
                  // **The one row that answered, said in something other than colour.**
                  // `aria-current` says it to a screen reader, the left bar says it to the eye.
                  aria-current={on ? 'true' : undefined}
                  className={`border-l-2 py-2.5 pr-3 pl-2.5 text-xs ${
                    on
                      ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40'
                      : 'border-transparent'
                  }`}>
                  <div className='flex items-center gap-3'>
                    <EmbedProviderIcon name={provider.name} />
                    <span className='w-28 flex-none font-bold'>{provider.name}</span>
                    <span
                      data-embed-kind
                      className='min-w-0 flex-1 truncate text-zinc-500 dark:text-zinc-400'>
                      {provider.kind}
                      {provider.note !== undefined && <sup className='font-bold'>＊</sup>}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>

          {EMBED_PROVIDERS.filter((provider) => provider.note !== undefined).map((provider) => (
            <p key={provider.name} className='px-0.5 text-[11px] text-zinc-500 dark:text-zinc-400'>
              <sup className='font-bold'>＊</sup> {provider.name} は URL ではなく{provider.note}
              を貼ってください
            </p>
          ))}
        </div>

        <div
          id={`${headingId}-posts`}
          role='tabpanel'
          hidden={tab !== 'posts'}
          // `pb-5`, not the `py-3` the URL tab uses: this pane has no footer to hold a gap
          // between its last row and the backdrop's own close-on-click area, unlike the URL tab,
          // where the submit bar already does that job. Plain space, not a restored footer — a
          // count that named the URL tab's own provider table would say nothing true here.
          className='flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pt-3 pb-5'>
          {/* No visible label, matching `renderPicker`'s own search box (link-card-extension.ts)
              this tab is a port of — that one has never had one either, and the placeholder is
              its accessible name the same way here (no label, no `aria-label`, is what the
              accessible-name computation falls back to). A label here would only restate what
              the placeholder already says. */}
          <input
            id={`${headingId}-search`}
            ref={searchInputRef}
            type='search'
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder='記事のタイトルで検索…'
            autoComplete='off'
            className='rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900'
          />
          <ul className='divide-y divide-zinc-200 overflow-y-auto rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800'>
            {offered.length === 0 ? (
              <li className='px-2.5 py-2 text-xs text-zinc-500 dark:text-zinc-400'>
                {offered.length < results.length ? SELF_REFERENCE_NOTE : '一致する記事がありません'}
              </li>
            ) : (
              offered.map((post) => (
                <SearchResultRow
                  key={post.slug}
                  post={post}
                  onPick={() => commitCard(`/posts/${post.slug}`)}
                />
              ))
            )}
          </ul>
        </div>

        {/* Only the URL tab has anything to say here — the 対応9件 count is about its own
            provider table, and picking a row on the posts tab already inserts on click, with no
            separate submit step for this footer to hold a button for. */}
        {tab === 'url' && (
          <div className='flex items-center justify-between gap-3 border-t border-zinc-200 px-4 py-2.5 dark:border-zinc-800'>
            <span className='text-xs text-zinc-500 dark:text-zinc-400'>
              対応 {EMBED_PROVIDERS.length} 件
            </span>
            {/* **The label does not change with the URL.** It named the provider for a while
                (「YouTube として挿入する」), which put text that moves and resizes on the control
                the author is aiming at, and said a third time what the lit row and the enabled
                button already say. */}
            <button
              type='button'
              onClick={commit}
              disabled={!canInsert}
              className='rounded bg-blue-600 px-4 py-1.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40'>
              挿入する
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// The host of what the author has typed so far, or '' when it is not a URL yet. Only used to
// decide which row lights up; `resolveInsertTarget` is what decides whether anything can be
// inserted.
function hostOf(value: string): string {
  try {
    return new URL(value.trim()).hostname;
  } catch {
    return '';
  }
}

// The post search's own row (docs/link-card-requirements.md §5.2-5, §21): a port of
// `resultRow`/`resultImage` (link-card-extension.ts) into React, since that function builds plain
// DOM for the card's NodeView and this dialog is React. **The accessible name must match exactly**
// — `e2e/editor-link-card.spec.ts` asks for a row by `getByRole('button', { name: CARD_TITLE })`,
// a full-string match, and a name of "title 未公開 category" would miss it.
function SearchResultRow({ post, onPick }: { post: PostSearchResult; onPick: () => void }) {
  const image = internalCardImage(post.thumbnail);
  return (
    <li>
      <button
        type='button'
        onClick={onPick}
        aria-label={post.draft ? `${post.title}（未公開）` : post.title}
        className='flex w-full items-center gap-3 px-2.5 py-2 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800'>
        <SearchResultImage image={image} />
        <span className='min-w-0 flex-1'>
          <span className='flex items-baseline gap-1.5'>
            <span className='min-w-0 truncate'>{post.title}</span>
            {post.draft && (
              <span
                aria-hidden='true'
                className='flex-none rounded bg-zinc-100 px-1 text-[10.5px] dark:bg-zinc-800'>
                未公開
              </span>
            )}
          </span>
          {post.category !== DEFAULT_CATEGORY && (
            <span className='block truncate text-zinc-500 dark:text-zinc-400'>{post.category}</span>
          )}
        </span>
      </button>
    </li>
  );
}

// 44px (2.75rem), matching `.link-card-result-image` in app/globals.css exactly — a row is read
// down its left edge, so every row's text must start at the same x, which is also why the house
// mark stands in for a post with none rather than the frame being dropped.
function SearchResultImage({ image }: { image: CardImage }) {
  // A plain <img>, silenced the same way ThumbnailField and LinkBubble silence it: this same
  // picture is already drawn on three other surfaces (the published card, the card's own NodeView,
  // and the picker this row is ported from), none of which can use next/image either — the
  // published one is assembled by rehype as a hast tree, and a fourth surface disagreeing about
  // how a thumbnail is drawn would buy optimization nothing here has needed yet.
  if (!image.placeholder) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={image.src} alt='' className='h-11 w-11 flex-none rounded object-cover' />
    );
  }
  return (
    <picture>
      <source media='(prefers-color-scheme: dark)' srcSet={CARD_PLACEHOLDER_DARK_SRC} />
      <img
        src={image.src}
        alt=''
        className='h-11 w-11 flex-none rounded bg-zinc-100 object-contain p-1.5 dark:bg-zinc-800'
      />
    </picture>
  );
}
