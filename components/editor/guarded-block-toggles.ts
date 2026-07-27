import { findParentNode, isList, type CommandProps } from '@tiptap/core';
import { selectionTouches } from './selection-scan';
import { Heading as BaseHeading } from '@tiptap/extension-heading';
import { BulletList as BaseBulletList } from '@tiptap/extension-bullet-list';
import { OrderedList as BaseOrderedList } from '@tiptap/extension-ordered-list';

// Block conversions aimed at a code block destroy it. TipTap's toggleHeading and toggleList both
// run `clearNodes()` first, which strips the codeBlock down to plain paragraphs: the code turns
// into prose and the node's `language`/filename attributes are gone, with nothing on screen to
// say so. (Undo restores it — if the author notices.) Refusing instead makes the command report
// false, which the toolbar's `editor.can()` checks turn into a greyed-out control: the same
// treatment bold/italic/strike already get inside a code block, and the same "don't offer what
// can't work" rule as setCallout. Guarding the command rather than the buttons also covers the
// keyboard shortcuts (Mod-Alt-2/3, Mod-Shift-7/8), which never go near the toolbar.
//
// The two differ in how much this adds, with the caret inside a code block. `can().toggleHeading()`
// reports *true* there and then wrecks it, so for headings this guard is the only signal there is.
// `can().toggleList()` already reports false (its dry run can't see past clearNodes, so the
// wrapInList that follows fails) — the real run isn't bound by that and goes ahead anyway, so the
// guard is what actually stops it, and it makes the refusal explicit instead of a side effect of
// dry-run mechanics. That holds only for the wrap direction: a selection inside a list that merely
// *contains* a code block reports true and is deliberately allowed through, since toggleList lifts
// or re-types in place there rather than clearing anything — see the insideList note below.
//
// Markdown input rules need no equivalent: `# ` / `- ` don't fire inside a code block, since
// ProseMirror disables input rules in a `code` textblock.
//
// The danger is asked about with selectionTouches, not `isActive('codeBlock')`: isActive reports
// false for a selection that merely reaches into a code block (see selection-scan.ts), which walks
// straight into clearNodes.
//
// The trade-off is deliberate: a mixed selection refuses outright rather than converting the prose
// parts and shredding the code. Refusing is recoverable (narrow the selection) where the
// conversion is not, and the toolbar greys out so the refusal is visible rather than silent.
// Selections with no code block in them are untouched — two paragraphs still become two headings.
function codeBlockInRange({ state }: CommandProps): boolean {
  return selectionTouches(state, 'codeBlock');
}

// Lists need the narrower question "would this *convert* a code block", because only one of
// toggleList's three paths destroys anything. Given a selection already inside a list it either
// lifts it out (same list type) or re-types the list node in place (the other type) — both leave
// the children alone, so a list that *contains* a code block can still be un-listed or switched
// between 箇条書き/番号付き, which the range scan alone would have blocked. Only the fall-through
// path wraps a fresh list around the selection, and that is the one preceded by clearNodes.
//
// `findParentNode(isList)` is the same call toggleList opens with, so this can't disagree with it
// about whether a parent list exists. It does not replicate the *depth* condition toggleList also
// gates those branches on, so a selection nested deeper still than a list item (a blockquote
// inside one, holding both a paragraph and a code block) can reach clearNodes with this reporting
// true. `isActive('codeBlock')` below covers the reachable form of that — a caret inside such a
// code block — and what is left needs a hand-built document plus a selection spanning exactly
// those two nodes; not worth copying blockRange's internals for.
function insideList({ editor, state }: CommandProps): boolean {
  const { extensions } = editor.extensionManager;
  return !!findParentNode((node) => isList(node.type.name, extensions))(state.selection);
}

function blockedForList(props: CommandProps): boolean {
  if (props.editor.isActive('codeBlock')) return true;
  return !insideList(props) && codeBlockInRange(props);
}

export const Heading = BaseHeading.extend({
  addCommands() {
    const parent = this.parent?.();
    return {
      ...parent,
      toggleHeading: (attributes) => (props) => {
        // No non-destructive direction here: toggleHeading always runs clearNodes first, so any
        // code block in the range is going to be flattened.
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
