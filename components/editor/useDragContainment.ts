'use client';

import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { Editor } from '@tiptap/core';

// Content dragged out of the editor may not be dropped outside it.
//
// ProseMirror only ever sees the drop events that reach its own `view.dom` — prosemirror-view binds
// its handlers there, and `eventBelongsToView` discards even those that a NodeView's `stopEvent`
// claims. Everything else on the page is therefore outside its drop path entirely: no `handleDrop`
// prop runs and no transaction removes the dragged range, which leaves Chrome to run its own
// default action. For a selection dragged out of a contenteditable that action is a *move*, and it
// deletes the source nodes straight out of the DOM behind ProseMirror's back — a change it never
// authorized, cannot undo as one step, and (across a NodeView, whose ignoreMutation hides
// structural mutations outside the content hole) may not even observe.
//
// Measured on the post form, dragging a selection spanning a code block and the paragraph below it
// onto the タイトル field:
//
//   before  doc(paragraph("前の段落です"), codeBlock("const x = 1;\n"), paragraph("後の段落です"))
//   after   doc(paragraph("前の段落です"), codeBlock("c"), paragraph)
//   title   "onst x = 1;  後の段"
//
// The body is destroyed and the fragment lands in the title with its newlines flattened, where
// autosave then persists it.
//
// Bound once at the document rather than per field. PostEditor puts four text inputs beside the
// editor (タイトル / カテゴリ / タグ / 説明) and they are all exposed identically — the exposure is
// "anywhere but the editor", not "these four" — so guarding the boundary is what keeps a field
// added later from quietly reopening it. The code block header needs its own copy of this refusal
// even so (refuseEditorDrag in code-block-extension.ts): it sits *inside* view.dom, so it passes
// the containment test here and is refused there instead.
//
// Gated on `view.dragging`, which prosemirror-view sets only while content from this document is in
// flight. A file dragged in from the OS (useImageUpload's window handlers and their drop overlay),
// text dragged in from another application, and a drag within one of those inputs all leave it null
// and are untouched.
//
// Cancelling dragenter/dragover takes the drop away from the target's native handling, `dropEffect
// = 'none'` marks it refused, and `drop` is cancelled as well so nothing native runs if the refusal
// is reached late. All three together — the refusal was verified end to end rather than attributed
// to one of them. Listeners are on the bubble phase, so a value set here is the one left standing
// when the browser reads dropEffect at the end of the dispatch.
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
