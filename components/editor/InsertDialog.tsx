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
import { categoryLabel } from '@/lib/content';
import type { PostSearchResult } from '@/lib/types';
import { useBodyScrollLock } from './useBodyScrollLock';
import { CloseButton } from './CloseButton';

// The shared insert dialog (docs/embed-requirements.md §24.2, docs/link-card-requirements.md §21):
// one modal for both a link card and an embed. The URL always decides which (§24), so the two tabs
// split only how the author starts: pasting a URL, or searching this blog's posts. The URL side is
// the embed-only dialog's (§24.1); the posts side ports the card picker's `renderPicker`, sharing
// its resolution rule through `lib/insert-target.ts`.
export function InsertDialog({
  editor,
  at,
  onClose,
  onCancel,
  onCommit,
  ownSlug,
}: {
  editor: Editor;
  // Where the result goes, captured when the slash row ran.
  at: number;
  onClose: () => void;
  // Cancelled rather than committed: PostEditor.tsx reopens the ＋ sheet, which a mousedown in
  // this dialog has already closed.
  onCancel: () => void;
  // Something landed; PostEditor.tsx keeps the sheet closed.
  onCommit: () => void;
  // The post open in the editor, so its own address is not offered back to it (§18).
  ownSlug: string;
}) {
  // Mounted only while open, so always locked.
  useBodyScrollLock(true);

  const [tab, setTab] = useState<'url' | 'posts'>('url');

  const [href, setHref] = useState('');
  // Whether the field's content is finished (pasted, blurred, or Enter). **Only then does a verdict
  // appear**, so a half-typed URL is not judged. Cleared on the next keystroke, not on focus, so
  // clicking back in doesn't hide the line before it is read.
  const [attempted, setAttempted] = useState(false);
  // Whether the next change is a paste. Read in `onChange`: `onPaste` fires before the value
  // changes, and the following `onChange` would undo anything set there.
  const pasted = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const headingId = useId();
  const fieldId = useId();
  const statusId = useId();

  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<PostSearchResult[]>([]);
  const searchTicket = useRef(0);

  // Closing hands focus back to the editor, or the next keystroke goes nowhere. A raw
  // `view.dom.focus({ preventScroll: true })`: @tiptap/core's `focus` command calls a bare
  // `view.dom.focus()` on iOS/Android whatever its `scrollIntoView` option says, and the page
  // jumped to the top (see focus-then-run.ts). ProseMirror keeps the selection through the blur.
  const close = () => {
    editor.view.dom.focus({ preventScroll: true });
    onClose();
    onCancel();
  };

  // `focus(at)`, not `focus()`, which sometimes restored the selection at the document's end
  // (§24.1).
  const commitEmbed = (reference: string) => {
    if (reference === '') return;
    editor.chain().focus(at).setEmbed(reference).run();
    onClose();
    onCommit();
  };
  const commitCard = (cardHref: string) => {
    if (cardHref === '') return;
    editor.chain().focus(at).setLinkCard(cardHref).run();
    onClose();
    onCommit();
  };

  // **Closed means gone:** mounted only while open, so no field state outlives a close. Deliberate:
  // the next open inserts somewhere else.
  useEffect(() => {
    // Deferred a frame, until the element is laid out.
    const id = requestAnimationFrame(() => {
      (tab === 'url' ? inputRef.current : searchInputRef.current)?.focus();
    });
    return () => cancelAnimationFrame(id);
    // Only on open and on a tab switch — not on every keystroke, which would fight the caret.
  }, [tab]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Stopped, or the editor's own Escape runs too. Focus as in `close()`.
      event.stopPropagation();
      editor.view.dom.focus({ preventScroll: true });
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
    // `onClose` is stable (PostEditor wraps it), so this registers once per open.
  }, [editor, onClose]);

  // The post search (docs/link-card-requirements.md §5.2-3, §5.3), the card picker's query. Not
  // cached across tab visits, so a title changed elsewhere shows up.
  useEffect(() => {
    if (tab !== 'posts') return;
    const ticket = ++searchTicket.current;
    const controller = new AbortController();
    fetch(`/api/posts/search?q=${encodeURIComponent(searchQuery)}`, { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<PostSearchResult[]>) : null))
      .then((data) => {
        // Drop stale answers.
        if (data !== null && ticket === searchTicket.current) setResults(data);
      })
      .catch(() => {
        // Nothing to draw; the list keeps whatever it last had.
      });
    return () => controller.abort();
  }, [tab, searchQuery]);

  const value = href.trim();
  // The reference the paste names: the string itself, or for Speaker Deck the `/player/<id>` found in
  // its embed code (§16.3, §16.9). Validity is still `resolveInsertTarget`'s call.
  const reference = value === '' ? '' : (speakerdeckSnippetHref(value) ?? value);
  const target = resolveInsertTarget(reference, ownSlug, window.location.origin);
  // Which row lights up: by host, and **only when the URL can be inserted** (`x.com/user` is X's
  // host but does not resolve).
  const matched =
    target.kind === 'embed'
      ? (EMBED_PROVIDERS.find((provider) => provider.hosts.includes(hostOf(reference))) ?? null)
      : null;
  // A provider may explain why its URL becomes a card (`Provider.cardFallback`, §24.1); `target`
  // says only that it does.
  const providerNote = reference !== '' ? embedRefusal(reference) : null;
  // Before `attempted`, a standing hint that is true whatever is typed; it is replaced by, never
  // shown beside, the per-URL verdict (why §24.1's objection to a standing line doesn't apply). An
  // empty field also resolves to `'none'`, which is not a refusal, hence `value !== ''`.
  const status: { text: string; alert: boolean } = !attempted
    ? { text: '一覧にない URL はリンクカードになります。', alert: false }
    : target.kind === 'embed-refused'
      ? { text: target.message, alert: true }
      : target.kind === 'card-refused-self'
        ? { text: SELF_REFERENCE_NOTE, alert: true }
        : target.kind === 'card'
          ? { text: providerNote ?? 'この URL はリンクカードになります。', alert: false }
          : target.kind === 'none' && value !== ''
            ? { text: 'この URL は挿入できません。', alert: true }
            : { text: '', alert: false };

  // A card matches almost any valid URL, so its button waits for `attempted`; an embed needs a
  // provider's exact shape and cannot match mid-typing.
  const canInsert = target.kind === 'embed' || (attempted && target.kind === 'card');
  const commit = () => {
    if (target.kind === 'embed') commitEmbed(reference);
    else if (target.kind === 'card') commitCard(target.href);
  };

  const offered = results.filter((post) => !isOwnPostHref(`/posts/${post.slug}`, ownSlug));

  return (
    <div
      // `z-[55]`: the ＋ sheet (`z-50`, portalled later) can still be mounted underneath, and at an
      // equal z-index it blocked clicks on 挿入する.
      className='fixed inset-0 z-[55] flex items-stretch justify-center bg-black/40 p-0 sm:items-start sm:p-8'
      // mousedown, not click (docs/editor-pitfalls.md §13.3).
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}>
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby={headingId}
        // Full screen on a phone, a card on a desktop (§24.1): a bottom sheet overflowed with the
        // provider rows alone.
        className='flex h-full w-full flex-col overflow-hidden border-zinc-300 bg-white shadow-xl sm:h-auto sm:max-h-full sm:max-w-lg sm:rounded-lg sm:border dark:border-zinc-700 dark:bg-zinc-900'
        onMouseDown={(event) => event.stopPropagation()}>
        <div className='flex items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-950'>
          <h2 id={headingId} className='text-base font-bold'>
            リンクを挿入
          </h2>
          {/* type='button' everywhere: PostEditor wraps the editor in one <form>, and a
              default-type button inside it submits the post. */}
          <CloseButton onClick={close} />
        </div>

        {/* The tabs split how the author starts, never card vs. embed (docs/embed-requirements.md
            §24). */}
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
          {/* Wrapped so the always-mounted message doesn't take the column's gap on both sides. */}
          <div className='flex flex-col'>
            <input
              id={fieldId}
              ref={inputRef}
              // `text`, not `url`: a Speaker Deck embed snippet is markup.
              type='text'
              value={href}
              onPaste={() => {
                pasted.current = true;
              }}
              onChange={(event) => {
                setHref(event.target.value);
                // **A pasted URL is judged at once; a typed one waits.**
                setAttempted(pasted.current);
                pasted.current = false;
              }}
              onBlur={() => setAttempted(true)}
              onKeyDown={(event) => {
                // **A keystroke is never a paste.** A paste that doesn't change the value raises no
                // `onChange`, which would leave the flag set for the next keystroke.
                pasted.current = false;
                if (event.key !== 'Enter') return;
                event.preventDefault();
                // Set before the branch, so Enter on an unclaimed URL still shows a verdict.
                setAttempted(true);
                // `target.kind`, not `canInsert`, which still holds last render's `attempted`.
                if (target.kind === 'embed' || target.kind === 'card') commit();
              }}
              placeholder='https://…'
              autoComplete='off'
              // The live region announces changes; this is for returning to the field later.
              aria-describedby={statusId}
              aria-invalid={status.alert}
              // Detached from PostEditor's form, so a publish running while this is open cannot
              // blank it (React 19 resets form controls after a server action).
              form='__insert-dialog-detached'
              className='rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900'
            />
            {/* **Always mounted:** a live region must be in the accessibility tree before its text
                changes. `alert` for a refusal, `status` for information. */}
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
          // `pb-5`: no footer here to separate the last row from the backdrop.
          className='flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pt-3 pb-5'>
          {/* No label, like `renderPicker`'s box: the placeholder is the accessible name. */}
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

        {/* URL tab only: a posts row inserts on click. */}
        {tab === 'url' && (
          <div className='flex items-center justify-end gap-3 border-t border-zinc-200 px-4 py-2.5 dark:border-zinc-800'>
            {/* **A fixed label:** a provider-naming label moved under the pointer and repeated the
                lit row. */}
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

// The host typed so far, or ''. Only for lighting a row.
function hostOf(value: string): string {
  try {
    return new URL(value.trim()).hostname;
  } catch {
    return '';
  }
}

// A React port of link-card-extension.ts's `resultRow` (docs/link-card-requirements.md §5.2-5,
// §21). **The accessible name must be the title exactly:** e2e/editor-link-card.spec.ts matches it
// as a full string.
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
          <span className='block truncate text-zinc-500 dark:text-zinc-400'>
            {categoryLabel(post.category)}
          </span>
        </span>
      </button>
    </li>
  );
}

// 44px, matching `.link-card-result-image`, so every row's text starts at the same x; the house
// mark fills the frame for a post with no image.
function SearchResultImage({ image }: { image: CardImage }) {
  // A plain <img>, as in ThumbnailField: the other surfaces can't use next/image either.
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
