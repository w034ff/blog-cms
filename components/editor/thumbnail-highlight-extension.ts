import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// Rings whichever image node's `src` matches the post's chosen thumbnail path (ImageBubble.tsx),
// so the author can see which image is marked without opening its bubble menu.
//
// The path lives in `editor.storage` (like link-card-extension.ts's `ownSlug`), not plugin state:
// a dispatch from a React effect would run every appendTransaction for no edit
// (docs/editor-pitfalls.md §13.1). PostEditor's re-render already reaches `view.updateState`,
// which re-asks for decorations.
export type ThumbnailHighlightStorage = { path: string };

declare module '@tiptap/core' {
  interface Storage {
    thumbnailHighlight: ThumbnailHighlightStorage;
  }
}

export const ThumbnailHighlight = Extension.create({
  name: 'thumbnailHighlight',

  addStorage(): ThumbnailHighlightStorage {
    return { path: '' };
  },

  addProseMirrorPlugins() {
    // Captured here: `this` is the extension only inside this method, not inside `props`.
    const path = () => this.storage.path;
    return [
      new Plugin({
        key: new PluginKey('thumbnailHighlight'),
        props: {
          decorations(state) {
            const current = path();
            if (!current) return null;
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name === 'image' && node.attrs.src === current) {
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, { class: 'thumbnail-image' }),
                );
              }
            });
            return decorations.length > 0 ? DecorationSet.create(state.doc, decorations) : null;
          },
        },
      }),
    ];
  },
});
