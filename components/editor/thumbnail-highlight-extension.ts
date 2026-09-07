import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// Rings whichever image node's `src` matches the post's chosen thumbnail path (ImageBubble.tsx),
// so the author can see which image is marked without opening its bubble menu.
//
// The path lives in `editor.storage`, the same place link-card-extension.ts keeps `ownSlug`:
// PostEditor writes it in an effect, and this plugin's decorations() reads it back through a
// closure over `this.storage`. Not plugin state pushed by a dispatched transaction — a standalone
// `editor.view.dispatch(...)` from a React effect runs every plugin's appendTransaction,
// including trailing-node-extension.ts's, at a moment with no relation to an actual edit, which
// is more machinery than this needs. PostEditor already re-renders on every `thumbnail` change
// and that render already reaches `view.updateState` (@tiptap/react's own setOptions call,
// unconditional), which is what asks this plugin for its decorations again.
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
    // Captured here, not read inline in decorations() below, for the same reason
    // link-card-extension.ts's ownSlug closure exists: `this` is the extension instance only
    // inside this method, not inside the plain function passed to `props`.
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
