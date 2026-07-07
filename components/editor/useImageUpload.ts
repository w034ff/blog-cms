'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ChangeEvent, RefObject } from 'react';
import type { Editor } from '@tiptap/core';
import { ALLOWED_IMAGE_MIME_TYPES } from '@/lib/uploads';

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
    [editorRef, uploadFile],
  );

  // While a file is dragged anywhere over the window, show a drop overlay and let
  // a drop add the image at the cursor. Intercepting the drag also stops the
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
  }, [uploadImages]);

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
