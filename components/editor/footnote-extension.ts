import { InputRule, Node, mergeAttributes } from '@tiptap/core';
import { isHistoryTransaction } from '@tiptap/pm/history';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
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
// Stages 1 and 2 of §11 — the markdown round trip, the section and its placement, both insertion
// routes, numbering, reference/definition pairing, the placement guards of §6, and the clipboard
// rules of §6.1–§6.4. Stage 3 (§5.4's notice for an orphan definition that arrived from outside)
// is what is left.
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
    const rescued: Token[] = [];
    for (const [label, tokens] of captured) {
      if (referenced.has(label)) continue;
      const open = new state.Token('footnote_open', '', 1);
      open.meta = { label };
      rescued.push(open, ...tokens, new state.Token('footnote_close', '', -1));
    }
    if (rescued.length === 0) return false;

    // Inside the section, not after it. The definitions' section is the only place a definition
    // may live (§3.2: the doc is `block+ footnoteSection?`, and footnoteDefinition is not in the
    // `block` group), and appending past `footnote_block_close` puts the rescued ones outside it —
    // where ProseMirror cannot place them and drops them again.
    //
    // Measured, and only visible with company: with no referenced footnote the tail emits no
    // wrapper at all, ProseMirror supplies the missing section itself, and the orphan survives. Add
    // one ordinary footnote to the same document and the wrapper exists, the orphan lands after it,
    // and the note's words are gone — the exact loss this rescue was written to stop.
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
export const FootnoteReference = Node.create<{
  onBlocked: (message: string) => void;
  onNotice: (message: string) => void;
}>({
  name: 'footnoteReference',

  addOptions() {
    // The same reporter the table and callout guards write to (PostEditor owns the one toast).
    // A refused gesture changes nothing, so the notice is the whole of the feedback. `onNotice`
    // goes to the same place but is not a refusal — nothing was declined, the author is being told
    // about something already in their document (§5.4).
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
      // The note this reference is carrying through the clipboard (§6.1). Set on the way out by
      // transformCopied and consumed the moment the paste lands; it is never in a settled document,
      // and the serializer never looks at it — a reference writes `[^label]` and nothing else.
      //
      // It has to reach the DOM, because that is what the clipboard actually carries: a slice is
      // serialized to HTML and parsed back, so an attribute that does not render is an attribute
      // that does not survive a copy.
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
            // Only report when the command is actually being run — `can()` asks with no dispatch,
            // and a menu measuring itself must not raise a toast.
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
          // Criterion 7 counts two refusal paths on purpose: a guard on the shortcut says nothing
          // about the input rule, and the author reaches the same wall by either route.
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

// The definition. Inline content only (§1's non-goal list), and deliberately **not** in the
// `block` group: the document's content expression is `block+ footnoteSection?` (§3.2), and a
// definition that stayed in the group would still be admitted anywhere at the top level, leaving
// that expression decorative. Its only home is the section below.
export const FootnoteDefinition = Node.create<{ onBlocked: (message: string) => void }>({
  name: 'footnoteDefinition',
  content: 'inline*',
  // What stops a *ranged* deletion spanning two definitions from merging them. The keymap below
  // answers a caret at an edge, which is a different gesture and cannot reach this one: a selection
  // drawn from one note into the next and then deleted (or typed over, cut, pasted over, or
  // committed over by an IME) closed the frontier between the two definitions and left one node
  // carrying both labels' worth of text. This is the same defect §6 documents for the callout and
  // the code block, and isolating-boundary.ts already answers it at all seven entry points off the
  // node's own `isolating` flag — so the fix is to be one of the nodes it protects, not to grow a
  // sixth rule here.
  //
  // The section is isolating too, which makes this the table's two-level shape. That is already the
  // case the clamp handles: `isolatingCutDepth` takes the *innermost* box, which is the definition.
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

  // Enter must not split this node, and the reason is data loss rather than tidiness. A split copies
  // the attributes, so both halves keep the same label: the section grows a second definition
  // carrying the same number, and the markdown grows a second `[^a]:` line. markdown-it's
  // `footnote_def` keeps the *last* definition it sees for a label, so reopening the post throws the
  // first half away — measured, `[^a]: 注釈` + `[^a]: テキスト` came back as one definition reading
  // "テキスト", and the words before the caret were gone.
  //
  // A hard break instead, which is the answer a table cell already gives (issue #8): both are
  // inline-only for the same reason, that the markdown line form they serialize to cannot hold block
  // structure. Nothing new can be authored by it either — Shift+Enter has always made one here, and
  // `[^a]: 注A\` + a continuation line round-trips as the same hardBreak node (measured), so this
  // only routes a third key to the shape the other two already produce.
  //
  // Declines outside a definition so the key falls through to baseKeymap, and `setHardBreak` reports
  // its own failure, which keeps this from swallowing an Enter it did not act on.
  // Backspace at the start must not join, and Delete at the end must not pull the next one in — the
  // same defect as the Enter split, arrived at from the other side. A join keeps one label and drops
  // the other, so the second note's words end up filed under the first note's label: measured,
  // `[^a]: 注A` and `[^b]: 注B` became `[^a]: 注A注B`, and `[^b]` was left empty and unpublishable.
  // §5.1 already says a definition is never deleted on its own and goes only with its reference; a
  // join is that rule broken from inside the section.
  //
  // Refused with the notice rather than silently, which is also what retires a dead key. Erasing a
  // note's text leaves the definition empty and its reference marked (§5.2), and Backspace there did
  // nothing at all and said nothing — indistinguishable from a broken key. It now says where the
  // author has to go, the way the placement guards do.
  //
  // Deliberately *not* "delete the footnote once the definition is empty". The reference is
  // somewhere else in the prose, possibly off screen, and Backspace repeats: an author clearing a
  // note by holding the key would run past the empty state and take the reference with it. An empty
  // definition is also a state every retyped note passes through, which is the same reason autosave
  // refuses to overwrite a title that is briefly blank (lib/posts-write.ts).
  addKeyboardShortcuts() {
    const refuseJoin = (atEdge: (offset: number, size: number) => boolean) => () => {
      const { selection } = this.editor.state;
      const { $from, empty } = selection;
      if (!empty || $from.parent.type.name !== 'footnoteDefinition') return false;
      if (!atEdge($from.parentOffset, $from.parent.content.size)) return false;
      this.options.onBlocked('脚注を削除するには、本文中の参照を削除してください。');
      return true;
    };

    // Not `setHardBreak`. @tiptap/extension-hard-break refuses outright when the caret's parent node
    // is isolating (dist/index.js:39), and the definition is *both* the isolating node and the
    // textblock the caret sits in — measured, adding `isolating` above turned Enter into a silent
    // no-op and the next characters simply ran on. A table cell escapes that only because its
    // textblock is an ordinary paragraph nested inside the isolating cell.
    //
    // All three keys go through here for the reason the table states: HardBreak binds Shift+Enter
    // and Mod+Enter straight to `setHardBreak`, so leaving them alone would leave two dead keys
    // where the canonical line break used to be. Each declines outside a definition, so HardBreak's
    // own bindings answer them everywhere else.
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
const footnoteClipboardKey = new PluginKey('footnoteClipboard');
const footnoteOrphanNoticeKey = new PluginKey('footnoteOrphanNotice');

// A label is an opaque, stable id (§4). It is never shown — the number the reader sees is derived
// from document order — so it only has to be unique within the document and survive reordering.
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

// A definition no reference points at has no number to sort by. §5.4 keeps it regardless, so it
// sinks to the end of the section and holds its place among the other unreferenced ones.
const UNREFERENCED = Number.MAX_SAFE_INTEGER;

function rankOf(definition: PMNode, order: Map<string, number>): number {
  return order.get(definition.attrs.label as string) ?? UNREFERENCED;
}

// Where a new definition goes for the section to stay in reference order (§3): in front of the first
// one the reader would meet later than this.
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

// §3's other half, and the one that was never built: the definitions' order follows the references'.
// The number is a decoration recomputed from document order on every state, so without this the
// section carries the right numbers in the wrong sequence — measured, adding a footnote between two
// others left the column reading [1], [3], [2]. The published page never showed it, since remark-gfm
// rebuilds the section from reference order at render time; the editor and the saved markdown were
// the two that disagreed with it.
//
// Not while the caret is inside the section. The rebuild is one replacement over all of its content,
// and an author typing a note would have the selection mapped out from under them. Nothing reachable
// is given up by that: a reference cannot live inside a definition (§6.2's placement guard), so no
// edit made in there can change the order. It is cover for a route that does not exist yet rather
// than a case deferred.
//
// Nothing is needed on load either. markdown-it-footnote's tail walks `env.footnotes.list`, which is
// indexed by reference, so the parser hands definitions over in reference order whatever the file
// said — measured, and just as well: the editor takes its content through `useEditor({ content })`,
// not a transaction, so no appended transaction runs there to sort them.
// Sorts in place, on a transaction already under construction rather than as one of its own, and
// that is not tidiness. prosemirror-state gives a plugin exactly one appendTransaction per apply
// cycle: once it appends, its `seen[i].n` is the transaction list's new length, and the next pass
// finds nothing after it to answer. Returning a sort *after* the paste's materialize step therefore
// never ran — measured, the pasted definition stayed at the end of the section. So each step folds
// the sort into whatever it is already returning.
//
// Returns whether it changed anything, so a caller with nothing else to say can return null.
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
function footnotePairing(onBlocked: (message: string) => void): Plugin {
  return new Plugin({
    key: footnotePairingKey,
    appendTransaction: (transactions, oldState, state) => {
      if (!transactions.some((transaction) => transaction.docChanged)) return null;
      if (transactions.some(isHistoryTransaction)) return null;
      if (hasUndoableInputRule(state)) return null;
      if (oldState.doc.eq(state.doc)) return null;

      // §6.2 — the label is settled here and not at paste time. transformPasted sees only the
      // slice, so deciding there would mean minting a new label every time and a cut-and-paste
      // would change the label of a footnote that merely moved. Here the destination document is
      // in hand: the carried label is reused when it is free (a move) and replaced when it is
      // already spoken for (a duplicate), which is what keeps §4's one reference = one definition.
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
      // Losing every definition means losing the section: its content is `footnoteDefinition+`, so
      // an empty one is not a document ProseMirror will build. Deleting the definitions one by one
      // in that case simply does nothing — measured, the reference went and the definition stayed.
      if (survivors === 0) {
        tr.delete(sectionStart, state.doc.content.size);
      } else {
        for (const { from, to } of doomed.reverse()) tr.delete(from, to);
        // Deleting cannot disorder what is left, but this is the plugin's one turn — if the same
        // edit both took a footnote away and moved another, there is no second pass to sort in.
        sortDefinitions(tr);
      }
      return tr;
    },
  });
}

// Give every reference that arrived carrying a note (§6.1) its definition back — or take the
// reference away, when it landed somewhere §6 does not allow one.
//
// Both answers live here rather than in `transformPasted` because only here is the destination
// known. A paste puts it in `view.state.selection`, but a drop does not: while transformPasted
// runs, the selection is still the range being dragged. Answering there sent a footnote into a
// table cell (measured), and answering in both places would be the two-rules-for-one-event shape
// §6 opens by warning about.
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

  // A label is spoken for by another *reference*, never by a definition. This is what tells a move
  // from a duplicate: a dragged footnote arrives while its own definition is still in the section —
  // the whole move is one transaction, so nothing deleted it — and counting that definition as a
  // claim would mint a new label, build a second definition, and leave the first an orphan.
  // Measured before the distinction existed, on both a drag into prose and one into a cell.
  const claimed = new Set<string>();
  const definitions = new Set<string>();
  state.doc.descendants((node) => {
    if (node.type === definitionType) definitions.add(node.attrs.label as string);
    else if (node.type === referenceType && node.attrs.pendingNote === null) {
      claimed.add(node.attrs.label as string);
    }
  });

  type Plan = { pos: number; node: PMNode; label: string; refused: boolean };
  const plans: Plan[] = [];
  let refusal: string | null = null;
  for (const { pos, node } of pending) {
    const refusedHere = hostRefusalAt(state.doc.resolve(pos));
    if (refusedHere) {
      refusal = refusedHere;
      plans.push({ pos, node, label: node.attrs.label as string, refused: true });
      continue;
    }
    const carried = node.attrs.label as string;
    const label = claimed.has(carried)
      ? mintLabelAvoiding(new Set([...claimed, ...definitions]))
      : carried;
    claimed.add(label);
    plans.push({ pos, node, label, refused: false });
  }

  const tr = state.tr;
  const created: PMNode[] = [];
  for (const plan of plans) {
    if (plan.refused) continue;
    // A move brings its own definition with it — it was never deleted — so only make one when the
    // label has none.
    if (definitions.has(plan.label)) continue;
    definitions.add(plan.label);
    const note = plan.node.attrs.pendingNote as string;
    created.push(
      definitionType.create({ label: plan.label }, note === '' ? null : state.schema.text(note)),
    );
  }

  // Backwards, because a refusal replaces a one-wide atom with several characters and every
  // position after it would move.
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

// §5.4 — an orphan definition is kept, and the author is told. Keeping it silently is the half that
// would be indistinguishable from a bug: the note is in the document and in the saved markdown, it
// carries `[?]` instead of a number, and nothing says why.
//
// Reported per label and only once. The document holding an orphan is a state, not an event, so
// firing on every transaction would put a toast over the text on every keystroke. A label that
// stops being an orphan is forgotten again, so writing the missing reference and then deleting it
// reports afresh — which is right, because it is news again.
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

// §6.1 — a reference carries its note through the clipboard.
//
// The naive rule (drop a reference to plain text unless the slice carries its definition) is right
// for a paste from outside and wrong inside the document. Definitions live in a section at the end
// (§3), so a copied paragraph never carries one, and duplicating a paragraph that has a footnote
// would silently degrade it; cutting is worse, since removing the reference takes the definition
// with it (§5.1) and the note's words go with it.
//
// So the note travels on the reference itself. Everything else falls out of that: a duplicate has a
// note and keeps its footnote, a cut-and-paste has one and keeps its words, and only a reference
// from somewhere else arrives with nothing and falls back to plain text.
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

      // A drop is refused outright rather than repaired after the fact. A drop *moves*: the source
      // is deleted by the same transaction that inserts, so letting a refused reference fall to
      // plain text at the destination takes its definition's reference away and leaves the note an
      // orphan — the document ends up worse than if nothing had happened (measured). Refusing the
      // whole gesture is also what the table drop guard does, and it loses nothing: a refused drop
      // deletes no source.
      //
      // Only a drop needs this. A paste leaves its source alone, so the repair in
      // materializePendingNotes is enough there.
      handleDrop: (view, event, slice) => {
        const referenceType = view.state.schema.nodes.footnoteReference;
        if (!referenceType) return false;
        let carriesReference = false;
        slice.content.descendants((node) => {
          if (node.type === referenceType) carriesReference = true;
        });
        if (!carriesReference) return false;

        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!at) return false;
        const refused = hostRefusalAt(view.state.doc.resolve(at.pos));
        if (!refused) return false;

        onBlocked(refused);
        return true;
      },

      // transformPasted is not paste-only — prosemirror-view runs it over `view.dragging.slice` on
      // a drop too, which is exactly what §6.4 wants: one rule answering both gestures, rather than
      // a second one in isolating-boundary.ts giving a drop its own answer.
      transformPasted: (slice, view) => {
        // Only the "did it bring a note" half is decided here. Where it landed is not knowable yet
        // for a drop, so §6.3's placement question is asked once the slice is in the document —
        // see materializePendingNotes.
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

// Walk a slice and replace every footnoteReference with whatever `swap` returns. Written over
// Fragment rather than a transaction because a slice is not in the document yet — there are no
// positions to address and nothing to dispatch.
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

// Both routes do the same thing (§9): put a reference where the caret is, create its empty
// definition, and **leave the caret in the prose**. Sending it to the definition would break the
// flow footnotes exist to protect — thinking of an aside while writing a sentence.
//
// One transaction, not two. Beyond the undo atomicity §5.1 asks for, it is what keeps the `[^`
// rule's undo record alive: any second transaction in the same round clears the record
// undoInputRule needs, which is the trap trailing-node-extension.ts was written to answer.
// §6's placement rules. A cell is the one place markdown's pipe form breaks easily — this editor
// has lost a table's pipe form twice already to content it could not put on one line — and a code
// block holds text and nothing else.
//
// `selectionTouches` rather than `editor.isActive`: isActive requires the node to *cover* the whole
// range, so it answers false for a selection reaching one character past a table's edge, and every
// guard written that way waved a mixed selection through. It also answers for a caret, since
// nodesBetween(pos, pos) still visits the nodes containing pos.
// The same rules asked of one position rather than of the selection. A drop needs this: at the
// moment `transformPasted` runs, `view.state.selection` is still the *dragged* range, not where it
// is about to land, so a selection-based check answers about the wrong place entirely — measured,
// a footnote dragged into a table cell went straight in.
function hostRefusalAt($pos: ResolvedPos): string | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const name = $pos.node(depth).type.name;
    if (name === 'tableCell' || name === 'tableHeader') return '脚注は表のセル内には置けません。';
    if (name === 'codeBlock') return '脚注はコードブロック内には置けません。';
    if (name === 'footnoteSection' || name === 'footnoteDefinition') {
      return '脚注の中に脚注は置けません。';
    }
  }
  return null;
}

function placementRefusal(state: EditorState): string | null {
  if (selectionTouches(state, 'tableCell', 'tableHeader')) {
    return '脚注は表のセル内には置けません。';
  }
  if (selectionTouches(state, 'codeBlock')) {
    return '脚注はコードブロック内には置けません。';
  }
  // A definition holds inline content, so a reference *fits* inside one — the schema will not stop
  // it. Nested footnotes are a non-goal (§1), and a reference living in the section would also make
  // the materialization below insert into what it is walking.
  if (selectionTouches(state, 'footnoteSection', 'footnoteDefinition')) {
    return '脚注の中に脚注は置けません。';
  }
  return null;
}

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
    // In reference order (§3), not at the end. This has to happen inside *this* transaction rather
    // than being left to the reconciliation below, and the input rule is why: typing `[^` records an
    // undoable input rule, and footnotePairing steps aside while that record is alive because any
    // appended transaction clears what undoInputRule needs (§9.1, criterion 8). An appended reorder
    // would therefore not run until the author's next keystroke — the definition would sit in the
    // wrong place, in plain sight, until something unrelated moved it.
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
