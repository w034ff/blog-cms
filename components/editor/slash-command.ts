import { Extension, type Editor } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { exitSuggestion, type SuggestionProps } from '@tiptap/suggestion';
import { SlashList, type SlashItem, type SlashListRef } from './SlashList';
import { CALLOUT_TITLES, CALLOUT_TYPES, type CalloutType } from './callout-extension';

// Extra search terms per callout type, beyond the visible "囲み枠（…）" label (which already
// matches `/囲み`) — so `/info`, `/danger`, `/callout`, `/コ` all filter sensibly. Aligned with
// the `:::` directive words (info/warning/danger) plus the former name "コールアウト" (kept as an
// alias for discoverability).
const CALLOUT_KEYWORDS: Record<CalloutType, string[]> = {
  note: ['info', 'note', 'callout', 'コールアウト'],
  warning: ['danger', 'error', 'callout', 'コールアウト'],
  caution: ['warning', 'caution', 'callout', 'コールアウト'],
};

// The blocks the `/` menu can insert. Each row's `run` receives a chain that has already focused
// the editor and deleted the `/query` text, and applies its block command onto it:
//  - callouts go through setCallout (which also switches an existing callout's type in place)
//  - the code block converts the now-empty line via setCodeBlock (`set`, not `toggle`, since the
//    line is empty); its NodeView's language <select>/filename field take over from there.
// Callout rows prefix the tool name so the menu makes clear what gets inserted (the bare
// 情報/注意/警告 alone don't say "which tool"): 囲み枠（情報 / 注意 / 警告）.
// `available` hides a row where its command would refuse to run, so the menu never offers a
// no-op. Kept local to this file rather than on SlashItem: which rows exist is a menu-population
// concern, and SlashList only renders whatever it is handed. Asking the command itself via
// `can()` — instead of re-testing the context here — means the menu can't drift from the rules
// in the extension: setCallout refuses inside a table and inside a blockquote (a quote is
// someone else's words, a callout the author's own aside), and still accepts inside an existing
// callout, where it switches that callout's type in place. The code block asks the same way and
// drops out inside a table cell, which is paragraph-only (table-extensions.ts: markdown's pipe
// form holds one line of inline content). A row with no predicate would always be offered.
type SlashEntry = SlashItem & { available?: (editor: Editor) => boolean };

const ITEMS: SlashEntry[] = [
  ...CALLOUT_TYPES.map<SlashEntry>((type) => ({
    id: `callout-${type}`,
    title: `囲み枠（${CALLOUT_TITLES[type]}）`,
    keywords: CALLOUT_KEYWORDS[type],
    run: (chain) => chain.setCallout(type),
    available: (editor) => editor.can().setCallout(type),
  })),
  {
    // アコーディオン, not 折りたたみ (§7.3, revised 2026-08-03). This row first read 折りたたみ,
    // to follow 囲み枠 above in preferring a native word — but that principle was never held:
    // the callout is 囲み枠 in this menu and コールアウト in its own refusal notice, and this
    // block's notice named it that way too. With the convention that thin, the author's own word
    // wins, and 折りたたみ stays a search keyword so either spelling finds the row.
    //
    // setDetails is top-level only (details-extension.ts), and `available` is what keeps the row
    // out of a quote, a list item or a cell — it can only be trusted because that command is
    // wrapped with the placement check; the official one accepts everywhere.
    id: 'details',
    title: 'アコーディオン',
    keywords: ['details', 'accordion', 'toggle', '折りたたみ', 'たたむ'],
    run: (chain) => chain.setDetails(),
    available: (editor) => editor.can().setDetails(),
  },
  {
    id: 'code-block',
    title: 'コードブロック',
    keywords: ['code', 'codeblock', 'code block', 'コード'],
    // insertCodeBlock, not setCodeBlock: inside a list item the latter is invalid (converting the
    // item's first paragraph would leave it headless) and dropped this row, while the block itself
    // is legal there — see code-block-extension.ts.
    run: (chain) => chain.insertCodeBlock(),
    available: (editor) => editor.can().insertCodeBlock(),
  },
  {
    // The card is inserted unresolved and its NodeView asks which post — the search is part of the
    // card, not a second popup on top of this one (docs/link-card-requirements.md §5.2-3).
    //
    // `available` carries the whole placement rule here, and it is half of §5.4: setLinkCard asks
    // canPlaceAfterCaret, so a table cell (`paragraph+`) and an accordion title (`text*`) drop the
    // row. The other half — a card arriving by paste or drop — is answered by the guards that were
    // already in place; see the note in link-card-extension.ts.
    id: 'link-card',
    title: 'リンクカード',
    keywords: ['link', 'card', 'linkcard', 'link card', 'リンク', 'カード', '記事'],
    run: (chain) => chain.setLinkCard(),
    available: (editor) => editor.can().setLinkCard(),
  },
];

// Whether the menu has anything at all to offer at the caret. Drives the trigger below, so a
// context where every row is unavailable — a table cell, where neither a callout nor a code
// block fits — leaves `/` an ordinary character instead of opening an empty popup. Phrased as
// "is any row available" rather than naming the contexts, so a row added later is covered by
// its own predicate without touching the trigger.
function hasAnyItem(editor: Editor): boolean {
  return ITEMS.some((item) => item.available?.(editor) ?? true);
}

// Match the query against the (Japanese) title or any keyword (both lower-cased), and drop rows
// whose command can't run where the caret currently is.
function filterItems(query: string, editor: Editor): SlashItem[] {
  const q = query.toLowerCase();
  return ITEMS.filter(
    (item) =>
      (item.available?.(editor) ?? true) &&
      (item.title.includes(query) || item.keywords.some((k) => k.toLowerCase().includes(q))),
  );
}

const slashPluginKey = new PluginKey('slashMenu');

// A `/` block-insert menu: at the start of a line, `/` opens a caret-anchored menu of the
// insertable blocks (callouts + code block); choosing one deletes the `/query` and runs that
// block's command. Built on the official (headless) @tiptap/suggestion utility — the popup UI is
// SlashList, and positioning/outside-click come from the utility (its mount uses floating-ui, a
// peer dep it already pulls in).
export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: slashPluginKey,
        char: '/',
        startOfLine: true,
        // Two separate reasons the trigger stays inert, so `/` is an ordinary keystroke rather
        // than a popup with nothing behind it.
        //
        // Code block: `/` is just a character there, and `startOfLine` puts the trigger exactly
        // where `// comment`, `</div>` and a leading path all begin, so the popup would fire on
        // ordinary code. This matches how the block markdown shortcuts already behave inside a
        // `code` textblock, where ProseMirror disables input rules and `# `, `- `, `> ` stay
        // literal. It needs naming explicitly because setCallout still *accepts* there (it
        // lands the callout after the block), so the emptiness test below wouldn't catch it.
        //
        // Nothing on offer: every row's command refuses at the caret — a table cell, where
        // neither a callout nor a code block fits. Opening a menu just to show an empty list
        // is worse than not opening.
        allow: ({ editor }) => !editor.isActive('codeBlock') && hasAnyItem(editor),
        placement: 'bottom-start',
        dismissOnOutsideClick: true,
        items: ({ query, editor }) => filterItems(query, editor),
        command: ({ editor, range, props }) => {
          props.run(editor.chain().focus().deleteRange(range)).run();
        },
        render: () => {
          let component: ReactRenderer<SlashListRef, SuggestionProps<SlashItem, SlashItem>> | null =
            null;
          // mount() appends + positions the popup and returns its teardown (removes the
          // element and drops the floating-ui listeners); call it alongside destroy().
          let unmount: (() => void) | null = null;
          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashList, { props, editor: props.editor });
              unmount = props.mount(component.element);
            },
            onUpdate: (props) => {
              component?.updateProps(props);
            },
            onKeyDown: (props) => {
              // Escape asks the plugin to exit, which runs onExit below (single cleanup path).
              if (props.event.key === 'Escape') {
                exitSuggestion(props.view, slashPluginKey);
                return true;
              }
              return component?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              unmount?.();
              unmount = null;
              component?.destroy();
              component = null;
            },
          };
        },
      }),
    ];
  },
});
