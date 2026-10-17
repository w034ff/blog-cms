'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { PostCategory, PostKind } from '@/lib/content';
import { sameDraftContent } from '@/lib/draft-content';
import type { DictionaryTag, DraftContent } from '@/lib/types';
import {
  clearExpiredDraftBuffers,
  decideDraftBufferBanner,
  DRAFT_BUFFER_VERSION,
  DRAFT_BUFFER_WRITE_DELAY_MS,
  draftBufferKey,
  readDraftBuffer,
  removeDraftBuffer,
  shouldClearDraftBuffer,
  writeDraftBuffer,
  type DraftBuffer,
} from './draft-buffer';

type BannerState = {
  writtenAt: number;
  hasOverwriteWarning: boolean;
  buffer: DraftBuffer;
};

export function useDraftBuffer({
  userId,
  committedId,
  kind,
  content,
  initialContent,
  serverEditedAt,
  isNew,
  editor,
  tagDictionary,
  setTitle,
  setCategory,
  setTags,
  setThumbnail,
  markEdited,
}: {
  userId: number;
  committedId: number | null;
  kind: PostKind;
  content: DraftContent;
  initialContent: DraftContent;
  serverEditedAt: string;
  isNew: boolean;
  editor: Editor | null;
  tagDictionary: DictionaryTag[];
  setTitle: (title: string) => void;
  setCategory: (category: PostCategory) => void;
  setTags: (tags: string[]) => void;
  setThumbnail: (thumbnail: string) => void;
  markEdited: () => void;
}) {
  const [banner, setBanner] = useState<BannerState | null>(null);

  const currentKeyRef = useRef(
    draftBufferKey(
      userId,
      committedId !== null ? { type: 'post', id: committedId } : { type: 'new', kind },
    ),
  );
  const currentBaseEditedAtRef = useRef(serverEditedAt);
  const isBannerActiveRef = useRef(false);
  const isInitialRef = useRef(true);
  const prevContentRef = useRef(content);
  const pendingContentRef = useRef<DraftContent | null>(null);
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    isBannerActiveRef.current = banner !== null;
  }, [banner]);

  useEffect(() => {
    if (committedId !== null) {
      currentKeyRef.current = draftBufferKey(userId, { type: 'post', id: committedId });
    }
  }, [userId, committedId]);

  // One-time check on mount: sweep expired buffers, check for existing buffer, and decide banner.
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    clearExpiredDraftBuffers(userId);

    const key = currentKeyRef.current;
    const stored = readDraftBuffer(key);
    if (!stored) return;

    const decision = decideDraftBufferBanner(stored, initialContent, serverEditedAt, isNew);
    if (decision === 'discard') {
      removeDraftBuffer(key);
    } else if (decision === 'show') {
      setBanner({ writtenAt: stored.writtenAt, hasOverwriteWarning: false, buffer: stored });
      isBannerActiveRef.current = true;
    } else if (decision === 'show-warning') {
      setBanner({ writtenAt: stored.writtenAt, hasOverwriteWarning: true, buffer: stored });
      isBannerActiveRef.current = true;
    }
  }, [userId, initialContent, serverEditedAt, isNew]);

  const flushPendingWrite = useCallback(() => {
    if (writeTimerRef.current !== null) {
      clearTimeout(writeTimerRef.current);
      writeTimerRef.current = null;
    }
    if (!isBannerActiveRef.current && pendingContentRef.current) {
      const buffer: DraftBuffer = {
        version: DRAFT_BUFFER_VERSION,
        content: pendingContentRef.current,
        baseEditedAt: currentBaseEditedAtRef.current,
        writtenAt: Date.now(),
      };
      writeDraftBuffer(currentKeyRef.current, buffer);
      pendingContentRef.current = null;
    }
  }, []);

  // Write edits to localStorage after a short delay (250ms).
  // Initial loaded state is not an edit and is skipped.
  // Edits while banner is active do not overwrite the buffer.
  useLayoutEffect(() => {
    if (isInitialRef.current) {
      isInitialRef.current = false;
      prevContentRef.current = content;
      return;
    }

    if (sameDraftContent(content, prevContentRef.current)) {
      return;
    }
    prevContentRef.current = content;

    if (isBannerActiveRef.current) {
      return;
    }

    pendingContentRef.current = content;
    if (writeTimerRef.current !== null) {
      clearTimeout(writeTimerRef.current);
    }
    writeTimerRef.current = setTimeout(() => {
      writeTimerRef.current = null;
      if (!isBannerActiveRef.current && pendingContentRef.current) {
        const buffer: DraftBuffer = {
          version: DRAFT_BUFFER_VERSION,
          content: pendingContentRef.current,
          baseEditedAt: currentBaseEditedAtRef.current,
          writtenAt: Date.now(),
        };
        writeDraftBuffer(currentKeyRef.current, buffer);
        pendingContentRef.current = null;
      }
    }, DRAFT_BUFFER_WRITE_DELAY_MS);
  }, [content]);

  // Flush pending write on unmount to avoid leaving an active timer behind.
  useLayoutEffect(() => {
    return () => {
      flushPendingWrite();
    };
  }, [flushPendingWrite]);

  // Flush pending write on pagehide (tab close or reload) so unsaved edits persist.
  useEffect(() => {
    const handlePageHide = () => {
      flushPendingWrite();
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [flushPendingWrite]);

  const handleRestore = useCallback(() => {
    if (!banner) return;
    const restored = banner.buffer.content;
    setTitle(restored.title);
    setCategory(restored.category);
    const knownTags = restored.tags.filter((slug) =>
      tagDictionary.some((tag) => tag.slug === slug),
    );
    setTags(knownTags);
    setThumbnail(restored.thumbnail);
    if (editor) {
      editor.commands.setContent(restored.body);
    }
    setBanner(null);
    isBannerActiveRef.current = false;
    markEdited();
  }, [banner, editor, markEdited, setCategory, setTags, setTitle, setThumbnail, tagDictionary]);

  const handleDiscard = useCallback(() => {
    removeDraftBuffer(currentKeyRef.current);
    setBanner(null);
    isBannerActiveRef.current = false;
  }, []);

  const notifySaveSuccess = useCallback((sentContent: DraftContent, editedAt?: string) => {
    if (editedAt) {
      currentBaseEditedAtRef.current = editedAt;
    }
    // While the banner is active, the stored buffer remains frozen so that the author can still restore
    // the original buffered content, and so that baseEditedAt does not advance and hide the overwrite warning.
    if (isBannerActiveRef.current) {
      return;
    }
    const key = currentKeyRef.current;
    const current = readDraftBuffer(key);
    if (current) {
      if (shouldClearDraftBuffer(sentContent, current)) {
        removeDraftBuffer(key);
      } else if (editedAt) {
        current.baseEditedAt = editedAt;
        writeDraftBuffer(key, current);
      }
    }
  }, []);

  const notifyCreated = useCallback(
    (newId: number) => {
      const oldKey = draftBufferKey(userId, { type: 'new', kind });
      const newKey = draftBufferKey(userId, { type: 'post', id: newId });
      const current = readDraftBuffer(oldKey);
      if (current) {
        writeDraftBuffer(newKey, current);
        removeDraftBuffer(oldKey);
      }
      currentKeyRef.current = newKey;
    },
    [userId, kind],
  );

  return {
    banner: banner
      ? {
          writtenAt: banner.writtenAt,
          hasOverwriteWarning: banner.hasOverwriteWarning,
          onRestore: handleRestore,
          onDiscard: handleDiscard,
        }
      : null,
    notifySaveSuccess,
    notifyCreated,
  };
}
