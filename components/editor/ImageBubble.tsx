'use client';

import { useCallback, useMemo } from 'react';
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
  // `top-start`, the placement TableToolbar and LinkBubble already use, because it is the one
  // whose x does not depend on this menu's own width: floating-ui puts a `-start` menu at
  // `reference.left`, where `top-end` computes `reference.right - floating.width`. The buttons are
  // React children of a portal, so the element the plugin measures is one render behind whenever
  // the selection changes — `canBeThumbnail` is false while nothing is selected, so at the moment
  // the plugin positions the menu it still holds 削除 alone. Measured on `top-end`: the menu
  // landed 107.05px right of the image's right edge, exactly the 105.05px サムネイルに設定 button
  // plus the 2px `gap-0.5`, and stayed there until an unrelated resize repositioned it (0.02px).
  // A width-independent placement removes the dependency rather than trying to time around it.
  const options = useMemo(
    () => ({ placement: 'top-start' as const, offset: 8, flip: true, shift: { padding: 8 } }),
    [],
  );
  // Anchored to the selected image's own element, the same way the table toolbar pins to a cell.
  const getReferencedVirtualElement = useCallback(() => {
    const image = selectedImage(editor);
    if (!image) return null;
    const dom = editor.view.nodeDOM(image.from);
    return dom instanceof Element
      ? { getBoundingClientRect: () => dom.getBoundingClientRect(), contextElement: dom }
      : null;
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
      className='image-bubble z-20 flex items-center gap-0.5 rounded border border-zinc-300 bg-white px-1 py-0.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900'>
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
          サムネイルに設定
        </ToolbarButton>
      )}
      <ToolbarButton destructive onClick={() => editor.chain().focus().deleteSelection().run()}>
        削除
      </ToolbarButton>
    </BubbleMenu>
  );
}
