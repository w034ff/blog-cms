'use client';

import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';

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
// added later from quietly reopening it. Chrome a NodeView claims needs its own copy of this
// refusal even so (refuseChromeDrops below): it sits *inside* view.dom, so it passes the
// containment test here and is refused there instead.
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

// The same refusal for chrome that lives *inside* `view.dom`, which the containment guard above
// deliberately lets through.
//
// A NodeView that claims its own controls with `stopEvent` puts them outside ProseMirror's drop
// path entirely: `eventBelongsToView` walks up from `event.target` and gives up as soon as a
// `stopEvent` claims it, so no `handleDrop` prop runs and no transaction removes the dragged range.
// Whatever the browser does with the drop it is left holding is then the whole answer — and for a
// natively droppable control that answer is a *move*, which deletes the source out of the
// contenteditable behind ProseMirror's back. Measured on the link card's picker (2026-08-22):
//
//   before  doc(paragraph("前の段落です"), linkCard, paragraph("後の段落です"))
//   after   doc(paragraph("です"),        linkCard, paragraph("後の段落です"))   search box: 前の段落
//
// `claims` must mirror the NodeView's own `stopEvent` predicate rather than the whole element: the
// card's body is an ordinary block position and a drop *beside* it has to keep working, so refusing
// everything inside `dom` would take away a landing spot the drop cursor is still offering.
//
// Gated on `view.dragging` for the containment guard's reason: a file from the OS and a drag inside
// one of these controls both leave it null and are none of this function's business.
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
