import { isCategoryId, type PostKind } from '@/lib/content';
import { normalizeNewlines, sameDraftContent } from '@/lib/draft-content';
import type { DraftContent } from '@/lib/types';

export const DRAFT_BUFFER_PREFIX = 'draftBuffer:';
export const DRAFT_BUFFER_VERSION = 1;
export const DRAFT_BUFFER_MAX_AGE_DAYS = 30;
export const DRAFT_BUFFER_MAX_AGE_MS = DRAFT_BUFFER_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
export const DRAFT_BUFFER_WRITE_DELAY_MS = 250;

export const DRAFT_BUFFER_NOTICE = '保存されていない変更があります';
export const DRAFT_BUFFER_OVERWRITE_WARNING =
  'この記事は控えの後に別の場所で保存されています。復元すると、その変更を上書きします。';
export const DRAFT_BUFFER_RESTORE_LABEL = '復元';
export const DRAFT_BUFFER_DISCARD_LABEL = '破棄';

export type BufferTarget =
  | { type: 'post'; id: number }
  | { type: 'new'; kind: PostKind };

export type DraftBuffer = {
  version: number;
  content: DraftContent;
  baseEditedAt: string;
  writtenAt: number;
};

export type BannerDecision = 'discard' | 'show' | 'show-warning';

export function draftBufferKey(userId: number, target: BufferTarget): string {
  if (target.type === 'post') {
    return `${DRAFT_BUFFER_PREFIX}${userId}:post:${target.id}`;
  }
  return `${DRAFT_BUFFER_PREFIX}${userId}:new:${target.kind}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseContent(value: unknown): DraftContent | null {
  if (!isRecord(value)) return null;
  if (typeof value.title !== 'string') return null;
  if (typeof value.category !== 'string' || (value.category !== '' && !isCategoryId(value.category))) {
    return null;
  }
  if (!Array.isArray(value.tags) || !value.tags.every((tag: unknown) => typeof tag === 'string')) {
    return null;
  }
  if (typeof value.body !== 'string') return null;
  if (typeof value.thumbnail !== 'string') return null;

  return {
    title: value.title,
    category: value.category,
    tags: value.tags,
    body: value.body,
    thumbnail: value.thumbnail,
  };
}

export function parseDraftBuffer(raw: unknown): DraftBuffer | null {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(parsed)) return null;
  if (typeof parsed.version !== 'number' || parsed.version !== DRAFT_BUFFER_VERSION) {
    return null;
  }
  if (typeof parsed.baseEditedAt !== 'string') return null;
  if (typeof parsed.writtenAt !== 'number' || !Number.isFinite(parsed.writtenAt)) {
    return null;
  }
  const content = parseContent(parsed.content);
  if (!content) return null;

  return {
    version: parsed.version,
    content,
    baseEditedAt: parsed.baseEditedAt,
    writtenAt: parsed.writtenAt,
  };
}

export function isDraftBufferExpired(buffer: DraftBuffer, now: number = Date.now()): boolean {
  return now - buffer.writtenAt > DRAFT_BUFFER_MAX_AGE_MS;
}

export function shouldClearDraftBuffer(
  sentContent: DraftContent,
  currentBuffer: DraftBuffer | null,
): boolean {
  if (!currentBuffer) return false;
  return sameDraftContent(sentContent, currentBuffer.content);
}

export function decideDraftBufferBanner(
  buffer: DraftBuffer,
  serverContent: DraftContent,
  serverEditedAt: string,
  isNew: boolean,
): BannerDecision {
  if (isNew) {
    if (buffer.content.title.trim() === '' && buffer.content.body.trim() === '') {
      return 'discard';
    }
    return 'show';
  }

  const bufferBody = normalizeNewlines(buffer.content.body);
  const serverBody = normalizeNewlines(serverContent.body);
  const same =
    buffer.content.title === serverContent.title &&
    buffer.content.category === serverContent.category &&
    bufferBody === serverBody &&
    buffer.content.thumbnail === serverContent.thumbnail &&
    buffer.content.tags.length === serverContent.tags.length &&
    buffer.content.tags.every((tag, i) => tag === serverContent.tags[i]);

  if (same) {
    return 'discard';
  }

  if (serverEditedAt && buffer.baseEditedAt && serverEditedAt > buffer.baseEditedAt) {
    return 'show-warning';
  }

  return 'show';
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key?(index: number): string | null;
  readonly length?: number;
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {}
  return null;
}

export function readDraftBuffer(
  key: string,
  storage: StorageLike | null = defaultStorage(),
  now: number = Date.now(),
): DraftBuffer | null {
  try {
    if (!storage) return null;
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = parseDraftBuffer(raw);
    if (!parsed) return null;
    if (isDraftBufferExpired(parsed, now)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeDraftBuffer(
  key: string,
  buffer: DraftBuffer,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    if (!storage) return;
    storage.setItem(key, JSON.stringify(buffer));
  } catch {}
}

export function removeDraftBuffer(
  key: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    if (!storage) return;
    storage.removeItem(key);
  } catch {}
}

export function clearExpiredDraftBuffers(
  userId: number,
  storage: StorageLike | null = defaultStorage(),
  now: number = Date.now(),
): void {
  try {
    if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function') return;
    const prefix = `${DRAFT_BUFFER_PREFIX}${userId}:`;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(prefix)) {
        keys.push(k);
      }
    }
    for (const k of keys) {
      const raw = storage.getItem(k);
      if (!raw) continue;
      const parsed = parseDraftBuffer(raw);
      if (!parsed || isDraftBufferExpired(parsed, now)) {
        removeDraftBuffer(k, storage);
      }
    }
  } catch {}
}

export function formatDraftBufferTime(epochMs: number): string {
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  });
}
