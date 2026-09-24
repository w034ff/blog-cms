import { Extension } from '@tiptap/core';
import { pasteRegex } from '@tiptap/extension-link';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { replaceSelectionClamped } from './isolating-boundary';

// `Link`'s `linkOnPaste` marks the selection rather than replacing it (`pasteHandler`, the
// `handlePasteLink` PluginKey), so pasting a URL over a Ctrl+A selection linked every paragraph
// (docs/link-requirements.md §2.1 route (a)). This narrows that to a single paragraph: across
// paragraphs, a pasted URL replaces the selection like any other paste. Mod-k covers wider links.
//
// **Must run before Link's pasteHandler, which array position cannot secure.** The link mark
// declares `priority: 1e3` in dist, and `sortExtensions` (@tiptap/core) sorts by priority before
// array order; placing this below `Link.configure` at the default 100 measurably lost. Hence 1001.
// Order against the slice guards does not matter: this only acts on a plain-text URL, and
// `replaceSelectionClamped` handles isolating edges.
const linkPasteParagraphGuardKey = new PluginKey('linkPasteParagraphGuard');

export const LinkPasteParagraphGuard = Extension.create({
  name: 'linkPasteParagraphGuard',
  priority: 1001,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: linkPasteParagraphGuardKey,
        props: {
          handlePaste(view, _event, slice) {
            const { state } = view;
            const { selection } = state;
            if (selection.empty) return false;

            // The gate `pasteHandler` applies: the whole paste is one URL.
            let textContent = '';
            slice.content.forEach((node) => {
              textContent += node.textContent;
            });
            if (!textContent) return false;
            const matches = textContent.match(pasteRegex);
            if (!matches || matches.length !== 1 || matches[0] !== textContent) return false;

            // `textBetween` puts the separator at each block boundary, so `\n` means "spans blocks".
            const selectedText = state.doc.textBetween(selection.from, selection.to, '\n');
            if (!selectedText.includes('\n')) return false;

            view.dispatch(
              replaceSelectionClamped(state, slice)
                .scrollIntoView()
                .setMeta('paste', true)
                .setMeta('uiEvent', 'paste'),
            );
            return true;
          },
        },
      }),
    ];
  },
});
