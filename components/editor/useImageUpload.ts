'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ChangeEvent, RefObject } from 'react';
import type { Editor } from '@tiptap/core';
import { Selection } from '@tiptap/pm/state';
import { ALLOWED_IMAGE_MIME_TYPES } from '@/lib/uploads';
import { uploadImageFile } from '@/lib/upload-client';
import { selectionTouches, type BlockAtom } from './selection-scan';

const ALLOWED_IMAGE_TYPE_SET = new Set(ALLOWED_IMAGE_MIME_TYPES);

// The image files in a paste/drop payload, everything else filtered out.
export function imageFilesFromList(list: FileList | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter((file) => ALLOWED_IMAGE_TYPE_SET.has(file.type));
}

// The refusal names the host(s) the selection touches, because the confusing case is a range that
// merely reaches into a table without the author noticing. No 「中」: the caret need not be inside.
// Built from the hosts touched rather than one constant per combination; the names match the other
// guards' (docs/accordion-requirements.md §7.3).
//
// A Record over BLOCK_ATOMS (selection-scan.ts), so an atom added there cannot be missed here.
// 「画像ブロック」 so the joined sentence reads (「画像には画像を挿入できません」 does not).
const BLOCK_ATOM_NAMES: Record<BlockAtom, string> = {
  linkCard: 'リンクカード',
  embed: '埋め込み',
  image: '画像ブロック',
};

export const IMAGE_BLOCKED_HOSTS: Record<string, string> = {
  table: '表のセル',
  codeBlock: 'コードブロック',
  detailsSummary: 'アコーディオンのタイトル',
  ...BLOCK_ATOM_NAMES,
};

function imageBlockedMessage(hosts: string[]): string {
  return `${hosts.map((name) => IMAGE_BLOCKED_HOSTS[name]).join('と')}には画像を挿入できません`;
}

// Uploads images and inserts them at the cursor from the file picker, paste, and window-wide drop.
// The editor arrives through a ref so the returned callbacks keep stable identities.
export function useImageUpload(
  editorRef: RefObject<Editor | null>,
  showBlocked: (message: string) => void,
) {
  const [uploading, setUploading] = useState(false);
  // True while a file is being dragged over the window, so a drop overlay
  // appears on the editor container as a target.
  const [dragging, setDragging] = useState(false);

  // The insertion is a transaction, so onUpdate handles serialization and the edited mark.
  const uploadImages = useCallback(
    async (files: File[]): Promise<void> => {
      const editor = editorRef.current;
      if (!editor) return;
      // A cell, code block or accordion title cannot hold a block, so ProseMirror splits the host
      // around the image and corrupts it; `editor.can().setImage()` still reports true, so this
      // is explicit, and it runs before anything is uploaded. Callouts and quotes are `block+` and
      // fine. selectionTouches, not isActive, which misses a range reaching into a host. Order
      // follows IMAGE_BLOCKED_HOSTS so the message is stable.
      const blockedHosts = Object.keys(IMAGE_BLOCKED_HOSTS).filter((name) =>
        selectionTouches(editor.state, name),
      );
      if (blockedHosts.length > 0) {
        showBlocked(imageBlockedMessage(blockedHosts));
        return;
      }
      setUploading(true);
      try {
        for (const file of files) {
          const url = await uploadImageFile(file);
          if (url === null) continue;
          // **No alt** (docs/project-status.md): nothing edits an alt, and one made from the file
          // name was a hash read aloud.
          editor.chain().focus().setImage({ src: url }).run();
        }
      } finally {
        setUploading(false);
      }
    },
    [editorRef, showBlocked],
  );

  // While a file is dragged over the window, show the drop overlay; a drop inserts the image there.
  // Intercepting also stops the browser from navigating to the image and losing the draft. A depth
  // counter handles dragenter/dragleave firing for descendants.
  useEffect(() => {
    let depth = 0;
    // 'Files' means "from outside the page" only because `pressedNativeDragSource`
    // (block-drag-handle.ts, docs/link-card-requirements.md §7.7) refuses in-editor native drags;
    // Chrome would otherwise attach the picture as a File and it would be re-uploaded.
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
      // Move the selection to the drop point first, so the guard, its message and the insert all
      // speak about where the file was let go. Selection.near, since posAtCoords can land where no
      // caret can sit; a selection-only transaction does not mark the post edited. A drop outside
      // the editor inserts at the caret, since the overlay invites a drop anywhere.
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

  return { uploading, dragging, uploadImages, handleImageChange };
}
