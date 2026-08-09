import { Extension } from '@tiptap/core';
import type { RawCommands } from '@tiptap/core';
import type { ContentMatch, NodeType } from '@tiptap/pm/model';
import { liftTarget } from '@tiptap/pm/transform';

// Replaces TipTap's own `clearNodes` command (@tiptap/core 3.28.0,
// `src/commands/clearNodes.ts`), which throws in this document. Everything else about it is kept —
// this is upstream's body with one expression changed, deliberately, so the diff against a future
// version stays readable.
//
// The command normalizes the selected nodes to "the default block", and picks that type with
//
//   const { defaultType } = $mappedFrom.parent.contentMatchAt($mappedFrom.index());
//   tr.setNodeMarkup(nodeRange.start, defaultType);
//
// taking `defaultType` unchecked. `ContentMatch.defaultType` returns the first type the match
// admits that is neither text nor in need of required attrs — it is not required to be a textblock,
// and in this schema it usually isn't. Our `doc` is `block+ footnoteSection?`
// (footnote-extension.ts), so once `block+` is satisfied — i.e. at every top-level position but the
// first child — the match admits `footnoteSection` first and that is what comes back. Measured on
// the live schema, `doc.contentMatchAt(i).defaultType`:
//
//   0: paragraph | 1: footnoteSection | 2: footnoteSection | …
//
// Setting a paragraph to a node whose content is `footnoteDefinition+` raises "RangeError: Invalid
// content for node type footnoteSection", uncaught, out of a keymap handler.
//
// The reachable gesture is `Mod-Alt-0`, which @tiptap/extension-paragraph binds to `setParagraph()`
// with no conditions. That lands here because prosemirror-commands' `setBlockType` skips a node
// that already `hasMarkup` the target type, so asking for a paragraph while in one leaves it
// `applicable === false` and `setNode` falls through to `clearNodes()`. The caret has to be in a
// top-level block that is not the document's first child — which is to say, on almost any line of a
// real post. Reported from ordinary use; a blank line under a paragraph is enough.
//
// prosemirror-commands never had the problem because it resolves the same idiom through
// `defaultBlockAt()`, which filters the match's edges to textblocks. Every *other* `defaultType`
// reader in @tiptap is safe for a different reason: horizontal-rule, trailing-node, details and
// splitListItem all read the *initial* content match (or `contentMatchAt(0)`), where the doc still
// answers `paragraph`. `clearNodes` is the only one that asks at an arbitrary index, which is why
// this is the only command replaced here.
//
// Not merged into the code block's own escape: `clearEmptyCodeBlock` in code-block-extension.ts
// looks redundant once this is safe and is not. It also drops the `tr.lift(...)` below on purpose —
// an emptied fence stays in its list item, which the boundary specs assert — and delegating back to
// base CodeBlock would bring its `$anchor.pos === 1` branch back with it. Leave both.

// prosemirror-commands' `defaultBlockAt`, with `paragraph` preferred when the match admits it.
//
// Upstream's filter alone would be enough to stop the throw, but it takes the match's edges in
// order and both `paragraph` and `heading` pass it (a heading's `level` has a default, so
// `hasRequiredAttrs()` is false). The edge order is not the same at every index — `defaultType` is
// `paragraph` at index 0 and `footnoteSection` after it, so the order demonstrably shifts — and
// "normalize to a simple paragraph" turning a blank line into a heading would be a worse bug than
// the one being fixed. Asking for `paragraph` by name first removes the question; it is also the
// type this command's own docblock says it produces.
//
// The fallback is load-bearing rather than defensive. `clearNodes` visits every non-text node in
// range, and `detailsSummary` is a textblock whose parent (`details`) admits no paragraph at all;
// there the edge scan returns `detailsSummary` itself and the markup call is a no-op, exactly as
// upstream behaves. Returning null is also upstream's shape — `setNodeMarkup` reads a falsy type as
// "keep this node's type", so the attrs still reset to their defaults the way they always did.
function clearTargetAt(match: ContentMatch, paragraph: NodeType): NodeType | null {
  if (match.matchType(paragraph)) return paragraph;
  for (let i = 0; i < match.edgeCount; i += 1) {
    const { type } = match.edge(i);
    if (type.isTextblock && !type.hasRequiredAttrs()) return type;
  }
  return null;
}

const clearNodes: RawCommands['clearNodes'] =
  () =>
  ({ state, tr, dispatch }) => {
    const { ranges } = tr.selection;

    if (!dispatch) return true;

    const paragraph = state.schema.nodes.paragraph;

    ranges.forEach(({ $from, $to }) => {
      state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
        if (node.type.isText) return;

        const { doc, mapping } = tr;
        const $mappedFrom = doc.resolve(mapping.map(pos));
        const $mappedTo = doc.resolve(mapping.map(pos + node.nodeSize));
        const nodeRange = $mappedFrom.blockRange($mappedTo);

        if (!nodeRange) return;

        const targetLiftDepth = liftTarget(nodeRange);

        if (node.type.isTextblock) {
          // The one changed line. Upstream: `const { defaultType } = …contentMatchAt(…)`.
          const target = clearTargetAt(
            $mappedFrom.parent.contentMatchAt($mappedFrom.index()),
            paragraph,
          );

          tr.setNodeMarkup(nodeRange.start, target);
        }

        if (targetLiftDepth || targetLiftDepth === 0) {
          tr.lift(nodeRange, targetLiftDepth);
        }
      });
    });

    return true;
  };

// A command-only extension, at the default priority. ExtensionManager prepends the core extensions
// to this array and sorts by priority with a stable sort, then builds the command map by spreading
// each extension's `addCommands()` over the last — so a same-priority extension declared in
// PostEditor's array is gathered after core's `Commands` and wins the name. Nothing here registers
// a plugin or a key, so there is no ordering question beyond that one.
export const ClearNodes = Extension.create({
  name: 'clearNodesFix',

  addCommands() {
    return { clearNodes };
  },
});
