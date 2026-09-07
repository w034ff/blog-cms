'use client';

import { useCallback, useMemo, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { BubbleMenu } from '@tiptap/react/menus';
import { ToolbarButton } from './ToolbarButton';
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
  // The post's chosen thumbnail path ('' = none chosen), so the button reads as a toggle: the
  // label stays 「サムネイルに設定」 either way, and only `active`'s highlight says whether this
  // image is the one.
  thumbnail: string;
  onSetThumbnail: (next: string) => void;
}) {
  // Stable identities, for the reason TableToolbar's own copies are: BubbleMenu dispatches a
  // transaction whenever shouldShow/appendTo/options/getReferencedVirtualElement change by
  // reference, and shouldRerenderOnTransaction re-renders this component with them — a fresh
  // closure each render would loop forever.
  const shouldShow = useCallback(() => selectedImage(editor) !== null, [editor]);
  const appendTo = useCallback(() => document.body, []);
  // The menu sits in the picture's own top-right corner rather than floating above the block.
  //
  // `top-start`, never `top-end`, and the difference is not cosmetic: floating-ui solves a
  // `-start` menu at `reference.left` and an `-end` one at `reference.right - floating.width`, so
  // only the latter measures this menu — and its buttons are React children of a portal, one
  // render behind the transaction that positions it (`canBeThumbnail` is false while nothing is
  // selected, so the element still holds 削除 alone at that moment). Measured on `top-end`: the
  // menu landed 107.05px past the picture's right edge, exactly the 105.05px button plus the gap,
  // and stayed there until an unrelated resize corrected it. The right edge is reached by a CSS
  // transform instead (globals.css), where `100%` resolves against this menu's own width at paint
  // time and can never be a render stale.
  //
  // The negative `mainAxis` is what brings it inside: `top-start` puts the menu above the
  // picture, and pulling it back down by its own height lands its top edge on the picture's.
  // Height is safe to measure where width is not — the menu is always one row.
  //
  // **Unless the picture is narrower than the menu**, in which case the menu would cover it
  // whole and the image could no longer be clicked to select it at all — measured, and it took
  // three of `e2e/thumbnail.spec.ts`'s cases down with `intercepts pointer events`. There the
  // menu goes back above the picture, its original place. `outsideRef` rather than deciding
  // again here: this and the transform below have to agree, and the width the offset callback
  // sees is the one that can be a render stale, so the decision is made once against the live
  // element in `getReferencedVirtualElement` and only read here.
  //
  // `flip` and `shift` are off. Both exist to keep a menu inside the viewport, and this one is
  // inside the picture, which is inside the column.
  const outsideRef = useRef(false);
  const options = useMemo(
    () => ({
      placement: 'top-start' as const,
      offset: ({ rects }: { rects: { floating: { height: number } } }) => ({
        mainAxis: outsideRef.current ? 8 : -rects.floating.height,
      }),
      flip: false,
      shift: false,
    }),
    [],
  );
  // The element the plugin's own `ref` hands back — the portal div the menu renders into.
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Anchored to the PICTURE's box, not the block's. `nodeDOM` returns `.image-block`, which is
  // column-wide (image-extension.ts), so anchoring there would leave the menu floating in the
  // empty column beside a centred picture rather than on it.
  //
  // The anchor's width is published to CSS here because this callback runs inside the plugin's
  // `updatePosition`, with the live box in hand. It is not React-rendered chrome, so unlike the
  // menu's own width it is never a render behind.
  const getReferencedVirtualElement = useCallback(() => {
    const image = selectedImage(editor);
    if (!image) return null;
    const block = editor.view.nodeDOM(image.from);
    if (!(block instanceof HTMLElement)) return null;
    const picture = block.querySelector<HTMLElement>('.image-box') ?? block;
    const width = picture.getBoundingClientRect().width;
    const menu = menuRef.current;
    // One decision, read by both the offset above and the transform in globals.css.
    outsideRef.current = menu !== null && width < menu.offsetWidth;
    menu?.classList.toggle('is-outside', outsideRef.current);
    menu?.style.setProperty('--anchor-width', `${width}px`);
    return {
      getBoundingClientRect: () => picture.getBoundingClientRect(),
      contextElement: picture,
    };
  }, [editor]);

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
      {canBeThumbnail && image && (
        <ToolbarButton
          active={isCurrentThumbnail}
          onClick={() => {
            // The button lives outside the editor's own DOM (BubbleMenu portals to <body>), so
            // clicking it leaves the editor blurred with its NodeSelection still standing —
            // unlike every command below, which routes through `editor.chain()` and refocuses as
            // part of that. onSetThumbnail is a plain React callback, not a chain, so nothing
            // else here would put focus back; every other button in this editor's chrome
            // (TableToolbar, LinkBubble, 削除 below) restores it the same way.
            onSetThumbnail(isCurrentThumbnail ? '' : image.src);
            editor.chain().focus().run();
          }}>
          {/* The label states the action, the way 削除 beside it does, so the button says both
              what is true now and what pressing it will do. Both strings are eight full-width
              characters, so the menu's width does not change — and the `active` fill stays as a
              second, glanceable cue, because the two labels differ in only three of those eight
              and a menu is read at a glance. */}
          {isCurrentThumbnail ? 'サムネイルを解除' : 'サムネイルに設定'}
        </ToolbarButton>
      )}
      <ToolbarButton destructive onClick={() => editor.chain().focus().deleteSelection().run()}>
        削除
      </ToolbarButton>
    </BubbleMenu>
  );
}
