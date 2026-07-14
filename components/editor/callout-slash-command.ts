import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { exitSuggestion, type SuggestionProps } from '@tiptap/suggestion';
import {
  CalloutSlashList,
  type CalloutSlashItem,
  type CalloutSlashListRef,
} from './CalloutSlashList';
import { CALLOUT_TITLES, CALLOUT_TYPES, type CalloutType } from './callout-extension';

// Extra search terms per type, beyond the visible "囲み枠（…）" label (which already matches
// `/囲み`) — so `/info`, `/danger`, `/callout`, `/コ` all filter sensibly. Aligned with the
// `:::` directive words (info/warning/danger) plus the former name "コールアウト" (kept as an
// alias for discoverability).
const KEYWORDS: Record<CalloutType, string[]> = {
  note: ['info', 'note', 'callout', 'コールアウト'],
  warning: ['danger', 'error', 'callout', 'コールアウト'],
  caution: ['warning', 'caution', 'callout', 'コールアウト'],
};

// Prefix each row's visible label with the tool name so the `/` menu makes clear what gets
// inserted (the bare 情報/注意/警告 alone don't say "which tool"): 囲み枠（情報 / 注意 / 警告）.
const ITEMS: CalloutSlashItem[] = CALLOUT_TYPES.map((type) => ({
  type,
  title: `囲み枠（${CALLOUT_TITLES[type]}）`,
  keywords: KEYWORDS[type],
}));

// Match the query against the Japanese title or any keyword (both lower-cased).
function filterItems(query: string): CalloutSlashItem[] {
  const q = query.toLowerCase();
  return ITEMS.filter(
    (item) => item.title.includes(query) || item.keywords.some((k) => k.toLowerCase().includes(q)),
  );
}

const calloutSlashPluginKey = new PluginKey('calloutSlash');

// A `/` slash menu scoped to callouts: at the start of a line, `/` opens a caret-anchored
// menu of the three callout types; choosing one deletes the `/query` and inserts that callout
// through the shared setCallout command. Built on the official (headless) @tiptap/suggestion
// utility — the popup UI is CalloutSlashList, and positioning/outside-click come from the
// utility (its mount uses floating-ui, a peer dep it already pulls in).
export const CalloutSlashCommand = Extension.create({
  name: 'calloutSlashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<CalloutSlashItem, CalloutSlashItem>({
        editor: this.editor,
        pluginKey: calloutSlashPluginKey,
        char: '/',
        startOfLine: true,
        placement: 'bottom-start',
        dismissOnOutsideClick: true,
        items: ({ query }) => filterItems(query),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).setCallout(props.type).run();
        },
        render: () => {
          let component: ReactRenderer<
            CalloutSlashListRef,
            SuggestionProps<CalloutSlashItem, CalloutSlashItem>
          > | null = null;
          // mount() appends + positions the popup and returns its teardown (removes the
          // element and drops the floating-ui listeners); call it alongside destroy().
          let unmount: (() => void) | null = null;
          return {
            onStart: (props) => {
              component = new ReactRenderer(CalloutSlashList, { props, editor: props.editor });
              unmount = props.mount(component.element);
            },
            onUpdate: (props) => {
              component?.updateProps(props);
            },
            onKeyDown: (props) => {
              // Escape asks the plugin to exit, which runs onExit below (single cleanup path).
              if (props.event.key === 'Escape') {
                exitSuggestion(props.view, calloutSlashPluginKey);
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
