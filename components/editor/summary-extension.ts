import { Node as TiptapNode, type CommandProps, type Editor } from '@tiptap/core';
import type { Node as PMNode, NodeType } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  SUMMARY_BODY_CLASS,
  SUMMARY_CLASS,
  SUMMARY_LABEL_CLASS,
  SUMMARY_SECTION_BODY_CLASS,
  SUMMARY_SECTION_CLASSES,
  SUMMARY_SECTION_LABEL_CLASS,
  SUMMARY_SECTION_TITLES,
  SUMMARY_TITLE,
  TLDR_CLASS,
  TLDR_TITLE,
  type SummarySectionKind,
} from '@/lib/summary-types';
import { resolveDropTarget } from './drop-target';
import {
  asPaste,
  replaceSelectionClamped,
  stepIntoNextIsolating,
  stepIntoPreviousIsolating,
} from './isolating-boundary';
import type { MarkdownSerializerState } from './markdown-serializer-state';
import { BLOCK_ATOMS, selectionTouches } from './selection-scan';
import {
  SECTION_NAMES,
  SUMMARY_NAME,
  TLDR_NAME,
  demoteExtraBoxes,
  dropRuleBreak,
  newRuleBreak,
  pasteSlice,
  sectionKind,
  sliceCarriesBox,
  summaryNotLast,
  unwrapHalfSelectedBoxes,
  type SummaryRuleBreak,
} from './summary-rules';
import { buildIcon, TRASH_SHAPES } from './svg/icon-shapes';
import { refuseChromeDrops } from './useDragContainment';

// The まとめ block (総評 + optional 良かった点 / 気になった点) and the TL;DR block
// (docs/summary-requirements.md). Both are stored as raw-HTML containers with markdown between the
// tags, the accordion's shape (§3.3); the titles are chrome drawn by the NodeViews here and by
// lib/rehype-summary.ts on the published page, never stored. The placement rules — one of each,
// top level only, and the まとめ last — are in summary-rules.ts; this file wires them to the gestures.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    summary: {
      // Insert an empty まとめ at the end of the document (before the footnotes), wherever the caret
      // is, caret in the 総評. Refused when the post already has one.
      setSummary: () => ReturnType;
      // Add the section to the まとめ at `at`, in its fixed place (良かった点 before 気になった点).
      addSummarySection: (kind: SummarySectionKind, at: number) => ReturnType;
      // Remove the section whose position is `at`.
      removeSummarySection: (at: number) => ReturnType;
      // Remove the まとめ at `at`, sections and all, leaving the caret on the blank line below.
      removeSummary: (at: number) => ReturnType;
    };
    tldr: {
      // Insert an empty TL;DR at the caret, caret in it. Refused when the post already has one, off
      // the top level, and after the まとめ.
      setTldr: () => ReturnType;
    };
  }
}

// ---- markdown ----

// `<div class="…">`, a blank line, the content, a blank line, `</div>` on a line of its own. The blank
// lines keep the content markdown and the closing tag out of the last block, as for `<details>`
// (docs/accordion-requirements.md §2.1); both come from closing a block before the next write.
function serializeContainer(className: string) {
  return (state: MarkdownSerializerState, node: PMNode): void => {
    state.write(`<div class="${className}">`);
    state.closeBlock(node);
    state.renderContent(node);
    state.write('</div>');
    state.closeBlock(node);
  };
}

// Whitespace-only text between the tags is markdown-it's layout, not content.
function firstMeaningfulChild(element: Element): ChildNode | null {
  return (
    Array.from(element.childNodes).find(
      (child) => !(child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim() === ''),
    ) ?? null
  );
}

function isSectionElement(node: ChildNode | null): boolean {
  return (
    node instanceof Element &&
    (node.classList.contains(SUMMARY_SECTION_CLASSES.good) ||
      node.classList.contains(SUMMARY_SECTION_CLASSES.bad))
  );
}

// Parse hook, on markdown-it's HTML before ProseMirror parses it (idempotent: tiptap-markdown runs
// it on every parse). Three repairs the stored form needs, all measured (§6):
//   - A まとめ whose 総評 is empty is stored without it. The content expression starts with
//     `paragraph+`, and ProseMirror's parser does not create a missing leading node: it pushed the
//     sections out of the まとめ and merged their lists. So an empty <p> is supplied — asked of the
//     first child that is not whitespace, since `firstElementChild` skips a loose text line and
//     would split a hand-written 総評 in two.
//   - 良かった点 before 気になった点, the schema's order; out of order, the parser dropped the good
//     section out of the box.
//   - An empty TL;DR, or an empty section, gets the one node its content needs.
function updateSummaryDOM(element: HTMLElement): void {
  const doc = element.ownerDocument;
  element.querySelectorAll(`div.${SUMMARY_CLASS}`).forEach((box) => {
    const first = firstMeaningfulChild(box);
    if (!first || isSectionElement(first)) box.insertBefore(doc.createElement('p'), first);
    const good = box.querySelector(`:scope > div.${SUMMARY_SECTION_CLASSES.good}`);
    const bad = box.querySelector(`:scope > div.${SUMMARY_SECTION_CLASSES.bad}`);
    if (good && bad && bad.compareDocumentPosition(good) & Node.DOCUMENT_POSITION_FOLLOWING) {
      box.insertBefore(good, bad);
    }
    [good, bad].forEach((section) => {
      if (!section || section.querySelector(':scope > ul')) return;
      const list = doc.createElement('ul');
      list.appendChild(doc.createElement('li')).appendChild(doc.createElement('p'));
      section.appendChild(list);
    });
  });
  element.querySelectorAll(`div.${TLDR_CLASS}`).forEach((box) => {
    if (!firstMeaningfulChild(box)) box.appendChild(doc.createElement('p'));
  });
}

// ---- rules on the gestures ----

const summaryGuardKey = new PluginKey('summaryGuard');

// Named for what the author tried, as the other refusals are (docs/accordion-requirements.md §7.3).
const RULE_MESSAGES: Record<SummaryRuleBreak, string> = {
  'duplicate-summary': 'まとめは 1 つの記事に 1 つまでです',
  'duplicate-tldr': 'TL;DR は 1 つの記事に 1 つまでです',
  nested: 'まとめと TL;DR は引用やリスト、囲み枠、表の中には置けません',
  'not-last': 'まとめの後ろには何も追加できません',
  'section-block': '良かった点と気になった点には箇条書きだけ書けます',
};

// A transaction that replaces the whole document is a load (`setContent`), not an edit: a post
// saved before the rules may break one, and refusing it would refuse to open the post (§3.2).
function replacesWholeDocument(tr: { steps: readonly unknown[] }, doc: PMNode): boolean {
  const [first] = tr.steps;
  return first instanceof ReplaceStep && first.from === 0 && first.to === doc.content.size;
}

function docHas(doc: PMNode, typeName: string): boolean {
  let found = false;
  doc.descendants((node) => {
    if (node.type.name === typeName) found = true;
    return !found;
  });
  return found;
}

// The one plugin behind every route (§3.2):
//   - paste: a box that would break a rule is demoted to ordinary blocks, so the words still land;
//   - drop: anything below the まとめ, a copy of a box the post already has, or a box headed below
//     the top level is refused (`dropRuleBreak`, which the drop cursor asks too; repairing at the
//     destination would come after the move deleted the source, docs/editor-pitfalls.md §11.2);
//   - every other edit — typing after the まとめ, the drag handle, a command, undo — is held to
//     `newRuleBreak` by filterTransaction and refused with a notice;
//   - a load demotes the extra boxes (appendTransaction here, onCreate for the first document).
function summaryGuard(notify: (message: string) => void): Plugin {
  return new Plugin({
    key: summaryGuardKey,
    props: {
      transformPasted: unwrapHalfSelectedBoxes,
      handlePaste(view, _event, slice) {
        if (!sliceCarriesBox(slice)) return false;
        const place = (candidate: typeof slice) =>
          asPaste(replaceSelectionClamped(view.state, candidate));
        view.dispatch(place(pasteSlice(view.state, slice, place)));
        return true;
      },
      handleDrop(view, event, slice, moved) {
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!coords) return false;
        const broken = dropRuleBreak(resolveDropTarget(view, coords.pos, slice, moved), slice, moved);
        if (!broken) return false;
        notify(RULE_MESSAGES[broken]);
        event.preventDefault();
        return true;
      },
      // The まとめ that has text after it (a post saved before the rule) says so, rather than being
      // moved: moving it would reorder what the author wrote without asking.
      decorations(state) {
        if (!summaryNotLast(state.doc)) return null;
        const decorations: Decoration[] = [];
        state.doc.forEach((child, offset) => {
          if (child.type.name === SUMMARY_NAME) {
            decorations.push(
              Decoration.node(offset, offset + child.nodeSize, { class: 'summary-misplaced' }),
            );
          }
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
    filterTransaction(tr, state) {
      if (!tr.docChanged || tr.getMeta(summaryGuardKey)) return true;
      if (replacesWholeDocument(tr, state.doc)) return true;
      const broken = newRuleBreak(state.doc, tr.doc);
      if (!broken) return true;
      notify(RULE_MESSAGES[broken]);
      return false;
    },
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const tr = newState.tr;
      if (!demoteExtraBoxes(tr)) return null;
      return tr.setMeta(summaryGuardKey, true).setMeta('addToHistory', false);
    },
  });
}

// ---- NodeViews ----

// A control inside a NodeView: its presses are the button's, not ProseMirror's (stopEvent, and the
// drop refusal that must match it, docs/editor-pitfalls.md §18), and mousedown keeps the editor's
// selection where it was (§13.3).
function chromeButton(className: string, label: string, onPress: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', onPress);
  button.textContent = label;
  return button;
}

function claimsButton(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('button') !== null;
}

function labelRow(className: string, text: string): HTMLParagraphElement {
  const row = document.createElement('p');
  row.className = className;
  row.setAttribute('contenteditable', 'false');
  const span = document.createElement('span');
  span.textContent = text;
  row.appendChild(span);
  return row;
}

type ViewProps = { node: PMNode; getPos: () => number | undefined; editor: Editor };

// Title row | content, the DOM lib/rehype-summary.ts builds on the page, so one set of rules in
// app/globals.css paints both.
function boxView(className: string, title: string, { editor }: ViewProps) {
  const dom = document.createElement('div');
  dom.className = className;
  const body = document.createElement('div');
  body.className = SUMMARY_BODY_CLASS;
  const label = labelRow(SUMMARY_LABEL_CLASS, title);
  dom.append(label, body);
  refuseChromeDrops(dom, claimsButton, () => editor.view);
  return { dom, label, body };
}

// The trash button at the end of a title row: the まとめ's and each section's.
function removeButton(name: string, onPress: () => void): HTMLButtonElement {
  const button = chromeButton('summary-remove', '', onPress);
  button.setAttribute('aria-label', `${name}を削除`);
  button.title = `${name}を削除`;
  button.appendChild(buildIcon(TRASH_SHAPES));
  return button;
}

function summaryView(props: ViewProps) {
  const { editor, getPos } = props;
  const { dom, label, body } = boxView(SUMMARY_CLASS, SUMMARY_TITLE, props);
  // The one way to remove a まとめ that has sections: otherwise each section went first, then the
  // 総評's text, then Backspace in the empty box. It has no drag handle to select it by (§9).
  label.appendChild(
    removeButton(SUMMARY_TITLE, () => {
      const pos = getPos();
      if (typeof pos === 'number') editor.chain().focus().removeSummary(pos).run();
    }),
  );
  const controls = document.createElement('div');
  controls.className = 'summary-controls';
  controls.setAttribute('contenteditable', 'false');
  const add = (kind: SummarySectionKind) =>
    chromeButton('summary-add', `＋ ${SUMMARY_SECTION_TITLES[kind]}`, () => {
      const pos = getPos();
      if (typeof pos === 'number') editor.chain().focus().addSummarySection(kind, pos).run();
    });
  const buttons = { good: add('good'), bad: add('bad') };
  controls.append(buttons.good, buttons.bad);
  dom.appendChild(controls);

  const sync = (node: PMNode) => {
    const present = new Set<SummarySectionKind>();
    node.forEach((child) => {
      const kind = sectionKind(child);
      if (kind) present.add(kind);
    });
    buttons.good.hidden = present.has('good');
    buttons.bad.hidden = present.has('bad');
    controls.hidden = present.size === 2;
  };
  sync(props.node);

  return {
    dom,
    contentDOM: body,
    update: (updated: PMNode) => {
      if (updated.type.name !== SUMMARY_NAME) return false;
      sync(updated);
      return true;
    },
    stopEvent: (event: Event) => claimsButton(event.target),
    ignoreMutation: (mutation: { type: string; target: Node }) =>
      mutation.type !== 'selection' && !body.contains(mutation.target),
  };
}

function sectionView(kind: SummarySectionKind, { editor, getPos }: ViewProps) {
  const dom = document.createElement('div');
  dom.className = SUMMARY_SECTION_CLASSES[kind];
  const label = labelRow(SUMMARY_SECTION_LABEL_CLASS, SUMMARY_SECTION_TITLES[kind]);
  const remove = removeButton(SUMMARY_SECTION_TITLES[kind], () => {
    const pos = getPos();
    if (typeof pos === 'number') editor.chain().focus().removeSummarySection(pos).run();
  });
  label.appendChild(remove);
  const body = document.createElement('div');
  body.className = SUMMARY_SECTION_BODY_CLASS;
  dom.append(label, body);
  refuseChromeDrops(dom, claimsButton, () => editor.view);
  return {
    dom,
    contentDOM: body,
    stopEvent: (event: Event) => claimsButton(event.target),
    ignoreMutation: (mutation: { type: string; target: Node }) =>
      mutation.type !== 'selection' && !body.contains(mutation.target),
  };
}

// ---- keys ----

// Put the caret just after the box at `$box` (a top-level position), reusing a blank paragraph
// there or making one — the only thing the まとめ rule lets follow it.
function caretAfterBox(tr: CommandProps['tr'], boxPos: number, paragraph: NodeType): void {
  const box = tr.doc.nodeAt(boxPos);
  if (!box) return;
  const after = boxPos + box.nodeSize;
  const next = tr.doc.nodeAt(after);
  if (!(next && next.type === paragraph && next.content.size === 0)) {
    tr.insert(after, paragraph.create());
  }
  tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView();
}

// Backspace in a box holding nothing but one empty paragraph turns it back into that paragraph, as
// the callout does: the only way to remove an empty box from inside it.
function unwrapEmptyBox(boxType: NodeType, { state, tr, dispatch }: CommandProps): boolean {
  const { selection } = state;
  if (!selection.empty) return false;
  const { $from } = selection;
  if ($from.depth !== 2 || $from.node(1).type !== boxType) return false;
  const box = $from.node(1);
  const only = box.childCount === 1 ? box.firstChild : null;
  if (!only || only.type.name !== 'paragraph' || only.content.size > 0) return false;
  if (dispatch) {
    const from = $from.before(1);
    tr.replaceWith(from, from + box.nodeSize, state.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, from + 1)).scrollIntoView();
  }
  return true;
}

// Enter on an empty paragraph that ends a box's paragraphs leaves it, as in a callout. In a まとめ
// with sections the next place is the first section; otherwise it is below the box. The empty line
// goes unless it is the only one (the 総評 and a TL;DR need a paragraph).
function exitParagraphsOnEmptyEnter(
  boxType: NodeType,
  { state, tr, dispatch }: CommandProps,
): boolean {
  const { selection } = state;
  if (!selection.empty) return false;
  const { $from } = selection;
  if ($from.depth !== 2 || $from.node(1).type !== boxType) return false;
  if ($from.parent.type.name !== 'paragraph' || $from.parent.content.size > 0) return false;
  const box = $from.node(1);
  const index = $from.index(1);
  const next = index + 1 < box.childCount ? box.child(index + 1) : null;
  if (next && !sectionKind(next)) return false;
  if (!dispatch) return true;
  const boxPos = $from.before(1);
  const paragraphs = next ? index + 1 : box.childCount;
  if (paragraphs > 1) tr.delete($from.before(2), $from.after(2));
  if (next) {
    // Into the section's first line: section, list, item, paragraph.
    const sectionPos = tr.mapping.map($from.after(2));
    tr.setSelection(TextSelection.near(tr.doc.resolve(sectionPos + 4))).scrollIntoView();
  } else {
    caretAfterBox(tr, boxPos, state.schema.nodes.paragraph);
  }
  return true;
}

// Enter on an empty last item of a section's own list: splitListItem declines it (a top-level list
// would lift), and the lift has nowhere to go inside a section. So the item goes (unless it is the
// list's only one) and the caret moves on — to 気になった点 from 良かった点, else below the まとめ.
function exitSectionOnEmptyEnter({ state, tr, dispatch }: CommandProps): boolean {
  const { selection } = state;
  if (!selection.empty) return false;
  const { $from } = selection;
  // doc > summary > section > bulletList > listItem > paragraph
  if ($from.depth !== 5 || !sectionKind($from.node(2))) return false;
  if ($from.parent.content.size > 0 || $from.index(4) !== 0) return false;
  const list = $from.node(3);
  const item = $from.node(4);
  if (item.childCount !== 1 || $from.index(3) !== list.childCount - 1) return false;
  if (!dispatch) return true;
  const boxPos = $from.before(1);
  const summary = $from.node(1);
  const sectionIndex = $from.index(1);
  if (list.childCount > 1) tr.delete($from.before(4), $from.after(4));
  if (sectionIndex + 1 < summary.childCount) {
    const nextSection = tr.mapping.map($from.after(2));
    tr.setSelection(TextSelection.near(tr.doc.resolve(nextSection + 4))).scrollIntoView();
  } else {
    caretAfterBox(tr, boxPos, state.schema.nodes.paragraph);
  }
  return true;
}

// Refuse a command's own result when it breaks a rule. Needed because a refused transaction is
// otherwise dispatched (a single command dispatches whatever it built, `preventDispatch` aside), and
// because `can()` never reaches filterTransaction, so the menus would offer a row that does nothing.
function refuseIfBroken(state: EditorState, tr: CommandProps['tr']): boolean {
  if (newRuleBreak(state.doc, tr.doc) === null) return true;
  tr.setMeta('preventDispatch', true);
  return false;
}

// ---- nodes ----

export type SummaryOptions = { onBlocked: (message: string) => void };

export const Summary = TiptapNode.create<SummaryOptions>({
  name: SUMMARY_NAME,
  group: 'block',
  // The 総評 is required; the sections are optional and in this order (§3.1).
  content: `paragraph+ ${SECTION_NAMES.good}? ${SECTION_NAMES.bad}?`,
  defining: true,
  isolating: true,

  addOptions() {
    return { onBlocked: () => {} };
  },

  parseHTML() {
    return [{ tag: `div.${SUMMARY_CLASS}` }];
  },

  // The stored shape, without chrome: this is what a copy puts on the clipboard.
  renderHTML() {
    return ['div', { class: SUMMARY_CLASS }, 0];
  },

  addNodeView() {
    return (props) => summaryView(props);
  },

  addStorage() {
    return {
      markdown: {
        serialize: serializeContainer(SUMMARY_CLASS),
        parse: { updateDOM: updateSummaryDOM },
      },
    };
  },

  addProseMirrorPlugins() {
    return [summaryGuard(this.options.onBlocked)];
  },

  // The first document never passes through a transaction (useEditor's `content`), so its extra
  // boxes are demoted here; later loads meet appendTransaction.
  onCreate() {
    const { tr } = this.editor.state;
    if (!demoteExtraBoxes(tr)) return;
    this.editor.view.dispatch(tr.setMeta(summaryGuardKey, true).setMeta('addToHistory', false));
  },

  addCommands() {
    return {
      setSummary:
        () =>
        ({ state, tr, dispatch }) => {
          if (docHas(state.doc, SUMMARY_NAME)) return false;
          // Offered only from a top-level line, as the TL;DR and the accordion are, though the まとめ
          // lands at the end regardless: every insert row then answers "may a block go here", and
          // `/` stays a literal character in a table cell, a quote or a callout.
          const { $from, $to } = state.selection;
          if ($from.depth !== 1 || $to.depth !== 1) return false;
          const { doc, schema } = state;
          const last = doc.lastChild;
          const footnotes = last?.type.name === 'footnoteSection' ? last : null;
          const end = doc.content.size - (footnotes?.nodeSize ?? 0);
          const before = doc.maybeChild(doc.childCount - (footnotes ? 2 : 1));
          // A blank line already at the end (TrailingNode's, or the one the slash menu emptied) is
          // taken over rather than left above the まとめ.
          const reuse = before && before.type.name === 'paragraph' && before.content.size === 0;
          const from = reuse ? end - before.nodeSize : end;
          if (dispatch) {
            const box = this.type.create(null, schema.nodes.paragraph.create());
            tr.replaceWith(from, end, box);
            tr.setSelection(TextSelection.create(tr.doc, from + 2)).scrollIntoView();
          }
          return true;
        },
      addSummarySection:
        (kind, at) =>
        ({ state, tr, dispatch }) => {
          const summary = state.doc.nodeAt(at);
          if (!summary || summary.type !== this.type) return false;
          let insertAt = at + 1;
          let exists = false;
          summary.forEach((child) => {
            const childKind = sectionKind(child);
            if (childKind === kind) exists = true;
            // 良かった点 goes after the 総評; 気になった点 after everything.
            if (!childKind || kind === 'bad') insertAt += child.nodeSize;
          });
          if (exists) return false;
          if (dispatch) {
            const { nodes } = state.schema;
            const section = nodes[SECTION_NAMES[kind]].create(
              null,
              nodes.bulletList.create(null, nodes.listItem.create(null, nodes.paragraph.create())),
            );
            tr.insert(insertAt, section);
            // section, list, item, paragraph.
            tr.setSelection(TextSelection.create(tr.doc, insertAt + 4)).scrollIntoView();
          }
          return true;
        },
      removeSummarySection:
        (at) =>
        ({ state, tr, dispatch }) => {
          const section = state.doc.nodeAt(at);
          if (!section || !sectionKind(section)) return false;
          if (dispatch) {
            tr.delete(at, at + section.nodeSize);
            // Into the end of what precedes it: the 総評, or 良かった点.
            tr.setSelection(TextSelection.near(tr.doc.resolve(at), -1)).scrollIntoView();
          }
          return true;
        },
      removeSummary:
        (at) =>
        ({ state, tr, dispatch }) => {
          const summary = state.doc.nodeAt(at);
          if (!summary || summary.type !== this.type) return false;
          if (dispatch) {
            const end = at + summary.nodeSize;
            const next = state.doc.nodeAt(end);
            // The blank line TrailingNode keeps below takes the caret; without one (the まとめ was
            // the post's only block), a blank line takes the まとめ's place, since the document
            // needs a block.
            if (next && next.type.name === 'paragraph' && next.content.size === 0) {
              tr.delete(at, end);
            } else {
              tr.replaceWith(at, end, state.schema.nodes.paragraph.create());
            }
            tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView();
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    const type = this.type;
    return {
      Enter: ({ editor }) =>
        editor.commands.command(
          (props) => exitSectionOnEmptyEnter(props) || exitParagraphsOnEmptyEnter(type, props),
        ),
      Backspace: ({ editor }) =>
        editor.commands.command(
          (props) => unwrapEmptyBox(type, props) || stepIntoPreviousIsolating(type, props),
        ),
      Delete: ({ editor }) =>
        editor.commands.command((props) => stepIntoNextIsolating(type, props)),
    };
  },
});

function sectionNode(kind: SummarySectionKind) {
  return TiptapNode.create({
    name: SECTION_NAMES[kind],
    // `bulletList` only: no heading, table or quote at this level (§3.1). What a list item may hold
    // is summary-rules.ts's `sectionsHoldOnlyLists`, since `listItem` is shared.
    content: 'bulletList',
    defining: true,
    isolating: true,
    parseHTML() {
      return [{ tag: `div.${SUMMARY_SECTION_CLASSES[kind]}` }];
    },
    renderHTML() {
      return ['div', { class: SUMMARY_SECTION_CLASSES[kind] }, 0];
    },
    addNodeView() {
      return (props) => sectionView(kind, props);
    },
    addStorage() {
      return {
        markdown: { serialize: serializeContainer(SUMMARY_SECTION_CLASSES[kind]), parse: {} },
      };
    },
  });
}

export const SummaryGood = sectionNode('good');
export const SummaryBad = sectionNode('bad');

export const Tldr = TiptapNode.create({
  name: TLDR_NAME,
  group: 'block',
  // Prose only: it is the post's description (§2), and a list does not read as a sentence.
  content: 'paragraph+',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: `div.${TLDR_CLASS}` }];
  },

  renderHTML() {
    return ['div', { class: TLDR_CLASS }, 0];
  },

  addNodeView() {
    return (props) => {
      const { dom, body } = boxView(TLDR_CLASS, TLDR_TITLE, props);
      return {
        dom,
        contentDOM: body,
        ignoreMutation: (mutation: { type: string; target: Node }) =>
          mutation.type !== 'selection' && !body.contains(mutation.target),
      };
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize: serializeContainer(TLDR_CLASS),
        // updateSummaryDOM, registered on Summary, repairs both boxes.
        parse: {},
      },
    };
  },

  addCommands() {
    return {
      setTldr:
        () =>
        ({ state, tr, commands }) => {
          if (docHas(state.doc, TLDR_NAME)) return false;
          const { $from, $to } = state.selection;
          if ($from.depth !== 1 || $to.depth !== 1) return false;
          if (selectionTouches(state, ...BLOCK_ATOMS)) return false;
          if (!commands.insertContent({ type: this.name, content: [{ type: 'paragraph' }] }))
            return false;
          // After the まとめ, the insert is what the rule refuses.
          return refuseIfBroken(state, tr);
        },
    };
  },

  addKeyboardShortcuts() {
    const type = this.type;
    return {
      Enter: ({ editor }) =>
        editor.commands.command((props) => exitParagraphsOnEmptyEnter(type, props)),
      Backspace: ({ editor }) =>
        editor.commands.command(
          (props) => unwrapEmptyBox(type, props) || stepIntoPreviousIsolating(type, props),
        ),
      Delete: ({ editor }) =>
        editor.commands.command((props) => stepIntoNextIsolating(type, props)),
    };
  },
});
