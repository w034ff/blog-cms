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

// The image node the caret is on, as a NodeSelection — clicking an image (or its drag handle)
// already produces one, the same fact block-drag-handle.ts's DRAGGABLE_TYPES relies on. Anything
// else, including a ranged selection that merely contains an image, answers null: a ranged
// deleteSelection there would take the whole range, not just this image, so 削除 below must not
// be offered for it.
function selectedImage(editor: Editor): { from: number; src: string } | null {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image') return null;
  const { src } = selection.node.attrs;
  return { from: selection.from, src: typeof src === 'string' ? src : '' };
}

// The two things globals.css needs to place the menu: the anchor's width, and whether the picture
// can host the menu at all. A picture narrower than the menu cannot — fitted into its corner the
// menu overhangs to the left and covers the picture's top band, and at 120x24 covers it whole —
// so there the menu stays above the picture, where `top-start` already puts it.
//
// **The comparison is only true after React has committed.** The menu's width is React's:
// `@tiptap/core`'s `dispatchTransaction` runs `view.updateState` — and with it the plugin's
// `updatePosition` — before it emits `transaction`, which is what re-renders this component. So a
// decision taken inside the positioning callback measures the PREVIOUS render's menu: the delete
// button alone (35.6px) on the first show after a deselect, where the committed menu is 142.9px
// (measured 2026-09-08; 44px and 151px before the labels became icons). Measured 2026-09-07: every
// picture between those two widths was given the corner and covered by it.
//
// Which is why the layout effect below owns this call, and the positioning callback only borrows
// it. The callback's copy covers the one path that reaches here with no render at all — the
// plugin's `resizeHandler`, where a window resize can shrink a `max-width: 100%` picture under a
// menu whose width is already settled.
function fitMenuToPicture(menu: HTMLElement, picture: HTMLElement): void {
  const width = picture.getBoundingClientRect().width;
  menu.style.setProperty('--anchor-width', `${width}px`);
  // `@tiptap/react`'s `syncClassName` assigns `element.className` wholesale, so a class written
  // from the positioning callback would be dropped by the render that follows it. React runs a
  // child's layout effects before its parent's and the menu is the child, so the effect below
  // always writes this back within the same commit, before paint.
  menu.classList.toggle('is-outside', width < menu.offsetWidth);
}

// Where the caption goes and whether one is already there. The convention is a whole paragraph of
// italic text directly after the image (docs/cms-features.md「画像キャプション」), so this button
// only has to reach that one position — `isCaptionParagraph` is imported rather than restated
// because the editor's decoration answers the same question and the two must not drift.
//
// Three cases, and the middle one is why this is not simply an insert: TrailingNode always keeps a
// paragraph at the end of the document, so pressing this on the last image in a post almost always
// finds an empty paragraph already sitting where the caption belongs. Inserting there would leave a
// stray blank one behind.
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

// The floating menu over a selected image: 削除 always, plus a thumbnail toggle gated on
// `isUploadPath` — the server coerces anything else back to '' (app/actions/posts.ts), so an
// ungated button would silently do nothing on save. Sibling of TableToolbar/LinkBubble, not a
// NodeView: same reason as those, a NodeSelection carries no editing state of its own to keep.
export function ImageBubble({
  editor,
  thumbnail,
  onSetThumbnail,
}: {
  editor: Editor;
  // The post's chosen thumbnail path ('' = none chosen). It is what makes the button a toggle:
  // both its label and its `active` highlight are read off whether this image is the one.
  thumbnail: string;
  onSetThumbnail: (next: string) => void;
}) {
  // Stable identities, for the reason TableToolbar's own copies are: BubbleMenu dispatches a
  // transaction whenever shouldShow/appendTo/options/getReferencedVirtualElement change by
  // reference, and shouldRerenderOnTransaction re-renders this component with them — a fresh
  // closure each render would loop forever.
  const shouldShow = useCallback(() => selectedImage(editor) !== null, [editor]);
  const appendTo = useCallback(() => document.body, []);
  // The menu sits in the picture's own top-right corner rather than floating above the block, and
  // **floating-ui is never told where that corner is.** It solves `top-start`, which is
  // `reference.left` and measures nothing about this menu; CSS carries the menu from there into
  // the corner (globals.css), where `100%` in a transform resolves against the menu's own box at
  // paint time and so can never be a render behind. `top-end` would have been the direct route
  // and is unusable for exactly that reason — it solves x as `reference.right - floating.width`,
  // measuring a menu whose buttons are React children of a portal, one render behind the
  // transaction that positions it (`canBeThumbnail` is false while nothing is selected, so the
  // element still holds 削除 alone at that moment). Measured on `top-end`: 107.05px past the
  // picture's right edge, exactly the 105.05px button plus the gap, and it stayed there until an
  // unrelated resize corrected it.
  //
  // `offset: 0`, so the placement is the picture's top edge and nothing else. The 8px gap the
  // menu takes when it cannot fit belongs to that one case, and that case is a CSS class
  // (`.is-outside`, set by `fitMenuToPicture`) — one number, in one file.
  //
  // `flip` and `shift` are off. Both exist to keep a menu inside the viewport, and this one is
  // inside the picture, which is inside the column.
  const options = useMemo(
    () => ({ placement: 'top-start' as const, offset: 0, flip: false, shift: false }),
    [],
  );
  // The element the plugin's own `ref` hands back — the portal div the menu renders into.
  const menuRef = useRef<HTMLDivElement | null>(null);
  // The PICTURE's box, not the block's. `nodeDOM` returns `.image-block`, which is column-wide
  // (image-extension.ts), so anchoring there would leave the menu floating in the empty column
  // beside a centred picture rather than on it.
  const pictureBox = useCallback((): HTMLElement | null => {
    const image = selectedImage(editor);
    if (!image) return null;
    const block = editor.view.nodeDOM(image.from);
    if (!(block instanceof HTMLElement)) return null;
    return block.querySelector<HTMLElement>('.image-box') ?? block;
  }, [editor]);
  const getReferencedVirtualElement = useCallback(() => {
    const picture = pictureBox();
    if (!picture) return null;
    const menu = menuRef.current;
    if (menu) fitMenuToPicture(menu, picture);
    return {
      getBoundingClientRect: () => picture.getBoundingClientRect(),
      contextElement: picture,
    };
  }, [pictureBox]);
  // No dependency array: what this measures is the render itself — the menu's committed width —
  // so it has to run after every one of them, and before paint, which is why it is a layout
  // effect rather than a passive one.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const picture = pictureBox();
    if (menu && picture) fitMenuToPicture(menu, picture);
  });

  const image = selectedImage(editor);
  const isCurrentThumbnail = image !== null && thumbnail !== '' && image.src === thumbnail;
  const canBeThumbnail = image !== null && isUploadPath(image.src);

  return (
    <BubbleMenu
      editor={editor}
      pluginKey='imageMenu'
      // A NodeSelection on an image is never empty (`to === from + 1`, it is a leaf atom), so
      // `hasValidSelection` in the plugin's `update` is always true here and the default 250ms
      // debounce (`updateDelay > 0` is what gates it) runs on the very click that selects the
      // image — before `shouldShow` is even consulted. That is the whole delay between clicking an
      // image and this menu appearing. `0` takes the synchronous branch instead. TableToolbar and
      // LinkBubble pass the same `0` for a different reason (a stale position after a block drag).
      updateDelay={0}
      shouldShow={shouldShow}
      appendTo={appendTo}
      options={options}
      getReferencedVirtualElement={getReferencedVirtualElement}
      ref={menuRef}
      // Everything about how this reads — flush into the corner, square, one hard border, a
      // divider between the items — is in globals.css, because it has to reach inside
      // ToolbarButton's own utilities and the reasons are worth a paragraph each.
      className='image-bubble z-20 flex bg-white dark:bg-zinc-900'>
      {image && (
        <ToolbarButton
          title='キャプション'
          onClick={() => {
            const spot = captionSpot(editor, image.from);
            if (!spot) return;
            const chain = editor.chain();
            if (spot.insertAt !== null) chain.insertContentAt(spot.insertAt, { type: 'paragraph' });
            // `scrollIntoView: false` for the thumbnail toggle's measured reason below. Unlike that
            // one this focus carries a position, so it never takes the `delayedFocus` branch — but
            // the caption sits directly under the picture the author is looking at either way, and
            // nothing here asked the page to move.
            //
            // `setItalic`, not `toggleItalic`: the guarded toggle exists for accentEmphasis's
            // exclusion (guarded-toggle-marks.ts) and the point here is to state the mark, not to
            // flip it — pressing this twice must leave the caption a caption.
            chain.focus(spot.caretAt, { scrollIntoView: false }).setItalic().run();
          }}>
          {/* The word itself is on the button's `title`, which is both the tooltip and the
              accessible name — 「キャプション」 is note's own for this field, and the two shorter
              candidates are taken by something else in this editor: 注釈 reads as the footnote
              (footnote-literal-extension.ts) and 説明 is both the post form's own field and what an
              alt-text control would have to be called. */}
          <CaptionIcon />
        </ToolbarButton>
      )}
      {canBeThumbnail && image && (
        <ToolbarButton
          active={isCurrentThumbnail}
          title={isCurrentThumbnail ? 'サムネイルを解除' : 'サムネイルに設定'}
          onClick={() => {
            // The button lives outside the editor's own DOM (BubbleMenu portals to <body>), so
            // clicking it leaves the editor blurred with its NodeSelection still standing —
            // unlike every command below, which routes through `editor.chain()` and refocuses as
            // part of that. onSetThumbnail is a plain React callback, not a chain, so nothing
            // else here would put focus back; every other button in this editor's chrome
            // (TableToolbar, LinkBubble, 削除 below) restores it the same way.
            onSetThumbnail(isCurrentThumbnail ? '' : image.src);
            // `scrollIntoView: false`, or pressing this button scrolls the page. A NodeSelection
            // takes @tiptap/core's focus command down its `delayedFocus` branch (`position === null
            // && !isTextSelection`), which runs `editor.commands.scrollIntoView()` in a rAF — and
            // prosemirror-view then scrolls the whole *block* into view against the window, which
            // knows nothing about the sticky toolbar. Measured 2026-09-08 with the picture's bottom
            // 82px below the fold: the page jumped 87px on the press, exactly `rect.bottom -
            // window.bottom + scrollMargin` (dist's `scrollRectIntoView`, the `getSide(scrollMargin,
            // "bottom")` branch), and a picture taller than the viewport takes the branch above it
            // and lands its top under the toolbar instead.
            //
            // Nothing here asked to be scrolled to: the author is looking at the picture and just
            // pressed a button drawn on it. Focus still has to be restored — the button lives
            // outside the editor's DOM (BubbleMenu portals to <body>), so clicking it leaves the
            // editor blurred with its NodeSelection still standing, and `onSetThumbnail` is a plain
            // React callback, not a chain that would refocus on its own. `view.focus()` itself uses
            // `focusPreventScroll`, so dropping the scroll leaves nothing that moves the page.
            editor.chain().focus(null, { scrollIntoView: false }).run();
          }}>
          {/* **The one word this menu keeps.** Its two neighbours say what they do with a picture,
              which a glyph can carry; this one says which of two states the picture is in, and a
              glyph would have to be learnt before it could be read. So the noun stays visible and
              the action moves to `title` — 「サムネイルに設定」/「サムネイルを解除」, the tooltip
              and the accessible name, which is where the state is stated in words. The `active`
              fill is the glanceable half of the same answer.

              The visible word is a substring of both, which is what WCAG SC 2.5.3 asks of a
              control whose accessible name is longer than its label. */}
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
