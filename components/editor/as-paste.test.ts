import { EditorState } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { asPaste } from './isolating-boundary';
import { docOf, para } from './test-schema';

// The metas prosemirror-view's `doPaste` sets; a handlePaste that dispatches in its place must set
// the same, or prosemirror-history folds the paste into the preceding typing's undo event.
describe('asPaste', () => {
  it('marks the transaction as a paste and scrolls', () => {
    const tr = asPaste(EditorState.create({ doc: docOf(para('a')) }).tr);
    expect(tr.getMeta('paste')).toBe(true);
    expect(tr.getMeta('uiEvent')).toBe('paste');
    expect(tr.scrolledIntoView).toBe(true);
  });
});
