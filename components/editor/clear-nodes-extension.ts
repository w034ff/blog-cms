import { Extension } from '@tiptap/core';
import type { RawCommands } from '@tiptap/core';
import type { ContentMatch, NodeType } from '@tiptap/pm/model';
import { liftTarget } from '@tiptap/pm/transform';

// Replaces TipTap's own `clearNodes` command (@tiptap/core 3.31.3, `src/commands/clearNodes.ts`),
// which throws in this document. Upstream's body with one expression changed, so the diff against
// a future version stays readable.
//
// Upstream sets each textblock to `contentMatchAt(index).defaultType` unchecked. In a
// `block+ footnoteSection?` doc that is `footnoteSection` at every top-level index ≥ 1, and the
// markup change throws "RangeError: Invalid content for node type footnoteSection" — reached by
// `Mod-Alt-0` on almost any line (docs/editor-pitfalls.md §8.1, §8.2). Other @tiptap `defaultType`
// readers ask at index 0, where the doc still answers `paragraph`, so only this command is replaced.
//
// `clearEmptyCodeBlock` in code-block-extension.ts is not redundant with this: it deliberately
// skips the lift below (an emptied fence stays in its list item), and delegating to base CodeBlock
// would bring back its `$anchor.pos === 1` branch. Leave both.

// prosemirror-commands' `defaultBlockAt`, with `paragraph` preferred when the match admits it.
//
// The filter alone would stop the throw, but `heading` passes it too (its `level` has a default)
// and edge order shifts by index, so a blank line could become a heading. Asking for `paragraph` by
// name first removes that.
//
// The fallback is load-bearing: inside `details`, which admits no paragraph, the scan returns
// `detailsSummary` itself and the markup call is a no-op as upstream. A null reads as "keep this
// node's type" in `setNodeMarkup`, so attrs still reset to defaults.
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

// Default priority suffices: core extensions come first in a stable sort and later `addCommands()`
// spread over earlier ones, so this wins the name over core's `Commands`.
export const ClearNodes = Extension.create({
  name: 'clearNodesFix',

  addCommands() {
    return { clearNodes };
  },
});
