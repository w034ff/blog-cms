'use client';

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { BubbleMenu } from '@tiptap/react/menus';
import { ToolbarButton } from './ToolbarButton';
import { CaptionIcon } from './svg/CaptionIcon';
import { TrashIcon } from './svg/TrashIcon';
import { isCaptionParagraph } from './image-caption-extension';
import { isUploadPath } from '@/lib/thumbnail';

// The image under a NodeSelection, or null — including for a range that merely contains one, where
// 削除's deleteSelection would take the whole range.
function selectedImage(editor: Editor): { from: number; src: string } | null {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image') return null;
  const { src } = selection.node.attrs;
  return { from: selection.from, src: typeof src === 'string' ? src : '' };
}

// What globals.css needs to place the menu: the anchor's width, and whether the picture is wide
// enough to host the menu in its corner (otherwise it stays above, where `top-start` puts it).
//
// **Only true after React has committed** (docs/editor-pitfalls.md §10.5): the positioning
// callback sees the previous render's menu. So the layout effect below owns this call; the
// callback borrows it only for the plugin's `resizeHandler`, which runs with no render.
function fitMenuToPicture(menu: HTMLElement, block: HTMLElement, picture: HTMLElement): void {
  const width = picture.getBoundingClientRect().width;
  menu.style.setProperty('--anchor-width', `${width}px`);
  // The picture's inset within the block floating-ui is anchored to; re-read at paint, unlike the
  // captured reference.
  menu.style.setProperty(
    '--anchor-left',
    `${picture.getBoundingClientRect().left - block.getBoundingClientRect().left}px`,
  );
  menu.style.setProperty(
    '--anchor-top',
    `${picture.getBoundingClientRect().top - block.getBoundingClientRect().top}px`,
  );
  // `syncClassName` assigns `className` wholesale; the layout effect rewrites this before paint.
  menu.classList.toggle('is-outside', width < menu.offsetWidth);
}

// Where the caption goes: the paragraph directly after the image (docs/cms-features.md
// 「画像キャプション」), judged by the decoration's own `isCaptionParagraph`. An empty paragraph there
// (TrailingNode's, after the last image) is reused rather than leaving a stray blank one.
function captionSpot(
  editor: Editor,
  from: number,
): { insertAt: number | null; caretAt: number } | null {
  const image = editor.state.doc.nodeAt(from);
  if (!image) return null;
  const after = from + image.nodeSize;
  const next = editor.state.doc.nodeAt(after);
  if (next?.type.name === 'paragraph') {
    // An existing caption is edited, not replaced: the caret goes to its end.
    if (isCaptionParagraph(next)) return { insertAt: null, caretAt: after + 1 + next.content.size };
    if (next.content.size === 0) return { insertAt: null, caretAt: after + 1 };
  }
  return { insertAt: after, caretAt: after + 1 };
}

// The floating menu over a selected image. The thumbnail toggle is gated on `isUploadPath`: the
// server coerces anything else to '' (app/actions/posts.ts).
export function ImageBubble({
  editor,
  thumbnail,
  onSetThumbnail,
}: {
  editor: Editor;
  // The post's chosen thumbnail path ('' = none chosen).
  thumbnail: string;
  onSetThumbnail: (next: string) => void;
}) {
  // Stable identities, as in TableToolbar, or BubbleMenu's re-dispatch loops forever.
  const shouldShow = useCallback(() => selectedImage(editor) !== null, [editor]);
  const appendTo = useCallback(() => document.body, []);
  // **floating-ui is never told where the picture's corner is.** It solves `top-start`, which
  // measures nothing about the menu; CSS carries it into the corner, where a transform's `100%`
  // resolves at paint. `top-end` would measure a menu one render stale (docs/editor-pitfalls.md
  // §13.2). `offset: 0`: the gap for a picture too narrow is `.is-outside`'s. No `flip`/`shift`:
  // the menu stays inside the picture.
  const options = useMemo(
    () => ({ placement: 'top-start' as const, offset: 0, flip: false, shift: false }),
    [],
  );
  // The element the plugin's own `ref` hands back — the portal div the menu renders into.
  const menuRef = useRef<HTMLDivElement | null>(null);
  // `nodeDOM` returns `.image-block`, which is column-wide (image-extension.ts).
  const blockBox = useCallback((): HTMLElement | null => {
    const image = selectedImage(editor);
    if (!image) return null;
    const block = editor.view.nodeDOM(image.from);
    return block instanceof HTMLElement ? block : null;
  }, [editor]);
  // The picture inside it — narrower than the block whenever the image is narrower than the
  // column, which is what the empty column beside a centred picture is.
  const pictureBox = useCallback((): HTMLElement | null => {
    const block = blockBox();
    return block ? (block.querySelector<HTMLElement>('.image-box') ?? block) : null;
  }, [blockBox]);
  // **The BLOCK is the anchor, not the picture — a correctness fix.** The plugin asks once, and a
  // pasted image is selected while its bitmap is still `0x0`, so a picture anchor froze the menu in
  // the wrong place. The block's horizontal box does not depend on the bitmap; the picture's width
  // and inset go through custom properties that `fitMenuToPicture` rewrites each render. This also
  // removes the last path that could measure the menu itself (criterion 22f).
  const getReferencedVirtualElement = useCallback(() => {
    const block = blockBox();
    const picture = pictureBox();
    if (!block || !picture) return null;
    const menu = menuRef.current;
    if (menu) fitMenuToPicture(menu, block, picture);
    return {
      getBoundingClientRect: () => block.getBoundingClientRect(),
      contextElement: block,
    };
  }, [blockBox, pictureBox]);
  // No dependency array: it measures each committed render, before paint.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const block = blockBox();
    const picture = pictureBox();
    if (menu && block && picture) fitMenuToPicture(menu, block, picture);
  });

  const image = selectedImage(editor);
  const isCurrentThumbnail = image !== null && thumbnail !== '' && image.src === thumbnail;
  const canBeThumbnail = image !== null && isUploadPath(image.src);

  return (
    <BubbleMenu
      editor={editor}
      pluginKey='imageMenu'
      // Required for a NodeSelection menu: otherwise the 250ms debounce delays showing it
      // (docs/editor-pitfalls.md §13.2).
      updateDelay={0}
      shouldShow={shouldShow}
      appendTo={appendTo}
      options={options}
      getReferencedVirtualElement={getReferencedVirtualElement}
      ref={menuRef}
      // The look is in globals.css, which has to reach inside ToolbarButton's utilities.
      className='image-bubble z-20 flex bg-white dark:bg-zinc-900'>
      {image && (
        <ToolbarButton
          title='キャプション'
          onClick={() => {
            const spot = captionSpot(editor, image.from);
            if (!spot) return;
            const chain = editor.chain();
            if (spot.insertAt !== null) chain.insertContentAt(spot.insertAt, { type: 'paragraph' });
            // No scroll: the caption is right under the picture being looked at. `setItalic`, not
            // `toggleItalic`: pressing twice must leave the caption a caption.
            chain.focus(spot.caretAt, { scrollIntoView: false }).setItalic().run();
          }}>
          {/* 「キャプション」 is on `title`: 注釈 reads as a footnote and 説明 is the post's own
              field. */}
          <CaptionIcon />
        </ToolbarButton>
      )}
      {canBeThumbnail && image && (
        <ToolbarButton
          active={isCurrentThumbnail}
          title={isCurrentThumbnail ? 'サムネイルを解除' : 'サムネイルに設定'}
          onClick={() => {
            onSetThumbnail(isCurrentThumbnail ? '' : image.src);
            // Refocus, since the portalled button blurred the editor and `onSetThumbnail` is not a
            // chain. `scrollIntoView: false`, or a NodeSelection's `delayedFocus` scrolls the whole
            // block into view under the sticky toolbar (docs/editor-pitfalls.md §13.4).
            editor.chain().focus(null, { scrollIntoView: false }).run();
          }}>
          {/* **The one visible word:** it names a state, which a glyph would have to be learnt to
              read. The action is in `title`, whose names contain the word (WCAG SC 2.5.3). */}
          サムネイル
        </ToolbarButton>
      )}
      <ToolbarButton
        destructive
        title='削除'
        onClick={() => editor.chain().focus().deleteSelection().run()}>
        <TrashIcon />
      </ToolbarButton>
    </BubbleMenu>
  );
}
