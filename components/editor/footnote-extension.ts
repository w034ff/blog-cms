import { InputRule, Node, mergeAttributes } from '@tiptap/core';
import { isHistoryTransaction } from '@tiptap/pm/history';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { escapeAttribute } from './html-escape';
import { asPaste } from './isolating-boundary';
import { hasUndoableInputRule } from './input-rule-undo';
import { selectionTouches } from './selection-scan';
import type MarkdownIt from 'markdown-it';
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs';
import type Token from 'markdown-it/lib/token.mjs';
import footnotePlugin from 'markdown-it-footnote';
import type { MarkdownSerializerState } from './markdown-serializer-state';

// Footnotes (docs/footnote-requirements.md). Four nodes' worth of feature in one file: the
// reference that sits in the prose, the definition, the section holding every definition at the end
// of the document, and the `doc` whose content expression pins that section last.
//
// Neither tiptap-markdown nor prosemirror-markdown handles footnotes, so both directions are here.
// Parsing goes through HTML (§2.1), and markdown-it-footnote's renderer is replaced wholesale:
//
//  - **the label is absent from its output** (`id="fn1"` is the sequence number), so §4.1's "a
//    label is never rewritten" needs a renderer rule reading `meta.label`;
//  - its backref `↩︎` would land in the document as content;
//  - its wrapper has no schema counterpart, and an empty definition renders a differently shaped
//    `<li>`.

const FOOTNOTE_REF_TAG = 'sup[data-footnote-ref]';
const FOOTNOTE_DEF_TAG = 'div[data-footnote-def]';
const FOOTNOTE_SECTION_TAG = 'div[data-footnote-section]';

// `^[inline note]` has no `meta.label`. A non-goal (§1), but it parses, so it gets a label derived
// from `meta.id`: a counter would give the reference and the definition (rendered by different
// rules) different labels, orphaning the note.
function labelOf(meta: { label?: string; id?: number } | null): string {
  return meta?.label ?? `inline-${meta?.id ?? 0}`;
}

// The plugin *deletes* an orphan definition: `footnote_tail` filters definitions out and returns
// early when no reference claimed any (`if (!state.env.footnotes.list) { return }`). §5.4 (and §5.5)
// wants it kept, so definitions are captured before the tail and the unclaimed ones put back after
// it. Two public `ruler.before`/`ruler.after` rules rather than wrapping `footnote_tail` through the
// private `__rules__`; the map lives on `state.env`, so it is per-parse.
interface FootnoteEnv {
  footnotes?: { list?: { label?: string }[] };
  orphanCandidates?: Map<string, Token[]>;
}

function envOf(state: StateCore): FootnoteEnv {
  return state.env as FootnoteEnv;
}

function rescueOrphanDefinitions(markdownit: MarkdownIt): void {
  markdownit.core.ruler.before('footnote_tail', 'footnote_orphan_capture', (state) => {
    const env = envOf(state);
    if (!env.footnotes) return false;

    const captured = new Map<string, Token[]>();
    let label: string | null = null;
    let block: Token[] | null = null;
    for (const token of state.tokens) {
      if (token.type === 'footnote_reference_open') {
        label = (token.meta as { label?: string } | null)?.label ?? null;
        block = [];
      } else if (token.type === 'footnote_reference_close') {
        if (label !== null && block) captured.set(label, block);
        label = null;
        block = null;
      } else if (block) {
        block.push(token);
      }
    }
    env.orphanCandidates = captured;
    return false;
  });

  markdownit.core.ruler.after('footnote_tail', 'footnote_orphan_emit', (state) => {
    const env = envOf(state);
    const captured = env.orphanCandidates;
    if (!captured || captured.size === 0) return false;

    const referenced = new Set(
      (env.footnotes?.list ?? [])
        .map((entry) => entry.label)
        .filter((entry) => entry !== undefined),
    );
    const rescued: Token[] = [];
    for (const [label, tokens] of captured) {
      if (referenced.has(label)) continue;
      const open = new state.Token('footnote_open', '', 1);
      open.meta = { label };
      rescued.push(open, ...tokens, new state.Token('footnote_close', '', -1));
    }
    if (rescued.length === 0) return false;

    // Inside the section, not after it: past `footnote_block_close` ProseMirror cannot place a
    // definition (§3.2) and drops it. Only visible once another, referenced footnote exists.
    let closeIndex = -1;
    for (let index = state.tokens.length - 1; index >= 0; index -= 1) {
      if (state.tokens[index].type === 'footnote_block_close') {
        closeIndex = index;
        break;
      }
    }
    if (closeIndex >= 0) state.tokens.splice(closeIndex, 0, ...rescued);
    else state.tokens.push(...rescued);
    return false;
  });
}

// tiptap-markdown runs `parse.setup` on every parse, and a second `md.use()` would throw.
const patched = new WeakSet<MarkdownIt>();

export function installFootnotes(markdownit: MarkdownIt): void {
  if (patched.has(markdownit)) return;
  patched.add(markdownit);

  markdownit.use(footnotePlugin);

  rescueOrphanDefinitions(markdownit);

  const rules = markdownit.renderer.rules;
  rules.footnote_ref = (tokens, idx) =>
    `<sup data-footnote-ref data-label="${escapeAttribute(labelOf(tokens[idx].meta))}"></sup>`;
  rules.footnote_open = (tokens, idx) =>
    `<div data-footnote-def data-label="${escapeAttribute(labelOf(tokens[idx].meta))}">`;
  rules.footnote_close = () => '</div>\n';
  // The plugin's own chrome (`<hr class="footnotes-sep">`, `<section>`, `<ol>`) is replaced by the
  // one wrapper the schema has: the definitions' home at the end of the document (§3).
  rules.footnote_block_open = () => '<div data-footnote-section>\n';
  rules.footnote_block_close = () => '</div>\n';
  // The backref would land in the document as content — `↩︎` is not something the author typed.
  rules.footnote_anchor = () => '';
}

// The plugin wraps a definition's content in `<p>`, but the node holds inline content (§1), and
// ProseMirror closed the definition early and left the text in a sibling paragraph. Unwrapped here,
// as updateDetailsDOM does; idempotent, since updateDOM re-runs on every parse.
function unwrapFootnoteParagraphs(element: HTMLElement): void {
  element.querySelectorAll(FOOTNOTE_DEF_TAG).forEach((definition) => {
    definition.querySelectorAll(':scope > p').forEach((paragraph) => {
      paragraph.replaceWith(...Array.from(paragraph.childNodes));
    });
  });
}

// The body reference. `atom` is required (§2): with a caret inside it, part of a number could be
// deleted.
export const FootnoteReference = Node.create<{
  onBlocked: (message: string) => void;
  onNotice: (message: string) => void;
}>({
  name: 'footnoteReference',

  addOptions() {
    // The shared notice. `onNotice` is not a refusal: it reports something already in the document
    // (§5.4).
    return { onBlocked: () => {}, onNotice: () => {} };
  },
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-label') ?? '',
        renderHTML: (attributes) => ({ 'data-label': attributes.label as string }),
      },
      // The note carried through the clipboard (§6.1): set by transformCopied, consumed when the paste
      // lands, never serialized. Rendered, because the clipboard carries HTML.
      pendingNote: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-note'),
        renderHTML: (attributes) =>
          attributes.pendingNote === null ? {} : { 'data-note': attributes.pendingNote as string },
      },
    };
  },

  parseHTML() {
    return [{ tag: FOOTNOTE_REF_TAG }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes({ 'data-footnote-ref': '' }, HTMLAttributes)];
  },

  addStorage() {
    return {
      markdown: {
        serialize: (state: MarkdownSerializerState, node: PMNode) => {
          state.write(`[^${node.attrs.label as string}]`);
        },
        parse: { setup: installFootnotes, updateDOM: unwrapFootnoteParagraphs },
      },
    };
  },

  addCommands() {
    return {
      setFootnote:
        () =>
        ({ state, dispatch }) => {
          const refusal = placementRefusal(state);
          if (refusal) {
            // Not under `can()`, which must not raise a toast.
            if (dispatch) this.options.onBlocked(refusal);
            return false;
          }
          const { from, to } = state.selection;
          const tr = state.tr;
          if (!applyFootnoteInsertion(tr, state, from, to)) return false;
          dispatch?.(tr);
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    // Mod-Shift-F is unused (Mod-Shift-X strike, Mod-Shift-B quote, Mod-Alt-C code block).
    return { 'Mod-Shift-f': () => this.editor.commands.setFootnote() };
  },

  addInputRules() {
    // `[^` alone triggers (§9.1): it appears in neither prose nor markdown, and the author never
    // chooses a label (§4).
    return [
      new InputRule({
        find: /\[\^$/,
        handler: ({ state, range }) => {
          // The input rule refuses as the command does (criterion 7).
          const refusal = placementRefusal(state);
          if (refusal) {
            this.options.onBlocked(refusal);
            return null;
          }
          return applyFootnoteInsertion(state.tr, state, range.from, range.to) ? undefined : null;
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [
      footnoteNumbering(),
      footnotePairing(this.options.onBlocked),
      footnoteClipboard(this.options.onBlocked),
      footnoteOrphanNotice(this.options.onNotice),
    ];
  },
});

function inDefinition($pos: ResolvedPos): boolean {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === 'footnoteDefinition') return true;
  }
  return false;
}

// The definition: inline content only (§1), and **not** in the `block` group, or `block+
// footnoteSection?` (§3.2) would admit it anywhere at the top level.
export const FootnoteDefinition = Node.create<{ onBlocked: (message: string) => void }>({
  name: 'footnoteDefinition',
  content: 'inline*',
  // A ranged deletion across two definitions merged them. Being `isolating` makes isolating-boundary.ts
  // clamp it at all its entry points; with the section also isolating, the clamp takes the
  // innermost box, as for a table cell.
  isolating: true,
  defining: true,

  addOptions() {
    return { onBlocked: () => {} };
  },

  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-label') ?? '',
        renderHTML: (attributes) => ({ 'data-label': attributes.label as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: FOOTNOTE_DEF_TAG }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-footnote-def': '' }, HTMLAttributes), 0];
  },

  // **Enter must not split a definition:** both halves keep the label, and markdown-it keeps only
  // the last definition per label, so reopening lost the first half. A hard break instead, as in a
  // table cell (the line form can't hold blocks); Shift+Enter always made one and it round-trips.
  // Declines outside a definition.
  //
  // **Backspace at the start and Delete at the end must not join** two definitions: one label's
  // words would end up under the other and the second left empty (§5.1). Refused with a notice,
  // which also explains the formerly silent Backspace in an emptied note. Deliberately not "delete
  // the footnote once empty": Backspace repeats, and the reference may be off screen.
  addKeyboardShortcuts() {
    const refuseJoin = (atEdge: (offset: number, size: number) => boolean) => () => {
      const { selection } = this.editor.state;
      const { $from, empty } = selection;
      if (!empty || $from.parent.type.name !== 'footnoteDefinition') return false;
      if (!atEdge($from.parentOffset, $from.parent.content.size)) return false;
      this.options.onBlocked('脚注を削除するには、本文中の参照を削除してください。');
      return true;
    };

    // Not `setHardBreak`: @tiptap/extension-hard-break refuses when the caret's parent is isolating
    // (`if (selection.$from.parent.type.spec.isolating) return false`), which the definition is. All
    // three keys come here, since HardBreak binds Shift/Mod+Enter to `setHardBreak`.
    const breakLine = () => {
      if (!inDefinition(this.editor.state.selection.$from)) return false;
      return this.editor.commands.insertContent({ type: 'hardBreak' });
    };

    return {
      Enter: breakLine,
      'Shift-Enter': breakLine,
      'Mod-Enter': breakLine,
      Backspace: refuseJoin((offset) => offset === 0),
      Delete: refuseJoin((offset, size) => offset === size),
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize: (state: MarkdownSerializerState, node: PMNode) => {
          state.write(`[^${node.attrs.label as string}]: `);
          state.renderInline(node);
          state.closeBlock(node);
        },
        parse: { setup: installFootnotes, updateDOM: unwrapFootnoteParagraphs },
      },
    };
  },
});

// The definitions' home at the end of the document (§3). Not in the `block` group; the doc's
// content expression names it. Not draggable, and outside the public table of contents (§8).
export const FootnoteSection = Node.create({
  name: 'footnoteSection',
  content: 'footnoteDefinition+',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: FOOTNOTE_SECTION_TAG }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-footnote-section': '' }, HTMLAttributes), 0];
  },

  addStorage() {
    return {
      markdown: {
        // The definitions write their own lines; GFM has no syntax for the section.
        serialize: (state: MarkdownSerializerState, node: PMNode) => state.renderContent(node),
        parse: { setup: installFootnotes, updateDOM: unwrapFootnoteParagraphs },
      },
    };
  },
});

// Replaces StarterKit's `doc` for its content expression, `block+ footnoteSection?` (§3.2).
// @tiptap/extension-document adds only a `renderMarkdown` tiptap-markdown never reads. The trailing
// paragraph's placement is trailing-node-extension.ts's half.
export const Document = Node.create({
  name: 'doc',
  topNode: true,
  content: 'block+ footnoteSection?',
});

// ---------------------------------------------------------------------------------------------
// Numbering, insertion and pairing (§4, §5.1, §9)
// ---------------------------------------------------------------------------------------------

const footnoteNumberingKey = new PluginKey('footnoteNumbering');
const footnotePairingKey = new PluginKey('footnotePairing');
const footnoteClipboardKey = new PluginKey('footnoteClipboard');
const footnoteOrphanNoticeKey = new PluginKey('footnoteOrphanNotice');

// A label is an opaque, stable id (§4), never shown; unique within the document.
function mintLabelAvoiding(taken: Set<string>): string {
  for (;;) {
    const label = `fn-${Math.random().toString(36).slice(2, 5)}`;
    if (!taken.has(label)) return label;
  }
}

function labelsInUse(doc: PMNode): Set<string> {
  const taken = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === 'footnoteReference' || node.type.name === 'footnoteDefinition') {
      taken.add(node.attrs.label as string);
    }
  });
  return taken;
}

function mintLabel(doc: PMNode): string {
  return mintLabelAvoiding(labelsInUse(doc));
}

interface FootnoteScan {
  order: Map<string, number>;
  definitions: Map<string, { empty: boolean }>;
}

// Each label's number (reference order, §4), and which definitions exist and are empty.
function scanFootnotes(doc: PMNode): FootnoteScan {
  const definitions = new Map<string, { empty: boolean }>();
  doc.descendants((node) => {
    if (node.type.name !== 'footnoteDefinition') return;
    definitions.set(node.attrs.label as string, { empty: node.content.size === 0 });
  });

  const order = new Map<string, number>();
  doc.descendants((node) => {
    if (node.type.name !== 'footnoteReference') return;
    const label = node.attrs.label as string;
    if (!order.has(label)) order.set(label, order.size + 1);
  });

  return { order, definitions };
}

// Unreferenced definitions (§5.4) sink to the end in their existing order.
const UNREFERENCED = Number.MAX_SAFE_INTEGER;

function rankOf(definition: PMNode, order: Map<string, number>): number {
  return order.get(definition.attrs.label as string) ?? UNREFERENCED;
}

// Where a new definition goes to keep the section in reference order (§3).
function orderedInsertPoint(doc: PMNode, section: PMNode, label: string): number {
  const { order } = scanFootnotes(doc);
  const rank = order.get(label) ?? UNREFERENCED;
  let at = doc.content.size - section.nodeSize + 1;
  for (let index = 0; index < section.childCount; index += 1) {
    const definition = section.child(index);
    if (rankOf(definition, order) > rank) break;
    at += definition.nodeSize;
  }
  return at;
}

// §3: the definitions follow the references' order, which the decoration numbers alone did not
// guarantee (a middle insertion read [1], [3], [2]). Not while the caret is in the section, where
// a rebuild would move the selection and no edit can change the order anyway. Load needs nothing:
// the parser emits in reference order.
//
// Sorts in place on a transaction under construction: a plugin gets one appendTransaction per
// cycle, so a separate sort after the paste's materialize step never ran. Returns whether it
// changed anything.
function sortDefinitions(tr: Transaction): boolean {
  const section = tr.doc.lastChild;
  if (section?.type !== tr.doc.type.schema.nodes.footnoteSection) return false;

  const sectionEnd = tr.doc.content.size;
  const sectionStart = sectionEnd - section.nodeSize;
  if (tr.selection.to > sectionStart && tr.selection.from < sectionEnd) return false;

  const { order } = scanFootnotes(tr.doc);
  const current: PMNode[] = [];
  section.forEach((definition) => current.push(definition));
  const sorted = current
    .map((definition, index) => ({ definition, index }))
    .sort((a, b) => rankOf(a.definition, order) - rankOf(b.definition, order) || a.index - b.index)
    .map((entry) => entry.definition);
  if (sorted.every((definition, index) => definition === current[index])) return false;

  tr.replaceWith(sectionStart + 1, sectionEnd - 1, Fragment.fromArray(sorted));
  return true;
}

// The label of the reference under a NodeSelection only; a caret beside one is ordinary writing.
function pairedLabel(state: EditorState): string | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection)) return null;
  if (selection.node.type.name !== 'footnoteReference') return null;
  return selection.node.attrs.label as string;
}

// **The number is a decoration, never an attribute**, so renumbering never writes to the document
// or autosaves (like the accordion's `persist: false`). `data-incomplete` is §5.2's reference-side
// marking.
function footnoteNumbering(): Plugin {
  return new Plugin({
    key: footnoteNumberingKey,
    props: {
      decorations(state) {
        const { order, definitions } = scanFootnotes(state.doc);
        if (order.size === 0 && definitions.size === 0) return null;

        // Selecting a reference highlights its definition. Not a jump, which would strand the caret
        // mid-sentence (§5.1, §8), and not a scroll: the click is also the delete gesture.
        const paired = pairedLabel(state);

        const decorations: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          const label = node.attrs.label as string | undefined;
          if (label === undefined) return;

          if (node.type.name === 'footnoteReference') {
            const definition = definitions.get(label);
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, {
                'data-number': String(order.get(label) ?? ''),
                ...(definition && !definition.empty ? {} : { 'data-incomplete': '' }),
              }),
            );
          } else if (node.type.name === 'footnoteDefinition') {
            const number = order.get(label);
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, {
                'data-number': String(number ?? ''),
                // Unreferenced (§5.4): kept, and marked.
                ...(number === undefined ? { 'data-orphan': '' } : {}),
                // For the placeholder CSS: an empty textblock holds a `<br>`, so `:empty` never
                // matches.
                ...(node.content.size === 0 ? { 'data-empty': '' } : {}),
                ...(paired === label ? { 'data-paired': '' } : {}),
              }),
            );
          }
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

// Deleting a reference deletes its definition (§5.1), as an appended transaction so every way a
// reference can go is covered. Skips undo and input-rule rounds for trailing-node-extension.ts's
// reasons.
function footnotePairing(onBlocked: (message: string) => void): Plugin {
  return new Plugin({
    key: footnotePairingKey,
    appendTransaction: (transactions, oldState, state) => {
      if (!transactions.some((transaction) => transaction.docChanged)) return null;
      if (transactions.some(isHistoryTransaction)) return null;
      if (hasUndoableInputRule(state)) return null;
      if (oldState.doc.eq(state.doc)) return null;

      // §6.2: the label is settled here, where the destination is known: a carried label is reused
      // when free (a move) and replaced when taken (a duplicate).
      const materialized = materializePendingNotes(state, onBlocked);
      if (materialized) {
        // Materializing appends, so this is where a pasted note is put in its reference's place.
        sortDefinitions(materialized);
        return materialized;
      }

      const sectionType = state.schema.nodes.footnoteSection;
      const section = state.doc.lastChild;
      if (!sectionType || section?.type !== sectionType) return null;

      // Only definitions whose reference existed a moment ago and is now gone. An orphan that
      // arrived from outside (§5.4) is left alone — it never had a reference here to lose.
      const { order } = scanFootnotes(state.doc);
      const previous = scanFootnotes(oldState.doc).order;
      const sectionStart = state.doc.content.size - section.nodeSize;

      const doomed: { from: number; to: number }[] = [];
      let survivors = 0;
      let offset = sectionStart + 1;
      section.forEach((definition) => {
        const label = definition.attrs.label as string;
        if (order.has(label) || !previous.has(label)) survivors += 1;
        else doomed.push({ from: offset, to: offset + definition.nodeSize });
        offset += definition.nodeSize;
      });
      // Nothing to delete leaves the section's order to answer for (§3).
      if (doomed.length === 0) {
        const sorting = state.tr;
        return sortDefinitions(sorting) ? sorting : null;
      }

      const tr = state.tr;
      // The section's content is `footnoteDefinition+`, so the last definition takes it along.
      if (survivors === 0) {
        tr.delete(sectionStart, state.doc.content.size);
      } else {
        for (const { from, to } of doomed.reverse()) tr.delete(from, to);
        // This is the plugin's one turn, so sort here too.
        sortDefinitions(tr);
      }
      return tr;
    },
  });
}

// Give every reference that arrived carrying a note (§6.1) its definition back, or degrade it where
// §6 forbids one. Here, not in `transformPasted`, because during a drop the selection is still the
// dragged range.
function materializePendingNotes(
  state: EditorState,
  onBlocked: (message: string) => void,
): Transaction | null {
  const referenceType = state.schema.nodes.footnoteReference;
  const definitionType = state.schema.nodes.footnoteDefinition;
  const sectionType = state.schema.nodes.footnoteSection;
  if (!referenceType || !definitionType || !sectionType) return null;

  const pending: { pos: number; node: PMNode }[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type === referenceType && node.attrs.pendingNote !== null) pending.push({ pos, node });
  });
  if (pending.length === 0) return null;

  // The sharing rule (§6.2), asked of the definitions: the same label with the *same* note joins it
  // (copy-and-paste as a second reference, and drag-moves); with a *different* note it mints, since
  // external labels like `[^1]` collide routinely; with none, the carried note is rebuilt. Comparing
  // text, not provenance, errs only when two notes read identically.
  const definitions = scanFootnoteText(state.doc).definitions;
  const taken = labelsInUse(state.doc);

  type Plan = { pos: number; node: PMNode; label: string; refused: boolean };
  const plans: Plan[] = [];
  // Minted once per carried label, so two references to one note stay one note.
  const minted = new Map<string, string>();
  let refusal: string | null = null;
  for (const { pos, node } of pending) {
    const refusedHere = hostRefusalAt(state.doc.resolve(pos));
    if (refusedHere) {
      refusal = refusedHere;
      plans.push({ pos, node, label: node.attrs.label as string, refused: true });
      continue;
    }
    const carried = node.attrs.label as string;
    const existing = definitions.get(carried);
    let label = carried;
    if (existing !== undefined && existing !== (node.attrs.pendingNote as string)) {
      label = minted.get(carried) ?? mintLabelAvoiding(taken);
      minted.set(carried, label);
      taken.add(label);
    }
    plans.push({ pos, node, label, refused: false });
  }

  const tr = state.tr;
  const created: PMNode[] = [];
  for (const plan of plans) {
    if (plan.refused) continue;
    // Nothing to build when the note is already there.
    if (definitions.has(plan.label)) continue;
    const note = plan.node.attrs.pendingNote as string;
    definitions.set(plan.label, note);
    created.push(
      definitionType.create({ label: plan.label }, note === '' ? null : state.schema.text(note)),
    );
  }

  // Backwards, since a refusal widens a one-wide atom.
  for (const plan of [...plans].reverse()) {
    if (plan.refused) {
      tr.replaceWith(
        plan.pos,
        plan.pos + plan.node.nodeSize,
        state.schema.text(`[^${plan.label}]`),
      );
    } else {
      tr.setNodeMarkup(plan.pos, undefined, { label: plan.label, pendingNote: null });
    }
  }

  if (created.length > 0) {
    const last = tr.doc.lastChild;
    if (last?.type === sectionType) tr.insert(tr.doc.content.size - 1, created);
    else tr.insert(tr.doc.content.size, sectionType.create(null, created));
  }

  if (refusal) onBlocked(refusal);
  return tr;
}

// §5.4: an orphan definition is kept and the author told, once per label (a state, not an event);
// a label that stops being an orphan is forgotten.
function footnoteOrphanNotice(onNotice: (message: string) => void): Plugin {
  return new Plugin({
    key: footnoteOrphanNoticeKey,
    view() {
      const reported = new Set<string>();

      const check = (state: EditorState) => {
        const { order } = scanFootnotes(state.doc);
        const orphans = new Set<string>();
        state.doc.descendants((node) => {
          if (node.type.name !== 'footnoteDefinition') return;
          const label = node.attrs.label as string;
          if (!order.has(label)) orphans.add(label);
        });

        for (const label of reported) if (!orphans.has(label)) reported.delete(label);

        const fresh = [...orphans].filter((label) => !reported.has(label));
        if (fresh.length === 0) return;
        for (const label of fresh) reported.add(label);
        onNotice(`本文から参照されていない脚注が ${fresh.length} 件あります。`);
      };

      return {
        update: (view) => check(view.state),
      };
    },
  });
}

// §6.1: a reference carries its note through the clipboard, since a copied paragraph never includes
// the section, and a cut would otherwise lose the words. Only a reference from elsewhere arrives
// without one and falls to plain text.
function footnoteClipboard(onBlocked: (message: string) => void): Plugin {
  return new Plugin({
    key: footnoteClipboardKey,

    props: {
      transformCopied: (slice, view) => {
        const { definitions } = scanFootnoteText(view.state.doc);
        return mapReferences(slice, view.state, (node) => {
          const label = node.attrs.label as string;
          return node.type.create({ ...node.attrs, pendingNote: definitions.get(label) ?? '' });
        });
      },

      // A drop is refused outright: it deletes its source, so degrading at the destination would
      // orphan the note. `posAtCoords` reads the pre-insertion document, so the accordion title
      // (§6.5) is still findable here; handlePaste covers the paste path, where it is not.
      handleDrop: (view, event, slice) => {
        if (!carriesReference(view.state, slice)) return false;

        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!at) return false;
        const refused = hostRefusalAt(view.state.doc.resolve(at.pos));
        if (!refused) return false;

        onBlocked(refused);
        return true;
      },

      // The accordion title (§6.5) only. Other refusals are repaired after landing, but a reference
      // never lands in a `text*` title: the fitter tears the accordion and `hostRefusalAt` sees only a
      // paragraph. So it is refused before placement, degrading to `[^label]` text as §6.3 does for
      // a paste, with prosemirror-view's paste metas.
      handlePaste: (view, _event, slice) => {
        if (!selectionTouches(view.state, 'detailsSummary')) return false;
        if (!carriesReference(view.state, slice)) return false;

        const flattened = mapReferences(slice, view.state, (node) =>
          view.state.schema.text(`[^${node.attrs.label as string}]`),
        );
        view.dispatch(asPaste(view.state.tr.replaceSelection(flattened)));
        onBlocked(ACCORDION_TITLE_REFUSAL);
        return true;
      },

      // Runs on drops too (§6.4), so one rule answers both gestures.
      transformPasted: (slice, view) => {
        // Only whether a note came along; placement is asked after landing (materializePendingNotes).
        return mapReferences(slice, view.state, (node) => {
          const note = node.attrs.pendingNote as string | null;
          // Plain text, the shape it had before this editor understood footnotes.
          if (note === null) return view.state.schema.text(`[^${node.attrs.label as string}]`);
          return node;
        });
      },
    },
  });
}

// Does this slice bring a reference with it?
function carriesReference(state: EditorState, slice: Slice): boolean {
  const referenceType = state.schema.nodes.footnoteReference;
  if (!referenceType) return false;
  let found = false;
  slice.content.descendants((node) => {
    if (node.type === referenceType) found = true;
  });
  return found;
}

// Replace every footnoteReference in a slice (not yet in the document, so no positions).
function mapReferences(slice: Slice, state: EditorState, swap: (node: PMNode) => PMNode): Slice {
  const referenceType = state.schema.nodes.footnoteReference;
  if (!referenceType) return slice;

  const mapFragment = (fragment: Fragment): Fragment => {
    const mapped: PMNode[] = [];
    fragment.forEach((child) => {
      if (child.type === referenceType) mapped.push(swap(child));
      else mapped.push(child.copy(mapFragment(child.content)));
    });
    return Fragment.fromArray(mapped);
  };

  return new Slice(mapFragment(slice.content), slice.openStart, slice.openEnd);
}

// The definitions' text, keyed by label — what a reference has to carry with it.
function scanFootnoteText(doc: PMNode): { definitions: Map<string, string> } {
  const definitions = new Map<string, string>();
  doc.descendants((node) => {
    if (node.type.name === 'footnoteDefinition') {
      definitions.set(node.attrs.label as string, node.textContent);
    }
  });
  return { definitions };
}

// The accordion title refuses on schema grounds: `detailsSummary` is `text*` (with `codeBlock`, the
// only textblocks refusing an inline atom; footnote-placement.test.ts), and the fitter would tear
// the accordion (§6.5). The stored title is raw HTML, so a reference there would be lost anyway. The
// body takes footnotes, hence `detailsSummary`, never `details`.
const ACCORDION_TITLE_REFUSAL = '脚注はアコーディオンのタイトル内には置けません。';

// The placement rules asked of a position, for drops, where the selection is still the dragged
// range. Exported for footnote-placement.test.ts.
export function hostRefusalAt($pos: ResolvedPos): string | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const name = $pos.node(depth).type.name;
    if (name === 'tableCell' || name === 'tableHeader') return '脚注は表のセル内には置けません。';
    if (name === 'codeBlock') return '脚注はコードブロック内には置けません。';
    if (name === 'detailsSummary') return ACCORDION_TITLE_REFUSAL;
    if (name === 'footnoteSection' || name === 'footnoteDefinition') {
      return '脚注の中に脚注は置けません。';
    }
  }
  return null;
}

// §6's placement rules, via selectionTouches so a range reaching into a host counts: a cell (the
// pipe form breaks), a code block (text only), an accordion title, and the section itself.
export function placementRefusal(state: EditorState): string | null {
  if (selectionTouches(state, 'tableCell', 'tableHeader')) {
    return '脚注は表のセル内には置けません。';
  }
  if (selectionTouches(state, 'codeBlock')) {
    return '脚注はコードブロック内には置けません。';
  }
  if (selectionTouches(state, 'detailsSummary')) return ACCORDION_TITLE_REFUSAL;
  // A definition would fit a reference, but nested footnotes are a non-goal (§1).
  if (selectionTouches(state, 'footnoteSection', 'footnoteDefinition')) {
    return '脚注の中に脚注は置けません。';
  }
  return null;
}

// Both routes (§9) insert the reference at the caret with an empty definition and **leave the caret
// in the prose**, in one transaction: a second would clear the `[^` rule's undo record. Takes the
// caller's transaction, since a second one against the same document replayed invalid positions.
function applyFootnoteInsertion(
  tr: Transaction,
  state: EditorState,
  from: number,
  to: number,
): boolean {
  const referenceType = state.schema.nodes.footnoteReference;
  const definitionType = state.schema.nodes.footnoteDefinition;
  const sectionType = state.schema.nodes.footnoteSection;
  if (!referenceType || !definitionType || !sectionType) return false;

  const $from = tr.doc.resolve(from);
  if (!$from.parent.inlineContent) return false;
  // No footnote inside a footnote (§1).
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type === sectionType) return false;
  }

  const label = mintLabel(tr.doc);
  tr.replaceWith(from, to, referenceType.create({ label }));

  const definition = definitionType.create({ label });
  const last = tr.doc.lastChild;
  if (last?.type === sectionType) {
    // In reference order (§3), inside this transaction: the pairing plugin steps aside while the
    // input rule's undo record is alive (§9.1), so an appended reorder would wait for a keystroke.
    tr.insert(orderedInsertPoint(tr.doc, last, label), definition);
  } else {
    tr.insert(tr.doc.content.size, sectionType.create(null, definition));
  }

  tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1)));
  tr.scrollIntoView();
  return true;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      setFootnote: () => ReturnType;
    };
  }
}
