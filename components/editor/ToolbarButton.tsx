'use client';

import type { ReactNode } from 'react';
import { EditorTooltip } from './EditorTooltip';

// Client-only component (the toolbar mounts after the client editor exists), so
// navigator is available; the guard just keeps any SSR pass from throwing.
function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iP(hone|ad|od)/.test(navigator.platform);
}

// TipTap keymap token ("Mod-Shift-s") → a human tooltip label. "Mod" is the
// platform command key: ⌘ on macOS, Ctrl elsewhere. Mac joins glyphs (⌘⇧S);
// other platforms use "+" (Ctrl+Shift+S).
function formatShortcut(token: string, mac: boolean): string {
  return token
    .split('-')
    .map((part) => {
      if (part === 'Mod') return mac ? '⌘' : 'Ctrl';
      if (part === 'Alt') return mac ? '⌥' : 'Alt';
      if (part === 'Shift') return mac ? '⇧' : 'Shift';
      return part.toUpperCase();
    })
    .join(mac ? '' : '+');
}

// Same token in the ARIA-mandated form (proper modifier names, "+"-joined), so
// the shortcut reaches assistive tech — the visible tooltip is aria-hidden.
function ariaKeyshortcuts(token: string, mac: boolean): string {
  return token
    .split('-')
    .map((part) =>
      part === 'Mod'
        ? mac
          ? 'Meta'
          : 'Control'
        : part.toUpperCase().length === 1
          ? part.toUpperCase()
          : part,
    )
    .join('+');
}

export function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  shortcut,
  destructive,
  tooltipHidden,
  compact,
  accent,
  round,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  // Grays the button out and blocks clicks — for a command that would currently be a no-op
  // (e.g. accentEmphasis's `excludes` blocks bold/italic/strike on the selection). The
  // shortcut itself is unaffected by this (see guarded-toggle.ts): it already no-ops cleanly
  // without touching undo history, so this prop is purely a discoverability affordance.
  disabled?: boolean;
  // Set for icon-only buttons, where it supplies both the hover tooltip and the
  // accessible name (text buttons don't need it — their label is the text).
  title?: string;
  // A TipTap keymap token (e.g. 'Mod-b') for commands with a default shortcut;
  // shown in the tooltip so authors can discover the key. Icon buttons pair it
  // with `title` ("太字 Ctrl+B"); text buttons pass it alone (their label is
  // already visible, so the tooltip shows just the key).
  shortcut?: string;
  // Red tint for a destructive action (e.g. delete the whole table), so it reads as
  // "danger" and isn't mistaken for the neutral controls beside it.
  destructive?: boolean;
  // The same shape in the link blue, for the one control in a surface that commits what the
  // author typed there (the link card's 適用). The label carries the colour and the background
  // stays clear until hover — a filled button was tried and taken back out, because nothing else
  // in this editor's chrome is filled. Measured against the surfaces it sits on: 5.19 at rest and
  // 6.26 on hover in the light scheme, 4.81 and 6.50 in the dark one.
  accent?: boolean;
  // Suppress the visible tooltip while keeping the accessible name. Dropdown triggers
  // set this when open so the tooltip doesn't collide with the panel directly below.
  tooltipHidden?: boolean;
  // Tighter hit area (px-1.5 py-0.5 instead of px-2 py-1) for the tightly-packed
  // inline-mark cluster (B/I/S/code), where the default padding reads oversized.
  compact?: boolean;
  // Circular hover target instead of the rounded rectangle, for icon-only buttons that
  // sit in a floating card rather than in a row of the toolbar (LinkBubble). The square
  // hover fill reads as a segmented control when only three buttons share a card.
  round?: boolean;
  children: ReactNode;
}) {
  const tone = destructive
    ? 'text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950 dark:hover:text-red-300'
    : accent
      ? 'text-[#0969da] hover:bg-blue-50 hover:text-[#0757ba] dark:text-[#4493f8] dark:hover:bg-blue-950 dark:hover:text-[#6cb0ff]'
      : 'hover:bg-zinc-100 dark:hover:bg-zinc-800';
  const mac = isMac();
  const shortcutLabel = shortcut ? formatShortcut(shortcut, mac) : undefined;
  const hasTip = Boolean(title || shortcutLabel) && !tooltipHidden;
  return (
    // `group/tt relative` anchors the custom tooltip below the button. The native
    // `title` attribute is intentionally dropped (it renders near the cursor with
    // a browser-controlled delay) — `aria-label` keeps the accessible name,
    // `aria-keyshortcuts` exposes the key, and the span below is the visible
    // tooltip, centered under the button.
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      aria-label={title}
      aria-keyshortcuts={shortcut ? ariaKeyshortcuts(shortcut, mac) : undefined}
      className={`group/tt relative text-xs ${
        round ? 'rounded-full p-1.5' : `rounded ${compact ? 'px-1 py-1' : 'px-2 py-1'}`
      } ${tone} ${
        active ? 'bg-zinc-200 dark:bg-zinc-700' : ''
      } ${disabled ? 'pointer-events-none opacity-40' : ''}`}>
      {children}
      {hasTip && <EditorTooltip label={title} shortcut={shortcutLabel} />}
    </button>
  );
}
