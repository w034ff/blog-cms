'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { normalizeCategory, parseTags, type PostKind } from '@/lib/content';
import type { DraftContent } from '@/lib/types';

const AUTOSAVE_DELAY_MS = 800;

export type AutosaveState = 'idle' | 'saving' | 'saved' | 'failed';

// Snapshot the editable content from the live form DOM. Reading the form (rather
// than mirroring every field into React state) lets the metadata fields stay
// uncontrolled while autosave and publish both see their current values. The
// body comes from the hidden input the editor keeps in sync with its markdown.
function readDraftContent(form: HTMLFormElement): DraftContent {
  const data = new FormData(form);
  const get = (name: string): string => {
    const value = data.get(name);
    return typeof value === 'string' ? value : '';
  };
  return {
    title: get('title'),
    category: normalizeCategory(get('category')),
    tags: parseTags(get('tags')),
    body: get('body'),
    thumbnail: get('thumbnail'),
  };
}

// The editor's autosave machinery: a debounced, serialized save of the form's
// current content to /api/drafts, with Ctrl/⌘+S flushing the debounce and a
// beforeunload warning while edits are not yet persisted.
//
// Publish-flow state stays with the owner and is reached through the callbacks.
// `committedIdRef` is shared (not just read) because the first save of a new
// post must adopt the server-assigned id synchronously — an immediately queued
// retry save reads it, and waiting for React state would let that retry create
// a duplicate row.
export function useAutosave({
  formRef,
  committedIdRef,
  kind = 'post',
  onCreated,
  onDirty,
  onSessionExpired,
}: {
  // The form whose fields make up each save's payload.
  formRef: RefObject<HTMLFormElement | null>;
  // The post's row id; null for a brand-new post until its row materializes.
  committedIdRef: RefObject<number | null>;
  kind?: PostKind;
  // The first save of a new post materialized its row: adopt the new id.
  // The row the first save materialized, and the slug it was given (§18 — the editor needs its
  // own address before it can refuse to link to it).
  onCreated: (id: number, slug: string) => void;
  // An edit was recorded (called before the debounce is (re)armed).
  onDirty: () => void;
  // Autosave hit a lapsed session (true) or proved it valid again (false).
  onSessionExpired: (expired: boolean) => void;
}) {
  // Autosave feedback (whether the in-progress work is safely persisted), kept
  // separate from the owner's publish state — they are two independent axes.
  const [autosaveState, setAutosaveState] = useState<AutosaveState>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [unsaved, setUnsaved] = useState(false);

  const unsavedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const retryRef = useRef(false);
  // Holds the autosave routine (published from an effect below) so the timer,
  // Ctrl/⌘+S flush, and mid-flight retry can invoke it without a stale closure.
  const autosaveRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    unsavedRef.current = unsaved;
  }, [unsaved]);

  const runAutosave = useCallback(async () => {
    // Serialize saves; if an edit lands mid-flight, retry once we're done.
    if (savingRef.current) {
      retryRef.current = true;
      return;
    }
    const form = formRef.current;
    if (!form) return;
    savingRef.current = true;
    setAutosaveState('saving');
    let ok = false;
    try {
      const content = readDraftContent(form);
      const payload =
        committedIdRef.current === null
          ? { content, kind }
          : { id: committedIdRef.current, content };
      const res = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        onSessionExpired(true);
        setAutosaveState('failed');
        return;
      }
      if (!res.ok) {
        setAutosaveState('failed');
        return;
      }
      const data = (await res.json()) as {
        id?: number;
        slug?: string;
        savedAt?: number;
        created?: boolean;
        skipped?: boolean;
      };
      // Nothing worth saving yet (empty brand-new post): not an error.
      if (data.skipped) {
        ok = true;
        setAutosaveState('idle');
        return;
      }
      // First save of a new post: adopt the server-assigned id (synchronously
      // into the ref, see above) so the editor keeps addressing the same row.
      if (data.created && typeof data.id === 'number') {
        committedIdRef.current = data.id;
        onCreated(data.id, typeof data.slug === 'string' ? data.slug : '');
      }
      ok = true;
      setAutosaveState('saved');
      setSavedAt(typeof data.savedAt === 'number' ? data.savedAt : Date.now());
      onSessionExpired(false);
    } catch {
      setAutosaveState('failed');
    } finally {
      savingRef.current = false;
      if (retryRef.current) {
        retryRef.current = false;
        void autosaveRef.current();
      } else if (ok) {
        unsavedRef.current = false;
        setUnsaved(false);
      }
    }
  }, [formRef, committedIdRef, kind, onCreated, onSessionExpired]);

  // Publish the stable autosave routine to the ref the timer/flush/retry call,
  // so they never capture a stale closure (and we don't write the ref in render).
  useEffect(() => {
    autosaveRef.current = runAutosave;
  }, [runAutosave]);

  const scheduleAutosave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void autosaveRef.current();
    }, AUTOSAVE_DELAY_MS);
  }, []);

  // Flush a pending autosave immediately (Ctrl/⌘+S). No-op when nothing is dirty.
  const flushAutosave = useCallback(() => {
    if (!unsavedRef.current) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void autosaveRef.current();
  }, []);

  // Record an edit: mark dirty, notify the owner, and (re)arm the debounce.
  const markEdited = useCallback(() => {
    unsavedRef.current = true;
    setUnsaved(true);
    onDirty();
    scheduleAutosave();
  }, [onDirty, scheduleAutosave]);

  // Drop a queued (not yet started) autosave — e.g. when a publish submit is
  // about to carry the same content anyway.
  const cancelPendingAutosave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // The owner's publish/unpublish persisted the current content: reflect it
  // here. Called during render from the owner's "adjust state when a value
  // changes" block, so this must only set state (render-phase updates of the
  // same component are sanctioned; ref writes are not — unsavedRef syncs via
  // the effect above).
  const acceptSaved = useCallback((at: number) => {
    setUnsaved(false);
    setSavedAt(at);
    setAutosaveState('saved');
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Warn before leaving (reload / tab close / external nav) while edits are not
  // yet persisted. Autosave clears `unsaved` on success, so the warning lifts on
  // its own. In-app <Link> navigation is not covered (App Router has no stable
  // block API).
  useEffect(() => {
    if (!unsaved) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [unsaved]);

  // Ctrl/⌘+S flushes the autosave instead of opening the browser's save dialog.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      flushAutosave();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [flushAutosave]);

  return { autosaveState, savedAt, unsaved, markEdited, cancelPendingAutosave, acceptSaved };
}
