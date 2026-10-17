import { describe, expect, it } from 'vitest';
import type { DraftContent } from '@/lib/types';
import {
  clearExpiredDraftBuffers,
  decideDraftBufferBanner,
  DRAFT_BUFFER_MAX_AGE_DAYS,
  DRAFT_BUFFER_PREFIX,
  DRAFT_BUFFER_VERSION,
  draftBufferKey,
  formatDraftBufferTime,
  parseDraftBuffer,
  readDraftBuffer,
  removeDraftBuffer,
  shouldClearDraftBuffer,
  type DraftBuffer,
  type StorageLike,
  writeDraftBuffer,
} from './draft-buffer';

function sampleContent(overrides: Partial<DraftContent> = {}): DraftContent {
  return {
    title: '下書きタイトル',
    category: 'tech',
    tags: ['react', 'nextjs'],
    body: 'これはテスト本文です。',
    thumbnail: '/uploads/sample.png',
    ...overrides,
  };
}

function sampleBuffer(overrides: Partial<DraftBuffer> = {}): DraftBuffer {
  return {
    version: DRAFT_BUFFER_VERSION,
    content: sampleContent(),
    baseEditedAt: '2026-10-17T10:00:00.000Z',
    writtenAt: Date.now(),
    ...overrides,
  };
}

class MemoryStorage implements StorageLike {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] ?? null;
  }

  get length(): number {
    return this.store.size;
  }
}

describe('draftBufferKey (docs/draft-buffer-requirements.md §3.1)', () => {
  it('builds keys with draftBuffer: prefix for existing post and new post', () => {
    expect(draftBufferKey(1, { type: 'post', id: 42 })).toBe(`${DRAFT_BUFFER_PREFIX}1:post:42`);
    expect(draftBufferKey(1, { type: 'new', kind: 'post' })).toBe(`${DRAFT_BUFFER_PREFIX}1:new:post`);
    expect(draftBufferKey(2, { type: 'new', kind: 'scribble' })).toBe(
      `${DRAFT_BUFFER_PREFIX}2:new:scribble`,
    );
  });
});

describe('shouldClearDraftBuffer (§7 基準 3)', () => {
  it('clears buffer when sent content matches buffer content, but preserves buffer if content changed', () => {
    const sent = sampleContent({ body: '保存された本文' });
    const bufferSame = sampleBuffer({ content: sampleContent({ body: '保存された本文' }) });
    expect(shouldClearDraftBuffer(sent, bufferSame)).toBe(true);

    const bufferEdited = sampleBuffer({ content: sampleContent({ body: '保存された本文＋1文字' }) });
    expect(shouldClearDraftBuffer(sent, bufferEdited)).toBe(false);

    expect(shouldClearDraftBuffer(sent, null)).toBe(false);
  });
});

describe('decideDraftBufferBanner CRLF and LF (§7 基準 4)', () => {
  it('discards buffer without showing banner if differences are only CRLF vs LF', () => {
    const buffer = sampleBuffer({
      content: sampleContent({ body: '1行目\n2行目\n3行目' }),
    });
    const server = sampleContent({ body: '1行目\r\n2行目\r\n3行目' });

    const decision = decideDraftBufferBanner(
      buffer,
      server,
      '2026-10-17T10:00:00.000Z',
      false,
    );
    expect(decision).toBe('discard');
  });

  it('shows banner when content has real differences', () => {
    const buffer = sampleBuffer({
      content: sampleContent({ body: '編集後の本文' }),
    });
    const server = sampleContent({ body: 'サーバーの本文' });

    const decision = decideDraftBufferBanner(
      buffer,
      server,
      '2026-10-17T10:00:00.000Z',
      false,
    );
    expect(decision).toBe('show');
  });

  it('discards new post buffer when title and body are empty, but shows when either has content', () => {
    const emptyBuffer = sampleBuffer({
      content: sampleContent({ title: '', body: '', category: '', tags: [], thumbnail: '' }),
    });
    const server = sampleContent({ title: '', body: '', category: '', tags: [], thumbnail: '' });

    expect(decideDraftBufferBanner(emptyBuffer, server, '', true)).toBe('discard');

    const titledBuffer = sampleBuffer({
      content: sampleContent({ title: 'タイトルあり', body: '' }),
    });
    expect(decideDraftBufferBanner(titledBuffer, server, '', true)).toBe('show');

    const bodyBuffer = sampleBuffer({
      content: sampleContent({ title: '', body: '本文あり' }),
    });
    expect(decideDraftBufferBanner(bodyBuffer, server, '', true)).toBe('show');
  });
});

describe('decideDraftBufferBanner overwrite warning (§7 基準 5)', () => {
  it('adds overwrite warning when server edited_at is newer than baseEditedAt, and no warning when same or older', () => {
    const buffer = sampleBuffer({
      content: sampleContent({ body: '手元の変更' }),
      baseEditedAt: '2026-10-17T10:00:00.000Z',
    });
    const server = sampleContent({ body: 'サーバーの変更' });

    // Server is newer -> warning
    const newerDecision = decideDraftBufferBanner(
      buffer,
      server,
      '2026-10-17T10:05:00.000Z',
      false,
    );
    expect(newerDecision).toBe('show-warning');

    // Server is same time -> no warning
    const sameDecision = decideDraftBufferBanner(
      buffer,
      server,
      '2026-10-17T10:00:00.000Z',
      false,
    );
    expect(sameDecision).toBe('show');

    // Server is older -> no warning
    const olderDecision = decideDraftBufferBanner(
      buffer,
      server,
      '2026-10-17T09:55:00.000Z',
      false,
    );
    expect(olderDecision).toBe('show');
  });
});

describe('parseDraftBuffer and expiration validation (§7 基準 6)', () => {
  const now = 1760695200000; // 2025-10-17T10:00:00.000Z approx

  it('rejects malformed JSON', () => {
    expect(parseDraftBuffer('{ invalid json')).toBeNull();
  });

  it('rejects version mismatch', () => {
    const raw = JSON.stringify({
      version: 999,
      content: sampleContent(),
      baseEditedAt: '2026-10-17T10:00:00.000Z',
      writtenAt: now,
    });
    expect(parseDraftBuffer(raw)).toBeNull();
  });

  it('rejects missing or wrongly typed fields in content', () => {
    // Missing title
    expect(
      parseDraftBuffer(
        JSON.stringify({
          version: DRAFT_BUFFER_VERSION,
          content: { category: 'tech', tags: [], body: 'text', thumbnail: '' },
          baseEditedAt: '',
          writtenAt: now,
        }),
      ),
    ).toBeNull();

    // Missing thumbnail (docs/editor-pitfalls.md §16.2 hazard)
    expect(
      parseDraftBuffer(
        JSON.stringify({
          version: DRAFT_BUFFER_VERSION,
          content: { title: 'T', category: 'tech', tags: [], body: 'text' },
          baseEditedAt: '',
          writtenAt: now,
        }),
      ),
    ).toBeNull();

    // Invalid category
    expect(
      parseDraftBuffer(
        JSON.stringify({
          version: DRAFT_BUFFER_VERSION,
          content: { title: 'T', category: 'invalid-cat', tags: [], body: 'text', thumbnail: '' },
          baseEditedAt: '',
          writtenAt: now,
        }),
      ),
    ).toBeNull();
  });

  it('discards buffers older than 30 days via readDraftBuffer', () => {
    const storage = new MemoryStorage();
    const key = draftBufferKey(1, { type: 'post', id: 10 });
    const thirtyOneDaysAgo = now - (DRAFT_BUFFER_MAX_AGE_DAYS + 1) * 24 * 60 * 60 * 1000;
    const oldBuffer = sampleBuffer({ writtenAt: thirtyOneDaysAgo });
    writeDraftBuffer(key, oldBuffer, storage);

    expect(readDraftBuffer(key, storage, now)).toBeNull();

    const recentBuffer = sampleBuffer({ writtenAt: now - 1000 });
    writeDraftBuffer(key, recentBuffer, storage);
    expect(readDraftBuffer(key, storage, now)).not.toBeNull();
  });
});

describe('storage exception resilience (§7 基準 8)', () => {
  const throwingStorage: StorageLike = {
    getItem: () => {
      throw new Error('QuotaExceeded or disabled');
    },
    setItem: () => {
      throw new Error('QuotaExceeded or disabled');
    },
    removeItem: () => {
      throw new Error('QuotaExceeded or disabled');
    },
    key: () => {
      throw new Error('QuotaExceeded or disabled');
    },
    length: 1,
  };

  it('read, write, remove, and clearExpired never throw on broken storage', () => {
    const key = draftBufferKey(1, { type: 'post', id: 5 });
    const buffer = sampleBuffer();

    expect(() => readDraftBuffer(key, throwingStorage)).not.toThrow();
    expect(readDraftBuffer(key, throwingStorage)).toBeNull();

    expect(() => writeDraftBuffer(key, buffer, throwingStorage)).not.toThrow();
    expect(() => removeDraftBuffer(key, throwingStorage)).not.toThrow();
    expect(() => clearExpiredDraftBuffers(1, throwingStorage)).not.toThrow();
  });
});

describe('user isolation and expiration sweep (§7 基準 9)', () => {
  it('does not read other user buffers and does not sweep other user buffers', () => {
    const storage = new MemoryStorage();
    const now = 1760695200000;
    const oldTime = now - (DRAFT_BUFFER_MAX_AGE_DAYS + 2) * 24 * 60 * 60 * 1000;

    const user1Key = draftBufferKey(1, { type: 'post', id: 10 });
    const user2Key = draftBufferKey(2, { type: 'post', id: 10 });

    const user1OldBuffer = sampleBuffer({ writtenAt: oldTime });
    const user2OldBuffer = sampleBuffer({ writtenAt: oldTime });

    writeDraftBuffer(user1Key, user1OldBuffer, storage);
    writeDraftBuffer(user2Key, user2OldBuffer, storage);

    // Reading with user 1's key gives user 1's data (or null if expired)
    expect(storage.getItem(user1Key)).not.toBeNull();
    expect(storage.getItem(user2Key)).not.toBeNull();

    // User 1 sweeps expired buffers
    clearExpiredDraftBuffers(1, storage, now);

    // User 1's expired buffer is removed
    expect(storage.getItem(user1Key)).toBeNull();
    // User 2's buffer remains untouched!
    expect(storage.getItem(user2Key)).not.toBeNull();
  });
});

describe('formatDraftBufferTime', () => {
  it('formats epoch timestamp as M/D HH:mm in JST', () => {
    // 2026-10-17 05:32:00 UTC -> 2026-10-17 14:32:00 JST
    const d = new Date('2026-10-17T05:32:00.000Z').getTime();
    expect(formatDraftBufferTime(d)).toBe('10/17 14:32');
  });
});
