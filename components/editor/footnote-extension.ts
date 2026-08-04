import { InputRule, Node, mergeAttributes } from '@tiptap/core';
import { isHistoryTransaction } from '@tiptap/pm/history';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { hasUndoableInputRule } from './input-rule-undo';
import type MarkdownIt from 'markdown-it';
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs';
import type Token from 'markdown-it/lib/token.mjs';
import footnotePlugin from 'markdown-it-footnote';
import type { MarkdownSerializerState } from './markdown-serializer-state';

// Footnotes (docs/footnote-requirements.md). Four nodes' worth of feature in one file: the
// reference that sits in the prose, the definition, the section holding every definition at the end
// of the document, and the `doc` whose content expression pins that section last.
//
// Stage 1 of §11 — the markdown round trip, the section and its placement, both insertion routes,
// numbering, and reference/definition pairing. **Not yet the guards of §6** (a reference can still
// be put in a table cell or a code block, and a paste carrying one is not answered), which §11 is
// emphatic must not be left out of the same release.
//
// Neither tiptap-markdown nor prosemirror-markdown carries any footnote handling, so both
// directions are written here. Parsing goes through HTML (§2.1): tiptap-markdown renders markdown
// to an HTML string and hands that to DOMParser.fromSchema, so what the nodes parse is whatever
// markdown-it-footnote's renderer emits.
//
// That renderer is replaced wholesale rather than parsed as it comes, and the reason is not taste:
//
//  - **The label is absent from the default output.** `[^fn-a3f]` renders as `id="fn1"`, the
//    sequential number, so §4.1's "a label is never rewritten" cannot be honoured — the label
//    never reaches ProseMirror. It is on the token's `meta.label`, which only a renderer rule can
//    read.
//  - The default definition ends with a backref link holding `↩︎`, which would land in the
//    document as editor content and round-trip into the author's markdown.
//  - The wrapper (`<hr class="footnotes-sep">`, `<section>`, `<ol>`) has no counterpart in the
//    schema, and an empty definition renders a differently shaped `<li>` (no `<p>`) than a filled
//    one.
//
// Emitting the shape the schema wants is shorter than bending parseHTML around all three.

const FOOTNOTE_REF_TAG = 'sup[data-footnote-ref]';
const FOOTNOTE_DEF_TAG = 'div[data-footnote-def]';
const FOOTNOTE_SECTION_TAG = 'div[data-footnote-section]';

// Labels reach the DOM through an attribute, so they need HTML attribute escaping — not the
// markdown escaping `state.text()` would apply. A label carrying `"` or `&` would otherwise break
// out of the attribute.
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

// `^[inline note]` has no label of its own — markdown-it-footnote leaves `meta.label` undefined for
// it (index.mjs, the tail's `list[i].label`). The syntax is a non-goal (§1), but it parses the
// moment the plugin is installed, so it still needs a destination: it becomes an ordinary footnote
// with a generated label rather than being dropped.
//
// The fallback is derived from `meta.id` — the footnote's index — and not from a counter. The
// reference and the definition are rendered by two different rules, so a counter hands them two
// different labels and the pair comes apart on the next load: measured, the reference saved as
// `[^inline-1]` while its definition saved as `[^inline-2]`, and the note's text was orphaned.
function labelOf(meta: { label?: string; id?: number } | null): string {
  return meta?.label ?? `inline-${meta?.id ?? 0}`;
}

// An orphan definition — one no reference points at — is *deleted* by the plugin, and this is the
// one place where installing it is worse than the literal-text guard it replaces. `footnote_tail`
// filters every definition out of the token stream into a private map, then returns early when no
// reference claimed any of them (`if (!state.env.footnotes.list) { return }`); a definition that
// simply went unreferenced is never re-emitted either, because the emission loop walks `list`.
// Measured: `本文\n\n[^x]: 注釈\n` came back as `本文`. The note's words were gone.
//
// §5.4 asks for the opposite — keep it at the end and report it — so the definitions are captured
// before the tail runs and the unclaimed ones are put back after it, as ordinary footnote tokens.
// They become footnoteDefinition nodes with no reference, which is exactly the state §5.4
// describes, and they serialize back to `[^x]: 注釈` unchanged.
//
// Two rules rather than one wrapped rule: `ruler.before`/`ruler.after` are public API, where
// replacing `footnote_tail` would need the private `__rules__` the literal-text guard has to reach
// into. The captured map lives on `state.env`, so it is per-parse and cannot leak between loads.
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
    for (const [label, tokens] of captured) {
      if (referenced.has(label)) continue;
      const open = new state.Token('footnote_open', '', 1);
      open.meta = { label };
      state.tokens.push(open, ...tokens, new state.Token('footnote_close', '', -1));
    }
    return false;
  });
}

// tiptap-markdown runs every extension's parse.setup on each parse rather than once per editor
// (the lesson the literal-text guard was built on), and `md.use()` would register the same four
// rules again and throw. Remember which instances are already set up.
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

// A definition's content is block-tokenized by the plugin, so it arrives wrapped in `<p>`. The node
// holds inline content (§1: no block elements inside a footnote), and ProseMirror does not flatten
// the mismatch — measured, it closed the definition early and left the text in a sibling paragraph
// (`doc(…, footnoteDefinition, paragraph("注釈テキスト"))`), which then serialized as an empty
// definition followed by a stray line. Unwrapping here is the same move updateDetailsDOM makes for
// the accordion's body.
//
// Idempotent by contract: tiptap-markdown re-runs parse.updateDOM on every parse. Unwrapping is
// naturally so — once the `<p>` is gone there is nothing left to unwrap.
export function unwrapFootnoteParagraphs(element: HTMLElement): void {
  element.querySelectorAll(FOOTNOTE_DEF_TAG).forEach((definition) => {
    definition.querySelectorAll(':scope > p').forEach((paragraph) => {
      paragraph.replaceWith(...Array.from(paragraph.childNodes));
    });
  });
}

// The body reference. `atom` is a requirement rather than a convenience (§2): with a caret inside
// it, part of a number can be deleted and a broken reference made.
export const FootnoteReference = Node.create({
  name: 'footnoteReference',
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
          const { from, to } = state.selection;
          const tr = state.tr;
          if (!applyFootnoteInsertion(tr, state, from, to)) return false;
          dispatch?.(tr);
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    // Mod-Shift-F is free: Mod-Shift-X is strike, Mod-Shift-B is the quote, Mod-Alt-C the code
    // block. The precedent for a shortcut of our own is accent-emphasis-extension.ts's Mod-Shift-E.
    return { 'Mod-Shift-f': () => this.editor.commands.setFootnote() };
  },

  addInputRules() {
    // Two characters is the whole trigger (§9.1). `[^` appears in neither Japanese prose nor
    // markdown, and waiting for a closing bracket would mean asking the author for a label — which
    // §4 has already decided they do not get to choose.
    return [
      new InputRule({
        find: /\[\^$/,
        handler: ({ state, range }) => {
          return applyFootnoteInsertion(state.tr, state, range.from, range.to) ? undefined : null;
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [footnoteNumbering(), footnotePairing()];
  },
});

// The definition. Inline content only (§1's non-goal list), and deliberately **not** in the
// `block` group: the document's content expression is `block+ footnoteSection?` (§3.2), and a
// definition that stayed in the group would still be admitted anywhere at the top level, leaving
// that expression decorative. Its only home is the section below.
export const FootnoteDefinition = Node.create({
  name: 'footnoteDefinition',
  content: 'inline*',
  defining: true,

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

// The definitions' home at the end of the document (§3). Not in the `block` group either — the
// document's content expression names it directly, and putting it in the group would let it be
// created anywhere `block+` matches.
//
// It is not a draggable type (`block-drag-handle.ts` works from an explicit allowlist, so nothing
// is needed there), and it takes no part in the table of contents on the public side (§8, enforced
// in lib/rehype-collect-toc.ts).
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
        // The definitions write their own `[^label]: ` lines; the section is only their container,
        // and GFM has no syntax for it.
        serialize: (state: MarkdownSerializerState, node: PMNode) => state.renderContent(node),
        parse: { setup: installFootnotes, updateDOM: unwrapFootnoteParagraphs },
      },
    };
  },
});

// Replaces StarterKit's `doc` (disabled in PostEditor) for one reason: the content expression.
// `block+ footnoteSection?` states in the schema what §3 asks for and §6.2's reconciliation would
// otherwise be the only thing enforcing — the section can exist at most once, and only last.
//
// Nothing else is lost by declaring it here. @tiptap/extension-document is this node plus a
// `renderMarkdown`, and that belongs to TipTap 3's own markdown module, which tiptap-markdown 0.9.0
// never reads (the same reason details-extension.ts writes its own serializer).
//
// This alone does not put the trailing paragraph in the right place — see §3.2 and the
// footnoteSection branch in trailing-node-extension.ts, which is the half that moves it.
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

// A label is an opaque, stable id (§4). It is never shown — the number the reader sees is derived
// from document order — so it only has to be unique within the document and survive reordering.
function mintLabel(doc: PMNode): string {
  const taken = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === 'footnoteReference' || node.type.name === 'footnoteDefinition') {
      taken.add(node.attrs.label as string);
    }
  });
  for (;;) {
    const label = `fn-${Math.random().toString(36).slice(2, 5)}`;
    if (!taken.has(label)) return label;
  }
}

interface FootnoteScan {
  order: Map<string, number>;
  definitions: Map<string, { empty: boolean }>;
}

// One walk answering both questions the rest of this file asks: what number does each label carry
// (document order of the *references*, §4), and which definitions exist and are still empty.
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

// The number is a decoration, never an attribute, and that is the load-bearing choice here. Written
// into the document it would make every reordering edit — and every load that renumbers — a change
// the autosave has to save, which is the shape the accordion rejected when it took `persist: false`
// so that a fold could not write to the database. A decoration keeps the number out of the document
// and out of the markdown.
//
// `data-incomplete` is §5.2's first layer: the author is looking at the prose, not at the
// definitions, so an unfinished footnote has to be visible from the reference.
function footnoteNumbering(): Plugin {
  return new Plugin({
    key: footnoteNumberingKey,
    props: {
      decorations(state) {
        const { order, definitions } = scanFootnotes(state.doc);
        if (order.size === 0 && definitions.size === 0) return null;

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
                // No reference points at this one (§5.4). It is kept rather than deleted — the
                // author's words are not the editor's to throw away — but it is marked.
                ...(number === undefined ? { 'data-orphan': '' } : {}),
              }),
            );
          }
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

// Deleting a reference deletes its definition (§5.1). This runs as an appended transaction rather
// than inside the deleting command because a reference can go in many ways — Backspace, a ranged
// replacement, a paste over it, select-all — and answering each one separately is how the guards in
// this editor have grown their bugs before.
//
// Undo and input rules are skipped for the reasons trailing-node-extension.ts documents at length:
// an append riding an undo cannot be taken back by the next Ctrl+Z, and any appended transaction
// clears the record undoInputRule needs.
function footnotePairing(): Plugin {
  return new Plugin({
    key: footnotePairingKey,
    appendTransaction: (transactions, oldState, state) => {
      if (!transactions.some((transaction) => transaction.docChanged)) return null;
      if (transactions.some(isHistoryTransaction)) return null;
      if (hasUndoableInputRule(state)) return null;
      if (oldState.doc.eq(state.doc)) return null;

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
      if (doomed.length === 0) return null;

      const tr = state.tr;
      // Losing every definition means losing the section: its content is `footnoteDefinition+`, so
      // an empty one is not a document ProseMirror will build. Deleting the definitions one by one
      // in that case simply does nothing — measured, the reference went and the definition stayed.
      if (survivors === 0) {
        tr.delete(sectionStart, state.doc.content.size);
      } else {
        for (const { from, to } of doomed.reverse()) tr.delete(from, to);
      }
      return tr;
    },
  });
}

// Both routes do the same thing (§9): put a reference where the caret is, create its empty
// definition, and **leave the caret in the prose**. Sending it to the definition would break the
// flow footnotes exist to protect — thinking of an aside while writing a sentence.
//
// One transaction, not two. Beyond the undo atomicity §5.1 asks for, it is what keeps the `[^`
// rule's undo record alive: any second transaction in the same round clears the record
// undoInputRule needs, which is the trap trailing-node-extension.ts was written to answer.
// Takes the transaction rather than making one. Both callers already have the transaction their
// caller will dispatch — the command has `state.tr`, and an input rule is handed one that already
// carries the typed characters — and building a second against the same document produced steps
// whose positions no longer described it once replayed (`Invalid content for node doc`, measured).
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
  // No footnote inside a footnote (§1's non-goal list). The section is the only place definitions
  // live, so one ancestor test covers it.
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type === sectionType) return false;
  }

  const label = mintLabel(tr.doc);
  tr.replaceWith(from, to, referenceType.create({ label }));

  const definition = definitionType.create({ label });
  const last = tr.doc.lastChild;
  if (last?.type === sectionType) {
    tr.insert(tr.doc.content.size - 1, definition);
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
