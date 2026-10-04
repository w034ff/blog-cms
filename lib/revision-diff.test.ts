import { describe, expect, it } from 'vitest';
import {
  DIFF_CONTEXT_LINES,
  DIFF_INLINE_LIMIT,
  diffBody,
  diffFields,
  diffRevision,
} from '@/lib/revision-diff';
import type { DraftContent } from '@/lib/types';

// docs/revision-requirements.md §9: the diff's shape, which the preview only draws.

const lines = (count: number, prefix = 'line') =>
  Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`);

describe('diffBody', () => {
  it('is empty for the same text, line endings aside', () => {
    expect(diffBody('a\nb\n', 'a\r\nb\r\n')).toEqual([]);
  });

  it('pairs a rewritten line with the one it replaced and marks the characters', () => {
    expect(diffBody('今日は晴れ\n', '今日は雨\n')).toEqual([
      {
        kind: 'change',
        before: [
          { kind: 'same', text: '今日は' },
          { kind: 'removed', text: '晴れ' },
        ],
        after: [
          { kind: 'same', text: '今日は' },
          { kind: 'added', text: '雨' },
        ],
      },
    ]);
  });

  it('compares a run of ASCII letters and digits whole, not by character', () => {
    expect(diffBody('```diff_python\n', '```ts\n')).toEqual([
      {
        kind: 'change',
        before: [
          { kind: 'same', text: '```' },
          { kind: 'removed', text: 'diff_python' },
        ],
        after: [
          { kind: 'same', text: '```' },
          { kind: 'added', text: 'ts' },
        ],
      },
    ]);
  });

  it('still compares Japanese by character beside a changed word', () => {
    expect(diffBody('React の設定\n', 'Vue の設定を\n')).toEqual([
      {
        kind: 'change',
        before: [
          { kind: 'removed', text: 'React' },
          { kind: 'same', text: ' の設定' },
        ],
        after: [
          { kind: 'added', text: 'Vue' },
          { kind: 'same', text: ' の設定' },
          { kind: 'added', text: 'を' },
        ],
      },
    ]);
  });

  it('shows a pure insertion with nothing on the before side', () => {
    expect(diffBody('a\n', 'a\nb\n')).toEqual([
      { kind: 'context', lines: ['a'] },
      { kind: 'change', before: [], after: [{ kind: 'added', text: 'b' }] },
    ]);
  });

  it('treats a last line without a newline as the same line', () => {
    expect(diffBody('x', 'x\n\ny')).toEqual([
      { kind: 'context', lines: ['x'] },
      { kind: 'change', before: [], after: [{ kind: 'added', text: '\ny' }] },
    ]);
  });

  it('folds unchanged lines beyond the context around a change', () => {
    const before = [...lines(10), 'old', ...lines(10, 'tail')].join('\n');
    const after = [...lines(10), 'new', ...lines(10, 'tail')].join('\n');
    const blocks = diffBody(before, after);
    expect(blocks[0]).toEqual({
      kind: 'collapsed',
      lines: lines(10).slice(0, -DIFF_CONTEXT_LINES),
    });
    expect(blocks[1]).toEqual({ kind: 'context', lines: lines(10).slice(-DIFF_CONTEXT_LINES) });
    expect(blocks[2]?.kind).toBe('change');
    expect(blocks[3]).toEqual({
      kind: 'context',
      lines: lines(10, 'tail').slice(0, DIFF_CONTEXT_LINES),
    });
    expect(blocks[4]).toEqual({
      kind: 'collapsed',
      lines: lines(10, 'tail').slice(DIFF_CONTEXT_LINES),
    });
  });

  it('keeps a short unchanged run between two changes whole', () => {
    const before = ['a', 'x', 'y', 'b'].join('\n');
    const after = ['A', 'x', 'y', 'B'].join('\n');
    expect(diffBody(before, after).map((block) => block.kind)).toEqual([
      'change',
      'context',
      'change',
    ]);
  });

  it('compares a change too long for a character diff as whole lines', () => {
    const removed = 'あ'.repeat(DIFF_INLINE_LIMIT);
    const added = 'い'.repeat(10);
    expect(diffBody(`${removed}\n`, `${added}\n`)).toEqual([
      {
        kind: 'change',
        before: [{ kind: 'removed', text: removed }],
        after: [{ kind: 'added', text: added }],
      },
    ]);
  });
});

const content = (overrides: Partial<DraftContent> = {}): DraftContent => ({
  title: 'T',
  category: 'blog',
  tags: ['a'],
  thumbnail: '',
  body: 'body',
  ...overrides,
});

describe('diffFields / diffRevision', () => {
  it('lists only the fields that differ', () => {
    expect(diffFields(content(), content({ title: 'U', tags: ['a', 'b'] }))).toEqual([
      { label: 'タイトル', before: 'T', after: 'U' },
      { label: 'タグ', before: 'a', after: 'a, b' },
    ]);
  });

  // The ids are storage; the page shows what the editor's choices say.
  it('shows a category change by its labels', () => {
    expect(diffFields(content(), content({ category: 'tech' }))).toEqual([
      { label: 'カテゴリ', before: 'ブログ', after: '技術記事' },
    ]);
  });

  it('reports identical content as such', () => {
    expect(diffRevision(content(), content()).identical).toBe(true);
    expect(diffRevision(content(), content({ body: 'other' })).identical).toBe(false);
  });
});
