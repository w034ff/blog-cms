import { Extension, type Editor } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { exitSuggestion, type SuggestionProps } from '@tiptap/suggestion';
import { SlashList, type SlashItem, type SlashListRef } from './SlashList';
import { CALLOUT_MENU_ORDER } from './callout-extension';
import { CALLOUT_TITLES, type CalloutType } from '@/lib/callout-types';
import { EMBED_PROVIDERS } from '@/lib/embed-provider';

// Extra search terms per callout type: the `:::` directive words plus the former name コールアウト.
const CALLOUT_KEYWORDS: Record<CalloutType, string[]> = {
  note: ['info', 'note', 'callout', 'コールアウト'],
  warning: ['danger', 'error', 'callout', 'コールアウト'],
  caution: ['warning', 'caution', 'callout', 'コールアウト'],
};

// The blocks the `/` menu can insert. Each row's `run` receives a chain that has already focused
// the editor and deleted the `/query`. Callout rows are prefixed 囲み枠（…） because 情報/注意/警告
// alone don't say which tool.
//
// `available` hides a row whose command would refuse, asked through `can()` so the menu can't
// drift from the extensions' rules. Local to this file: SlashList renders whatever it is handed.
type SlashEntry = SlashItem & { available?: (editor: Editor) => boolean };

const ITEMS: SlashEntry[] = [
  ...CALLOUT_MENU_ORDER.map<SlashEntry>((type) => ({
    id: `callout-${type}`,
    title: `囲み枠（${CALLOUT_TITLES[type]}）`,
    keywords: CALLOUT_KEYWORDS[type],
    run: (chain) => chain.setCallout(type),
    available: (editor) => editor.can().setCallout(type),
  })),
  {
    // アコーディオン, with 折りたたみ as a keyword (docs/accordion-requirements.md §7.3). `available`
    // is trustworthy only because setDetails is wrapped with the top-level placement check.
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
    // insertCodeBlock, not setCodeBlock, which is invalid in a list item's first paragraph.
    run: (chain) => chain.insertCodeBlock(),
    available: (editor) => editor.can().insertCodeBlock(),
  },
  {
    // One row for both card and embed (docs/embed-requirements.md §24.2,
    // docs/link-card-requirements.md §21): the pasted URL decides, and 「リンク」 names neither.
    // **Every provider name is a keyword**, so an author thinking 「youtube」 finds this row.
    // `openInsertDialog` reports whether either outcome could land, so a table cell drops the row.
    id: 'insert-link',
    title: 'リンク',
    keywords: [
      'link',
      'card',
      'linkcard',
      'link card',
      'リンク',
      'カード',
      // The old row's title, kept for muscle memory.
      'リンクカード',
      '記事',
      'embed',
      '埋め込み',
      '動画',
      'スライド',
      ...EMBED_PROVIDERS.map((provider) => provider.name),
      // The spellings a provider's own name does not cover: X's former name, and the two whose
      // registry name carries a space or a vendor.
      'twitter',
      'speakerdeck',
      'gist',
    ],
    run: (chain, range) => chain.openInsertDialog(range.from),
    available: (editor) => editor.can().openInsertDialog(),
  },
];

// Whether any row is available at the caret; otherwise `/` stays an ordinary character. Phrased
// over the rows, so a new row is covered by its own predicate.
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

// The `/` block-insert menu at the start of a line, on @tiptap/suggestion with SlashList as the UI.
export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: slashPluginKey,
        char: '/',
        startOfLine: true,
        // Inert in code, where `// comment` and `</div>` start lines (named explicitly because
        // setCallout still accepts there), and where no row is available.
        allow: ({ editor }) => !editor.isActive('codeBlock') && hasAnyItem(editor),
        placement: 'bottom-start',
        dismissOnOutsideClick: true,
        items: ({ query, editor }) => filterItems(query, editor),
        command: ({ editor, range, props }) => {
          props.run(editor.chain().focus().deleteRange(range), range).run();
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
