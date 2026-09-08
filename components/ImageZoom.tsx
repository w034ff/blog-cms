'use client';

import { useEffect } from 'react';

// Click a body image on a published post to see it filling the window
// (docs/cms-features.md「画像の拡大」). Enhances the server-rendered body the same way
// CodeCopyButtons and FootnotePopover do — the markup stays `dangerouslySetInnerHTML`, and this
// only attaches behaviour after mount. Renders nothing.
//
// **Published pages only, and that is a scoping decision, not an accident.** `.prose` is shared by
// the editor and the post page (globals.css says so throughout), and in the editor a click on an
// image already means "select this node" — the bubble menu. So both the cursor and this listener
// hang off `#post-body`, which is the post page's own container and already what the two
// components above are pointed at.

// The same octicon family CodeCopyButtons inlines, so the one other injected control on this page
// and this one are drawn by the same hand.
const CLOSE_ICON =
  '<svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"></path></svg>';

// The author's own images, and only those. Every picture this site draws as chrome carries a class
// (`.link-card-image`, the embed's, the house mark) while an author's cannot — `rehype-sanitize`
// allows no `className` on `img` — which is the same test `.prose img:not([class])` uses to style
// them. A linked image is left alone: the click belongs to the link.
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
    // **First child, and that placement is the point.** `showModal()` focuses the first focusable
    // descendant, and without this the dialog holds none — an image and a paragraph — so focus
    // landed on the dialog itself and nothing on screen said how to get back out. Escape works but
    // is invisible; the picture and the backdrop want a pointer. note carries the same control in
    // the same corner (measured 2026-09-08: PhotoSwipe, a 40x40 close button at the top right).
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

    // Whether the history entry below is ours to take back. Opening pushes one so the phone's back
    // gesture closes the picture instead of leaving the article — and closing any other way has to
    // pop it again, or the reader's next Back press would do nothing visible.
    let pushed = false;

    const open = (source: HTMLImageElement): void => {
      const text =
        source.closest('figure.image-figure')?.querySelector('figcaption')?.textContent?.trim() ??
        '';
      // `currentSrc`, so a responsive source resolves to what the reader is actually looking at.
      picture.src = source.currentSrc || source.src;
      picture.alt = source.alt;
      caption.textContent = text;
      caption.hidden = text === '';
      // The dialog needs a name and the picture usually has no alt to give it (uploads carry
      // none — useImageUpload.ts), so the caption is the first choice and 「画像」 the floor.
      dialog.setAttribute('aria-label', text || source.alt || '画像');

      // The footnote preview is a popover in the top layer and would otherwise sit over the
      // picture. Asked of every popover rather than of that component, so nothing here has to know
      // how it is built; `hidePopover` throws on one that is not open.
      document.querySelectorAll<HTMLElement>('[popover]').forEach((element) => {
        try {
          element.hidePopover();
        } catch {
          // not open
        }
      });

      dialog.showModal();
      history.pushState({ imageZoom: true }, '');
      pushed = true;
    };

    const onClick = (event: MouseEvent): void => {
      // Left button, no modifier: anything else is the reader asking the browser for something
      // (a new tab, a context menu, a text selection drag).
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const image = zoomable(event.target);
      if (image) open(image);
    };

    // `<dialog>` gives Escape and the backdrop for free; what it does not give is "click the
    // backdrop to close", because the backdrop is a pseudo-element and never a click target. The
    // dialog itself fills the viewport (globals.css), so a press that lands on the dialog rather
    // than on its children is a press on the empty space around the picture.
    //
    // The picture closes it too, and that pairing is the point: it is the element wearing the
    // `zoom-out` cursor, so clicking it has to do what the cursor says. Only the caption is left
    // out — it is text, and a press there is someone selecting it.
    const onDialogClick = (event: MouseEvent): void => {
      if (event.target === dialog || event.target === picture) dialog.close();
    };

    // Set while the `history.back()` below is in flight, so the popstate it causes is not read as
    // the reader pressing Back. Without it, closing and immediately opening another picture closed
    // that one too: `history.back()` is asynchronous, and its popstate landed after the reopen.
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
      // Before removing it, so the handler above does not fire a history.back() on unmount.
      pushed = false;
      dialog.remove();
    };
  }, [targetId]);

  return null;
}
