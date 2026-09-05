import { Extension } from '@tiptap/core';
import { pasteRegex } from '@tiptap/extension-link';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { replaceSelectionClamped } from './isolating-boundary';

// `Link`'s own `linkOnPaste` (link-extension.ts, configured in extensions.ts) only asks whether the
// pasted content is a bare URL — never how big the selection it is about to mark is. And unlike an
// ordinary paste it does not replace that selection: `pasteHandler` (`extension-link/dist/index.js`,
// the `handlePasteLink` PluginKey) calls `setMark` on it, so the selected text survives and becomes
// the link's own label. Selecting the whole post (Ctrl+A) out of habit and pasting a URL from the
// clipboard turned every paragraph into a link to that URL, with no separate step to notice or undo
// before the next autosave persisted it — see docs/link-requirements.md §2.1's route (a).
//
// This guard narrows route (a) to a single paragraph. A selection confined to one paragraph still
// links on paste — that convenience is real, and Mod-k (LinkBubble.tsx) already covers everything
// wider on purpose. Once the selection crosses into a second paragraph, pasting a bare URL over it
// now does exactly what pasting anything else over it already does: replace the selection with the
// pasted text.
//
// Must be asked before Link's own pasteHandler so it can head it off — which array position alone
// cannot secure. `@tiptap/extension-link`'s Mark declares `priority: 1000` (`dist/index.js`,
// `priority: 1e3` on the mark passed to `Mark.create`), and `sortExtensions` in @tiptap/core sorts by
// that priority *before* it ever looks at array order — position (and the "array is asked in
// reverse" rule extensions.ts documents) only breaks ties between equal priorities. A first attempt
// at this guard sat below `Link.configure` in that array on the theory that position alone would do
// it; measured in e2e/editor-link-paste-paragraph-guard.spec.ts, Link's pasteHandler still ran first
// every time, because 100 (this extension's implicit default) never outranks 1000. Hence the
// explicit `priority: 1001` below — position in extensions.ts no longer matters for this ordering,
// only for tie-breaking against other default-priority extensions.
//
// Its position relative to the callout/details slice guards and IsolatingBoundary does not matter
// either way: the slice this guard ever acts on is plain text (a URL), never a node those guards
// would have opinions about, and `replaceSelectionClamped` already answers correctly if the
// selection also happens to cross an isolating edge — the case IsolatingBoundary exists for.
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

            // Same gate `pasteHandler` itself applies: only a paste whose entire content is one URL
            // is eligible to become a link. `pasteRegex` is exported by @tiptap/extension-link.
            let textContent = '';
            slice.content.forEach((node) => {
              textContent += node.textContent;
            });
            if (!textContent) return false;
            const matches = textContent.match(pasteRegex);
            if (!matches || matches.length !== 1 || matches[0] !== textContent) return false;

            // `doc.textBetween` inserts the separator at every block boundary it crosses, so a `\n`
            // in the result is exactly "this selection spans more than one paragraph."
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
