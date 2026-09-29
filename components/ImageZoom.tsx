'use client';

import { useEffect } from 'react';

// Click a body image on a published post to fill the window (docs/cms-features.md「画像の拡大」),
// attached after mount like CodeCopyButtons and FootnotePopover. **Published pages only**: `.prose`
// is shared with the editor, where a click selects the image, so everything hangs off `#post-body`.

// The octicon family CodeCopyButtons inlines.
const CLOSE_ICON =
  '<svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"></path></svg>';

// Author images only: chrome images carry a class and sanitize allows none on `img` (the test
// `.prose img:not([class])` uses). A linked image's click belongs to the link.
function zoomable(target: EventTarget | null): HTMLImageElement | null {
  if (!(target instanceof HTMLImageElement)) return null;
  if (target.getAttribute('class') !== null) return null;
  if (target.closest('a')) return null;
  return target;
}

export function ImageZoom({ targetId }: { targetId: string }) {
  useEffect(() => {
    const root = document.getElementById(targetId);
    if (!root) return;

    const dialog = document.createElement('dialog');
    dialog.className = 'image-zoom';
    // **First child, on purpose**: `showModal()` focuses the first focusable descendant, and
    // without it focus lands on the dialog with no visible way out. note puts it in the same
    // corner.
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'image-zoom-close';
    close.setAttribute('aria-label', '閉じる');
    close.innerHTML = CLOSE_ICON;
    const picture = document.createElement('img');
    const caption = document.createElement('p');
    caption.className = 'image-zoom-caption';
    dialog.append(close, picture, caption);
    document.body.appendChild(dialog);

    // Whether our history entry needs taking back: opening pushes one so a phone's back gesture
    // closes the picture, and any other close must pop it or the next Back does nothing visible.
    let pushed = false;

    const open = (source: HTMLImageElement): void => {
      const text =
        source.closest('figure.image-figure')?.querySelector('figcaption')?.textContent?.trim() ??
        '';
      // `currentSrc`: what the reader actually sees.
      picture.src = source.currentSrc || source.src;
      picture.alt = source.alt;
      caption.textContent = text;
      caption.hidden = text === '';
      // A name: the caption, else the alt (uploads have none, useImageUpload.ts), else 「画像」.
      dialog.setAttribute('aria-label', text || source.alt || '画像');

      // Close any top-layer popover (the footnote preview) over the picture, without knowing its
      // component; `hidePopover` throws on a closed one.
      document.querySelectorAll<HTMLElement>('[popover]').forEach((element) => {
        try {
          element.hidePopover();
        } catch {
          // not open
        }
      });

      // The open dialog hides the page's overflow (globals.css), which takes a classic scrollbar
      // away; keep its width so the page stays put. Only when one is showing: a short page has
      // none, and reserving one would shift it instead.
      if (window.innerWidth > document.documentElement.clientWidth) {
        document.documentElement.style.scrollbarGutter = 'stable';
      }
      dialog.showModal();
      history.pushState({ imageZoom: true }, '');
      pushed = true;
    };

    const onClick = (event: MouseEvent): void => {
      // Left button, no modifier; anything else is a request to the browser.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const image = zoomable(event.target);
      if (image) open(image);
    };

    // `::backdrop` is never a click target, but the dialog fills the viewport (globals.css), so a
    // press on the dialog itself is on the empty space. The picture closes it too, as its
    // `zoom-out` cursor promises; the caption does not (text selection).
    const onDialogClick = (event: MouseEvent): void => {
      if (event.target === dialog || event.target === picture) dialog.close();
    };

    // Set while our `history.back()` is in flight, so its asynchronous popstate is not read as Back
    // and does not close a picture opened in the meantime.
    let ownPop = false;

    const onPopState = (): void => {
      if (ownPop) {
        ownPop = false;
        return;
      }
      pushed = false;
      if (dialog.open) dialog.close();
    };

    const onClose = (): void => {
      document.documentElement.style.scrollbarGutter = '';
      if (!pushed) return;
      pushed = false;
      ownPop = true;
      history.back();
    };

    const onCloseClick = (): void => dialog.close();

    root.addEventListener('click', onClick);
    close.addEventListener('click', onCloseClick);
    dialog.addEventListener('click', onDialogClick);
    dialog.addEventListener('close', onClose);
    window.addEventListener('popstate', onPopState);

    return () => {
      root.removeEventListener('click', onClick);
      window.removeEventListener('popstate', onPopState);
      // Before removing it, so unmount does not call history.back().
      pushed = false;
      document.documentElement.style.scrollbarGutter = '';
      dialog.remove();
    };
  }, [targetId]);

  return null;
}
