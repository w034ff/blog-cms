import { Bold as BaseBold } from '@tiptap/extension-bold';
import { Italic as BaseItalic } from '@tiptap/extension-italic';
import { Strike as BaseStrike } from '@tiptap/extension-strike';
import { Code as BaseCode } from '@tiptap/extension-code';
import { guardedToggle } from './guarded-toggle';

// See guarded-toggle.ts for why toggleBold/toggleItalic/toggleStrike/toggleCode need this: each
// one otherwise unconditionally dispatches a no-op transaction (and a wasted undo entry) when
// blocked by accentEmphasis's exclusion.
// `Mod-B` is dropped so that Mod-Shift-B can reach blockquote. @tiptap/extension-bold registers
// both `Mod-b` and `Mod-B`, and prosemirror-keymap's keydownHandler tries, in order: the full name
// (`Shift-Ctrl-B` for Ctrl+Shift+B, since event.key is "B"), then the same name with Shift stripped
// (`Ctrl-B`), then the name derived from event.keyCode. Bold's plugin is asked before blockquote's
// (it sits later in PostEditor's extensions array, and ExtensionManager reverses that list), so the
// second step matched `Mod-B` and toggled bold — blockquote's own keymap was never reached, and the
// shortcut the toolbar advertises applied the wrong mark.
//
// Removing it costs nothing, because both surviving routes go through that third step. It fires
// only when `base[event.keyCode]` differs from event.key, which is exactly the case where the two
// disagree: Ctrl+Shift+B resolves "B" back to "b" and lands on blockquote's `Shift-Ctrl-b`, and
// Ctrl+B with Caps Lock on does the same onto Bold's own `Ctrl-b`. Plain Ctrl+B never gets that far
// — it matches `Ctrl-b` outright at the first step. All three are pinned in
// e2e/editor-accent-emphasis.spec.ts, the Caps Lock one through CDP (Playwright's keyboard cannot
// produce an uppercase key without also setting shiftKey).
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
