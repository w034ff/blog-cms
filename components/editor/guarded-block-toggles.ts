import { findParentNode, isList, type CommandProps } from '@tiptap/core';
import { selectionTouches } from './selection-scan';
import { Heading as BaseHeading } from '@tiptap/extension-heading';
import { BulletList as BaseBulletList } from '@tiptap/extension-bullet-list';
import { OrderedList as BaseOrderedList } from '@tiptap/extension-ordered-list';

// Block conversions aimed at a code block destroy it: toggleHeading and toggleList run
// `clearNodes()` first, turning the code into prose and dropping its language and filename.
// Refusing makes the command report false, so `editor.can()` greys the toolbar control, and
// guarding the command also covers the keyboard shortcuts (Mod-Alt-2/3, Mod-Shift-7/8).
//
// `can().toggleHeading()` reports true inside a code block, so this guard is the only signal for
// headings. `can().toggleList()` already reports false, but the real run goes ahead anyway.
// Input rules need nothing: ProseMirror disables them in a `code` textblock.
//
// Asked with selectionTouches, not `isActive('codeBlock')`, which misses a selection that only
// reaches into a code block. A mixed selection is refused outright rather than half-converted:
// narrowing the selection is recoverable, shredding the code is not.
function codeBlockInRange({ state }: CommandProps): boolean {
  return selectionTouches(state, 'codeBlock');
}

// Lists ask the narrower "would this *convert* a code block": inside a list, toggleList lifts or
// re-types in place and leaves the children alone, so a list containing a code block can still be
// un-listed or switched. Only the wrap path runs clearNodes.
//
// `findParentNode(isList)` is the call toggleList opens with, so the two agree on whether a parent
// list exists. toggleList's *depth* condition is not replicated; `isActive('codeBlock')` covers the
// reachable case (a caret in a code block nested in a list item's blockquote), and the rest needs a
// hand-built document.
function insideList({ editor, state }: CommandProps): boolean {
  const { extensions } = editor.extensionManager;
  return !!findParentNode((node) => isList(node.type.name, extensions))(state.selection);
}

// A まとめ section is `content: 'bulletList'`. toggleList re-types a list with
// `tr.setNodeMarkup(currentList.pos, listType)` without asking the parent, even in a `can()` dry run,
// so the toolbar's `can().toggleOrderedList()` threw on every render with the caret in a section and
// took the editor down (docs/editor-pitfalls.md §8.4). Refused there outright: the section's list
// is the section.
function inSummarySection({ state }: CommandProps): boolean {
  return selectionTouches(state, 'summaryGood', 'summaryBad');
}

function blockedForList(props: CommandProps): boolean {
  if (props.editor.isActive('codeBlock')) return true;
  if (inSummarySection(props)) return true;
  return !insideList(props) && codeBlockInRange(props);
}

export const Heading = BaseHeading.extend({
  addCommands() {
    const parent = this.parent?.();
    return {
      ...parent,
      toggleHeading: (attributes) => (props) => {
        // toggleHeading always runs clearNodes first, so any code block in range is flattened.
        if (codeBlockInRange(props)) return false;
        return parent?.toggleHeading?.(attributes)(props) ?? false;
      },
    };
  },
});

export const BulletList = BaseBulletList.extend({
  addCommands() {
    const parent = this.parent?.();
    return {
      ...parent,
      toggleBulletList: () => (props) => {
        if (blockedForList(props)) return false;
        return parent?.toggleBulletList?.()(props) ?? false;
      },
    };
  },
});

export const OrderedList = BaseOrderedList.extend({
  addCommands() {
    const parent = this.parent?.();
    return {
      ...parent,
      toggleOrderedList: () => (props) => {
        if (blockedForList(props)) return false;
        return parent?.toggleOrderedList?.()(props) ?? false;
      },
    };
  },
});
