import { Extension } from '@tiptap/core';
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
const ITEMS: SlashItem[] = [
  ...CALLOUT_TYPES.map<SlashItem>((type) => ({
    id: `callout-${type}`,
    title: `囲み枠（${CALLOUT_TITLES[type]}）`,
    keywords: CALLOUT_KEYWORDS[type],
    run: (chain) => chain.setCallout(type),
  })),
  {
    id: 'code-block',
    title: 'コードブロック',
    keywords: ['code', 'codeblock', 'code block', 'コード'],
    run: (chain) => chain.setCodeBlock(),
  },
];

// Match the query against the (Japanese) title or any keyword (both lower-cased).
function filterItems(query: string): SlashItem[] {
  const q = query.toLowerCase();
  return ITEMS.filter(
    (item) => item.title.includes(query) || item.keywords.some((k) => k.toLowerCase().includes(q)),
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
        placement: 'bottom-start',
        dismissOnOutsideClick: true,
        items: ({ query }) => filterItems(query),
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
