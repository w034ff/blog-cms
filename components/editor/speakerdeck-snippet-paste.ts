import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { speakerdeckSnippetHref } from '@/lib/speakerdeck-snippet';

// Pasting Speaker Deck's embed snippet makes the embed (docs/embed-requirements.md §16.9).
//
// **This is the one place a paste creates a block, and §5 says paste is not a trigger.** That rule
// protects a real thing — a bare URL has to stay pasteable as a plain link, and §0's own YouTube
// line is that shape. A snippet is not a bare URL: measured 2026-08-26, pasting one today puts
// `<iframe class="speakerdeck-iframe" …>` into the paragraph as literal text with its `src`
// autolinked, which is nobody's intent. So the exception is narrow by construction — the paste has
// to *begin* with `<iframe` or `<script` and carry a reference `resolveEmbed` accepts
// (lib/speakerdeck-snippet.ts), and everything else falls through untouched.
//
// A code block is left alone, which is where "I am writing about this snippet" actually lives. The
// question is asked of the node the caret is in rather than of the code block type, so any node
// declaring `code` in its spec answers for itself.
//
// The clipboard is read as `text/plain` because that is what Speaker Deck's own buttons write
// (`data-clipboard-text`, measured). A copy of *rendered* markup carries `text/html` instead, and is
// not handled: the schema drops the iframe and nothing lands, which is what happens today.
const speakerdeckSnippetPasteKey = new PluginKey('speakerdeckSnippetPaste');

export const SpeakerdeckSnippetPaste = Extension.create({
  name: 'speakerdeckSnippetPaste',
  addProseMirrorPlugins() {
    const { editor } = this;
    return [
      new Plugin({
        key: speakerdeckSnippetPasteKey,
        props: {
          handlePaste(view, event) {
            if (view.state.selection.$from.parent.type.spec.code) return false;
            const text = event.clipboardData?.getData('text/plain') ?? '';
            if (text === '') return false;
            const href = speakerdeckSnippetHref(text);
            if (href === null) return false;
            // False when the embed cannot be placed here (a table cell, an accordion title): the
            // paste then does what it does today rather than being swallowed.
            //
            // `uiEvent: 'paste'` is what every other handlePaste in this editor sets
            // (link-paste-paragraph-guard.ts, the two slice guards, isolating-boundary.ts) — it is
            // read by prosemirror-history to close the current event, so a paste is not grouped
            // with the typing before it. Measured here as already separate without it (the block
            // insertion is not adjacent to the typing), and set anyway: nothing should depend on
            // the shape of that grouping heuristic.
            return editor.chain().setEmbed(href).setMeta('uiEvent', 'paste').run();
          },
        },
      }),
    ];
  },
});
