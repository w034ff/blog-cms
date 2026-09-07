import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { postEditorExtensions } from './extensions';
import { DRAGGABLE_TYPES } from './block-drag-handle';

// The schema-level fact §7.7 of docs/link-card-requirements.md reasons from, kept true by a test
// rather than by a comment.
//
// Two things depend on it. `pressedNativeDragSource` (block-drag-handle.ts) refuses a drag whose
// press point has a `draggable="true"` ancestor inside `view.dom`, and it is written that way —
// rather than as "the press landed inside a DRAGGABLE_TYPES block" — because a TextSelection
// dragged out of a quote or a code block must keep working. That scope is only equivalent to "one
// of the handled types" while every `draggable: true` node is a handled type. And `useImageUpload`'s
// `hasFiles` reads `types.includes('Files')` as "a file arrived from outside the page", which holds
// only because no in-editor drag reaches it any more: Chrome builds an in-page image drag out of
// the picture itself, and that drop re-uploaded the image and split the paragraph it landed in
// (measured 2026-09-08).
//
// So a node type that declares `draggable: true` without joining the handle's list reopens both at
// once, silently. The schema is built from `postEditorExtensions` itself, not from a list rebuilt
// here — a hand-picked list would pass while the editor's own registration was the thing that
// changed.
describe('DRAGGABLE_TYPES covers every natively draggable node', () => {
  const schema = getSchema(postEditorExtensions(() => {}));
  const nativelyDraggable = Object.values(schema.nodes)
    .filter((type) => type.spec.draggable === true)
    .map((type) => type.name)
    .sort();

  it('finds the three the audit named, so the assertion below is not vacuous', () => {
    expect(nativelyDraggable).toEqual(['embed', 'image', 'linkCard']);
  });

  it('leaves none of them without a handle', () => {
    expect(nativelyDraggable.filter((name) => !DRAGGABLE_TYPES.has(name))).toEqual([]);
  });

  // The converse is deliberately not asserted: blockquote, table, codeBlock and the rest are in
  // DRAGGABLE_TYPES for the handle alone and declare nothing, which is why the refusal is scoped to
  // the attribute rather than to this set.
  it('is a superset, not the same list', () => {
    expect(DRAGGABLE_TYPES.size).toBeGreaterThan(nativelyDraggable.length);
  });
});
