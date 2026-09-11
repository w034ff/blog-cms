// Fixtures for the editor guards that are pure functions over a document, a slice, or the schema.
// Imported by tests only; nothing in the editor reads this file.
//
// **Why it exists.** Five test files each rebuilt this schema by hand — 51, 67, 81 and 172 lines
// before their first `describe()` — while a new E2E spec needs two imports and is writing
// assertions on line three (measured 2026-09-11). So the layer that costs ~1ms a case was the
// expensive one to write and the layer that costs ~2.3s a case was the cheap one, and the browser
// won by default. This is the asymmetry, not a preference, and this file is the fix for it.
//
// A guard belongs here when its claim can be written against a `Slice`, a content expression, or a
// markdown string. It belongs in `e2e/` when only a browser can observe it: input rules, keymaps,
// NodeViews, geometry, IME, a real drag, CSS.

import { getSchema } from '@tiptap/core';
import type { Node as PMNode, Schema, Slice } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { postEditorExtensions } from './extensions';

// **The editor's own registration, not a list re-written here.** Every file that used to assemble
// this claimed in a comment to be using "the schema PostEditor actually builds" while in fact
// hand-listing the extensions, which passes precisely when what PostEditor registers is the thing
// that changed. `draggable-types.test.ts` made that argument first and built the schema this way;
// the rest is that argument applied.
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

// The two slice shapes the gestures really produce, **taken from a real selection and never built
// by hand**. `Selection.content()` is `doc.slice(from, to, true)`, and a hand-built `Slice` that
// happens to agree with one proves nothing about the gesture it stands for — a two-argument fixture
// once made a whole suite vacuous without failing (2026-08). Assert the open depths of what comes
// back before a test leans on it; `openStart`/`openEnd` are the whole difference between these two.

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
