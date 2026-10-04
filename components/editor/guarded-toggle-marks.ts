import { Bold as BaseBold } from '@tiptap/extension-bold';
import { Italic as BaseItalic } from '@tiptap/extension-italic';
import { Strike as BaseStrike } from '@tiptap/extension-strike';
import { Code as BaseCode } from '@tiptap/extension-code';
import { guardedToggle } from './guarded-toggle';

// guardedToggle: see guarded-toggle.ts.
//
// `Mod-B` is dropped so Mod-Shift-B reaches blockquote. prosemirror-keymap tries the full name
// (`Shift-Ctrl-B`), then the name with Shift stripped (`Ctrl-B`), then the keyCode-derived name.
// Bold's plugin is asked first, so the second step matched its `Mod-B` and toggled bold.
// Removing it costs nothing: Ctrl+Shift+B and Caps-Lock Ctrl+B both resolve through the keyCode
// step (to `Shift-Ctrl-b` and `Ctrl-b`), and plain Ctrl+B matches `Ctrl-b` first. All three are
// pinned in e2e/editor-accent-emphasis.spec.ts.
const BOLD_UPPERCASE_SHORTCUT = 'Mod-B';

export const Bold = BaseBold.extend({
  addKeyboardShortcuts() {
    const shortcuts = { ...this.parent?.() };
    delete shortcuts[BOLD_UPPERCASE_SHORTCUT];
    return shortcuts;
  },
  addCommands() {
    return {
      ...this.parent?.(),
      toggleBold: guardedToggle(this.name),
    };
  },
});

export const Italic = BaseItalic.extend({
  addCommands() {
    return {
      ...this.parent?.(),
      toggleItalic: guardedToggle(this.name),
    };
  },
});

export const Strike = BaseStrike.extend({
  addCommands() {
    return {
      ...this.parent?.(),
      toggleStrike: guardedToggle(this.name),
    };
  },
});

export const Code = BaseCode.extend({
  addCommands() {
    return {
      ...this.parent?.(),
      toggleCode: guardedToggle(this.name),
    };
  },
});
