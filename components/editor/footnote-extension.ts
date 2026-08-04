import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type MarkdownIt from 'markdown-it';
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs';
import type Token from 'markdown-it/lib/token.mjs';
import footnotePlugin from 'markdown-it-footnote';
import type { MarkdownSerializerState } from './markdown-serializer-state';

// SPIKE — the markdown layer for footnotes and nothing else (docs/footnote-requirements.md §7).
// No definition section (§3), no TrailingNode change (§3.1), no guards (§6), no insertion route
// (§9), no styling. Registered so the one question no amount of design writing can answer —
// does load → serialize → load hold — can be answered before the rest is built.
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
