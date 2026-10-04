'use client';

import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';

// Content dragged out of the editor may not be dropped outside it.
//
// ProseMirror only sees drops that reach its own `view.dom`. Anywhere else, no `handleDrop` runs
// and Chrome performs its default *move*, deleting the source out of the contenteditable behind
// ProseMirror's back: a selection dragged onto the タイトル field destroyed the body and landed in
// the title, where autosave persisted it.
//
// Bound once at the document rather than per field, so a field added later is covered too
// (docs/editor-requirements.md §12.22 explains why three of the fields are currently unreachable).
// Chrome inside `view.dom` that a NodeView claims is handled by refuseChromeDrops below.
//
// Gated on `view.dragging`, which is set only while content from this document is in flight: OS
// files (useImageUpload), drags from other apps and drags within an input are untouched.
//
// dragenter/dragover are cancelled, `dropEffect = 'none'` marks the refusal, and `drop` is
// cancelled in case the refusal is reached late; the three were verified together, not singly.
// Bubble phase, so the dropEffect set here is the one the browser reads.
export function useDragContainment(editorRef: RefObject<Editor | null>): void {
  useEffect(() => {
    const refuse = (event: DragEvent) => {
      const editor = editorRef.current;
      if (!editor?.view.dragging) return;
      const { target } = event;
      if (target instanceof Node && editor.view.dom.contains(target)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    };
    document.addEventListener('dragenter', refuse);
    document.addEventListener('dragover', refuse);
    document.addEventListener('drop', refuse);
    return () => {
      document.removeEventListener('dragenter', refuse);
      document.removeEventListener('dragover', refuse);
      document.removeEventListener('drop', refuse);
    };
  }, [editorRef]);
}

// The same refusal for chrome that lives *inside* `view.dom`, which the containment guard above
// deliberately lets through.
//
// `eventBelongsToView` gives up once a NodeView's `stopEvent` claims the target, so a drop onto
// such a control gets the browser's native move (docs/editor-pitfalls.md §18). `claims` must
// mirror the NodeView's `stopEvent` rather than cover the whole element: a drop beside the card's
// body is an ordinary block position and has to keep working. Gated on `view.dragging` as above.
export function refuseChromeDrops(
  element: HTMLElement,
  claims: (target: HTMLElement) => boolean,
  view: () => EditorView,
): void {
  const refuse = (event: DragEvent) => {
    if (!view().dragging) return;
    const { target } = event;
    if (!(target instanceof HTMLElement) || !claims(target)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  };
  element.addEventListener('dragenter', refuse);
  element.addEventListener('dragover', refuse);
  element.addEventListener('drop', refuse);
}
