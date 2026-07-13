'use client';

import { useEffect } from 'react';

// GitHub octicon-style copy + check glyphs, inlined so the injected button is self-contained.
const COPY_ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>';
const CHECK_ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>';

const COPIED_MS = 1600;

// The code text. rehype-pretty-code wraps each line in a `[data-line]` element laid out as a
// grid row, so `code.textContent` would concatenate the lines with NO newlines — join the
// per-line text instead. Falls back to textContent if a block has no data-line wrappers.
function codeText(figure: Element): string {
  const lines = figure.querySelectorAll('[data-line]');
  if (lines.length > 0) {
    return Array.from(lines)
      .map((line) => line.textContent ?? '')
      .join('\n');
  }
  return figure.querySelector('code')?.textContent ?? '';
}

async function copyText(text: string): Promise<boolean> {
  // Clipboard API needs a secure context (https/localhost); fall back for LAN HTTP.
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

// Enhances the server-rendered post body (`#${targetId}`) by injecting a copy button into each
// code block. The body itself stays server-rendered (dangerouslySetInnerHTML); this only adds
// the interactive control after mount. Renders nothing.
export function CodeCopyButtons({ targetId }: { targetId: string }) {
  useEffect(() => {
    const root = document.getElementById(targetId);
    if (!root) return;

    const added: HTMLButtonElement[] = [];
    const timers: number[] = [];

    root.querySelectorAll('[data-rehype-pretty-code-figure]').forEach((figure) => {
      if (figure.querySelector('.code-copy-btn')) return; // idempotent

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'code-copy-btn';
      button.setAttribute('aria-label', 'コードをコピー');

      // "Copied!" text sits LEFT of the icon (GitHub-style); empty until a successful copy.
      const label = document.createElement('span');
      label.className = 'code-copy-label';
      label.setAttribute('aria-live', 'polite');

      const icon = document.createElement('span');
      icon.className = 'code-copy-icon';
      icon.innerHTML = COPY_ICON;

      button.append(label, icon);

      button.addEventListener('click', async () => {
        if (!(await copyText(codeText(figure)))) return;
        button.classList.add('is-copied');
        label.textContent = 'Copied!';
        icon.innerHTML = CHECK_ICON;
        const timer = window.setTimeout(() => {
          button.classList.remove('is-copied');
          label.textContent = '';
          icon.innerHTML = COPY_ICON;
        }, COPIED_MS);
        timers.push(timer);
      });

      figure.appendChild(button);
      added.push(button);
    });

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      added.forEach((button) => button.remove());
    };
  }, [targetId]);

  return null;
}
