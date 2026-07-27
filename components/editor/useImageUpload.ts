'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, RefObject } from 'react';
import type { Editor } from '@tiptap/core';
import { Selection } from '@tiptap/pm/state';
import { ALLOWED_IMAGE_MIME_TYPES } from '@/lib/uploads';
import { selectionTouches } from './selection-scan';

const ALLOWED_IMAGE_TYPE_SET = new Set(ALLOWED_IMAGE_MIME_TYPES);

// The image files in a paste/drop payload, everything else filtered out.
export function imageFilesFromList(list: FileList | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter((file) => ALLOWED_IMAGE_TYPE_SET.has(file.type));
}

// Build a starting alt text from a dropped/pasted file name: drop the extension
// and turn separators into spaces so it reads as words. It seeds the image's alt
// attribute (which tiptap-markdown serializes to `![alt](url)`); the author can
// refine it later. Strip characters that would break the markdown image.
function altTextFromFilename(name: string): string {
  return name
    .replace(/\.[^./\\]+$/, '')
    .replace(/[[\]\r\n]+/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Shown when an insert is refused because of where the selection is. Named per host rather than
// stating the rule both ways, because the case that most needs explaining is the one where the
// author doesn't know they're near the host at all: a selection reaching out of a paragraph into a
// table refuses, and naming the table is what makes that legible ("my selection runs into it")
// where a message covering both would leave them working out which half applies. A selection can
// touch both at once (a range from a table through to a code block, or Mod-a), which is what the
// third message is for — rare, so its extra length costs nothing.
//
// None of them says 「中」: the guard fires on a selection *touching* a host, and for a range that
// merely reaches into one the caret is not inside it, so "inside" would be quietly wrong in exactly
// the case above. Neither host can hold a block node — a cell is paragraph-only, a code block is a
// `code` textblock (see the guard below).
const IMAGE_BLOCKED_IN_TABLE = '表のセルには画像を挿入できません';
const IMAGE_BLOCKED_IN_CODE_BLOCK = 'コードブロックには画像を挿入できません';
const IMAGE_BLOCKED_IN_BOTH = '表のセルとコードブロックには画像を挿入できません';

// How long the notice stays up. Long enough to read one short line, short enough that it doesn't
// linger over the text being edited.
const BLOCKED_NOTICE_MS = 3000;

// The editor's image-upload concern: send files to /api/uploads and insert each
// as an image node at the cursor, from any of the three entry points — the
// toolbar's file picker (handleImageChange), paste (uploadImages), and
// window-wide drag-and-drop (handled here, surfaced as `dragging` for the drop
// overlay). The editor arrives through a ref so every returned callback keeps a
// stable identity and can be closed over by editor handlers created once.
export function useImageUpload(editorRef: RefObject<Editor | null>) {
  const [uploading, setUploading] = useState(false);
  // True while a file is being dragged over the window, so a drop overlay
  // appears on the editor container as a target.
  const [dragging, setDragging] = useState(false);
  // The refusal notice, or null when there is nothing to say. The toolbar's picker greys itself out
  // where an insert can't land, but paste and drag-and-drop have no control to grey — they just
  // did nothing, with no way to tell why. This is what the editor shows them instead.
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const blockedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Raise the notice and start its countdown, restarting the clock if one is already up (a second
  // refused paste should get its own full three seconds, not the tail of the first).
  const showBlocked = useCallback((message: string): void => {
    setBlockedMessage(message);
    if (blockedTimer.current !== null) clearTimeout(blockedTimer.current);
    blockedTimer.current = setTimeout(() => {
      blockedTimer.current = null;
      setBlockedMessage(null);
    }, BLOCKED_NOTICE_MS);
  }, []);

  // A pending timer would fire into an unmounted component when the editor is torn down.
  useEffect(() => {
    return () => {
      if (blockedTimer.current !== null) clearTimeout(blockedTimer.current);
    };
  }, []);

  const uploadFile = useCallback(async (file: File): Promise<string | null> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/uploads', { method: 'POST', body: formData });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (res.ok && typeof data.url === 'string') return data.url;
    window.alert(`アップロードに失敗しました: ${data.error ?? res.status}`);
    return null;
  }, []);

  // Upload each image and insert it at the cursor as an editor image node. The
  // insertion is a transaction, so onUpdate re-serializes the body and marks the
  // post edited — no manual body/markEdited bookkeeping needed here.
  const uploadImages = useCallback(
    async (files: File[]): Promise<void> => {
      const editor = editorRef.current;
      if (!editor) return;
      // Not into a table cell or a code block. The image node is a block, and neither of those
      // can hold one — cells are paragraph-only (table-extensions.ts), a code block is a `code`
      // textblock — so ProseMirror makes room by splitting the host in two around the image,
      // and both halves come out corrupt in the saved markdown:
      //   table: the headerless half can't be a GFM pipe table, so it degrades to a raw <table>
      //   code block: the code splits mid-token and the second fence loses its own line, so the
      //     backticks and the code after them render as body text on the published page
      // Same refusal as setCallout and the table picker, for the same reason. `editor.can()
      // .setImage()` reports true in both, so this has to be an explicit check. Gating before
      // the loop also means nothing is uploaded for an insert that was never going to land.
      // Callouts and blockquotes are fine and deliberately absent: both are `block+`, so an
      // image drops straight in without splitting anything.
      //
      // selectionTouches, not `editor.isActive(...)`: the latter only holds for a caret (see
      // selection-scan.ts), and with a selection reaching from the paragraph above into either
      // host, setImage replaced the range instead of splitting it — the table disappeared, and
      // the code block came out empty (its markdown an empty fence).
      // Asked per host so the notice can name the one in the way; both together is its own case.
      const inTable = selectionTouches(editor.state, 'table');
      const inCodeBlock = selectionTouches(editor.state, 'codeBlock');
      if (inTable || inCodeBlock) {
        showBlocked(
          inTable && inCodeBlock
            ? IMAGE_BLOCKED_IN_BOTH
            : inTable
              ? IMAGE_BLOCKED_IN_TABLE
              : IMAGE_BLOCKED_IN_CODE_BLOCK,
        );
        return;
      }
      setUploading(true);
      try {
        for (const file of files) {
          const url = await uploadFile(file);
          if (url === null) continue;
          editor
            .chain()
            .focus()
            .setImage({ src: url, alt: altTextFromFilename(file.name) })
            .run();
        }
      } finally {
        setUploading(false);
      }
    },
    [editorRef, uploadFile, showBlocked],
  );

  // While a file is dragged anywhere over the window, show a drop overlay and let
  // a drop add the image where it was dropped. Intercepting the drag also stops the
  // browser default (opening the dropped image as a page and navigating away from
  // the editor, losing the draft). Only file drags count, so dragging text within
  // the editor is unaffected. dragenter/dragleave fire for descendants too, so a
  // depth counter tracks whether the pointer is still somewhere over the window.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    const handleDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth += 1;
      setDragging(true);
    };
    const handleDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth -= 1;
      if (depth <= 0) {
        depth = 0;
        setDragging(false);
      }
    };
    const handleDragOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const handleDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const files = imageFilesFromList(event.dataTransfer?.files);
      if (files.length === 0) return;
      // Move the caret to where the file was let go, then hand over to the shared upload path,
      // which inserts at the selection. The image used to land at whatever the caret happened to
      // be when the drag started, so dropping onto a paragraph put the image somewhere else
      // entirely — and the refusal notice then described the caret's surroundings rather than the
      // place aimed at. Moving the selection first rather than inserting at a position keeps that
      // one path: the guard, the per-host message and the insert all read the selection, so all
      // three now speak about the drop point without a parallel position-aware copy of any of them.
      //
      // Selection.near rather than commands.focus(pos): posAtCoords can land on a spot that holds
      // no text (between blocks, or on a block image), and near() resolves to the closest place a
      // caret can actually sit. A selection-only transaction doesn't reach onUpdate (@tiptap/core
      // only emits `update` when a transaction changed the doc), so this can't mark the post edited.
      //
      // A drop outside the editor leaves posAtCoords null; those keep the old behaviour and insert
      // at the caret. The overlay covers the whole window and invites a drop anywhere, so refusing
      // there would contradict it — and preventDefault above still has to run either way, or the
      // browser navigates to the image and the draft is gone.
      const editor = editorRef.current;
      const at = editor?.view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (editor && at) {
        const { doc } = editor.state;
        editor.view.dispatch(
          editor.state.tr.setSelection(Selection.near(doc.resolve(at.pos))).scrollIntoView(),
        );
      }
      void uploadImages(files);
    };
    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [editorRef, uploadImages]);

  // The toolbar's file-picker entry point. Clearing target.value lets the same
  // file be picked twice in a row.
  const handleImageChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      await uploadImages([file]);
    },
    [uploadImages],
  );

  return { uploading, dragging, blockedMessage, uploadImages, handleImageChange };
}
