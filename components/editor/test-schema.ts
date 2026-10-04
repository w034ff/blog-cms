// Fixtures for the editor guards that are pure functions over a document, a slice, or the schema.
// Imported by tests only; nothing in the editor reads this file.
//
// It exists so that a vitest case is as cheap to write as an E2E spec; which layer a claim belongs
// in is AGENTS.md's "Where an editor test goes".

import { getSchema } from '@tiptap/core';
import type { Node as PMNode, Schema, Slice } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { postEditorExtensions } from './extensions';

// **The editor's own registration, not a list re-written here:** a hand-picked list passes
// precisely when what PostEditor registers is the thing that changed.
//
// `showNotice` is the editor's refusal channel and no schema depends on it, so it is a no-op here.
export const schema: Schema = getSchema(postEditorExtensions(() => {}));

export const nodes = schema.nodes;
export const marks = schema.marks;

export const text = (value: string): PMNode => schema.text(value);

/** A paragraph, empty when given nothing — the filler every fixture below is built out of. */
export const para = (value?: string): PMNode =>
  nodes.paragraph.create(null, value ? text(value) : null);

/** A whole document. `schema.topNodeType` rather than `nodes.doc`, since the footnote extension replaces it. */
export const docOf = (...content: PMNode[]): PMNode => schema.topNodeType.create(null, content);

// The two slice shapes the gestures produce, **taken from a real selection, never built by hand**
// (`Selection.content()` is `doc.slice(from, to, true)`). Assert the open depths before relying on
// them; they are the whole difference between these two.

/** What the block drag handle hands a guard: one whole node, closed on both sides. */
export const nodeSlice = (doc: PMNode, pos: number): Slice =>
  NodeSelection.create(doc, pos).content();

/** What a selection sweeping across a boundary hands a guard: open on both sides. */
export const rangeSlice = (doc: PMNode, from: number, to: number): Slice =>
  TextSelection.create(doc, from, to).content();

/**
 * A one-row table and a caret resolved inside its first body cell.
 *
 * The cell rules walk ancestors, so the position has to come from a real document — a hand-built
 * `ResolvedPos` would not exercise them. Callers should assert `$inCell` really is in a cell before
 * relying on it: that check is what keeps a refusal from reading as correct for the wrong reason.
 */
export function tableFixture(
  first = 'セルの中身',
  second = '二つ目',
): {
  doc: PMNode;
  $inCell: ReturnType<PMNode['resolve']>;
} {
  const { table, tableRow, tableCell } = nodes;
  const doc = docOf(
    table.create(null, [
      tableRow.create(null, [
        tableCell.create(null, para(first)),
        tableCell.create(null, para(second)),
      ]),
    ]),
  );
  // Inside the first cell's paragraph: back off the second cell, its paragraph, the row and the
  // table, then the first cell's own text.
  return { doc, $inCell: doc.resolve(doc.content.size - first.length - 6) };
}
