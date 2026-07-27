import { Bold as BaseBold } from '@tiptap/extension-bold';
import { Italic as BaseItalic } from '@tiptap/extension-italic';
import { Strike as BaseStrike } from '@tiptap/extension-strike';
import { Code as BaseCode } from '@tiptap/extension-code';
import { guardedToggle } from './guarded-toggle';

// See guarded-toggle.ts for why toggleBold/toggleItalic/toggleStrike/toggleCode need this: each
// one otherwise unconditionally dispatches a no-op transaction (and a wasted undo entry) when
// blocked by accentEmphasis's exclusion.
export const Bold = BaseBold.extend({
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
