'use client';

import type { ReactNode } from 'react';
import { EditorTooltip } from './EditorTooltip';

// prosemirror-keymap's own `mac` test, which decides what `Mod` means, so the label names the key
// the keymap answers to. The guard only keeps an SSR pass from throwing. Exported so
// WritingHelpDialog makes the same ⌘/Ctrl choice.
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iP(hone|ad|od)/.test(navigator.platform);
}

// TipTap keymap token ("Mod-Shift-s") → the keys a reader presses, one per element ("Mod" is ⌘ on
// macOS, Ctrl elsewhere). WritingHelpDialog draws a cap per part.
export function shortcutParts(token: string, mac: boolean): string[] {
  return token.split('-').map((part) => {
    if (part === 'Mod') return mac ? '⌘' : 'Ctrl';
    if (part === 'Alt') return mac ? '⌥' : 'Alt';
    if (part === 'Shift') return mac ? '⇧' : 'Shift';
    // Only single letters are uppercased, to look like key caps; `Enter` keeps its spelling.
    return part.length === 1 ? part.toUpperCase() : part;
  });
}

// The same keys as one label, for the tooltip: ⌘⇧S on Mac, Ctrl+Shift+S elsewhere.
export function formatShortcut(token: string, mac: boolean): string {
  return shortcutParts(token, mac).join(mac ? '' : '+');
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
  historyControl,
  wide,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  // Greys the button out for a command that would currently be a no-op. Purely visual: the
  // shortcut already no-ops cleanly (guarded-toggle.ts).
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
  // Link blue for the one control that commits what the author typed (the link card's 適用). Not
  // filled, because nothing else in the chrome is. Contrast ≥ 4.8 in both schemes.
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
  // The undo/redo pair: 40px touch width like `wide`, plus manual flex centring
  // (`.toolbar-button-history`, app/globals.css), which `wide`'s span-wrapped content doesn't need.
  historyControl?: boolean;
  // 40px touch width (`.toolbar-button-wide`, `hover: none`); affordable because the row scrolls
  // rather than wraps (docs/editor-requirements.md §12.11).
  wide?: boolean;
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
    // `group/tt relative` anchors EditorTooltip. No native `title`: `aria-label` carries the name
    // and `aria-keyshortcuts` the key.
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      aria-label={title}
      aria-keyshortcuts={shortcut ? ariaKeyshortcuts(shortcut, mac) : undefined}
      // `toolbar-button` / `-round` are hooks for the touch-only rules in globals.css.
      className={`toolbar-button group/tt relative text-xs ${
        historyControl ? 'toolbar-button-history ' : ''
      }${wide ? 'toolbar-button-wide ' : ''}${
        round
          ? 'toolbar-button-round rounded-full p-1.5'
          : `rounded ${compact ? 'px-1 py-1' : 'px-2 py-1'}`
      } ${tone} ${
        active ? 'bg-zinc-200 dark:bg-zinc-700' : ''
      } ${disabled ? 'pointer-events-none opacity-40' : ''}`}>
      {children}
      {hasTip && <EditorTooltip label={title} shortcut={shortcutLabel} />}
    </button>
  );
}
