import { describe, expect, it } from 'vitest';
import { EXCERPT_MAX_CHARS, excerptFromBody } from '@/lib/excerpt';

describe('excerptFromBody', () => {
  it('skips a leading heading, which every stored post opens with', () => {
    expect(excerptFromBody('## はじめまして\n\n本文です。')).toBe('本文です。');
  });

  it('reads a CRLF body the same as an LF one (publish stores CRLF, autosave LF)', () => {
    expect(excerptFromBody('## 見出し\r\n\r\n一行目。\r\n二行目。')).toBe('一行目。二行目。');
  });

  it('joins a soft break after Japanese without a gap, and after ASCII with a space', () => {
    expect(excerptFromBody('軽量。\n使い分け')).toBe('軽量。使い分け');
    expect(excerptFromBody('uses RSC\nfor speed')).toBe('uses RSC for speed');
  });

  it('keeps the space the house style puts around a Latin term', () => {
    expect(excerptFromBody('React は速い。')).toBe('React は速い。');
  });

  it('skips fences, lists, tables, quotes, callouts, raw HTML blocks and accordion contents', () => {
    const body = [
      '```ts:a.ts\nconst x = 1;\n```',
      '- 項目',
      '| a | b |\n| - | - |\n| 1 | 2 |',
      '> 引用',
      '> [!NOTE]\n> 注意',
      '<div class="link-card" data-href="/posts/abc"></div>',
      '<div class="embed" data-href="https://www.youtube.com/watch?v=x"></div>',
      '<details><summary>題</summary>\n\n中身\n\n</details>',
      '本文。',
    ].join('\n\n');
    expect(excerptFromBody(body)).toBe('本文。');
  });

  it('skips an image paragraph and the caption under it, but not an ordinary emphasis paragraph', () => {
    expect(excerptFromBody('![alt](/uploads/a.png)\n\n*図のキャプション*\n\n本文。')).toBe(
      '本文。',
    );
    expect(excerptFromBody('*強調だけの段落*')).toBe('強調だけの段落');
  });

  it('skips a bare URL paragraph and a lead-in that introduces the next block', () => {
    expect(excerptFromBody('https://example.com\n\nサンプル:\n\n```\nx\n```\n\n本文。')).toBe(
      '本文。',
    );
  });

  it('drops footnote references and inline HTML but keeps the text inside it', () => {
    expect(
      excerptFromBody('本文[^1]と<span class="accent-emphasis">強調</span>。\n\n[^1]: 注'),
    ).toBe('本文と強調。');
  });

  it('keeps link text and inline code', () => {
    expect(excerptFromBody('[公式](https://example.com)の `useState` を使う。')).toBe(
      '公式の useState を使う。',
    );
  });

  it('joins following paragraphs, and truncates at the limit with an ellipsis', () => {
    expect(excerptFromBody('一つ目。\n\n二つ目。')).toBe('一つ目。二つ目。');
    const long = excerptFromBody('あ'.repeat(EXCERPT_MAX_CHARS + 10));
    expect(long).toBe(`${'あ'.repeat(EXCERPT_MAX_CHARS)}…`);
  });

  it('never splits a surrogate pair at the cut', () => {
    const out = excerptFromBody('𠮷'.repeat(EXCERPT_MAX_CHARS + 1));
    expect(Array.from(out)).toHaveLength(EXCERPT_MAX_CHARS + 1);
    expect(out.endsWith('𠮷…')).toBe(true);
  });

  it('is empty for a body with no prose', () => {
    expect(excerptFromBody('## 見出しだけ\n\n```\ncode\n```')).toBe('');
  });
});

// The stored forms components/editor/summary-extension.ts writes (docs/summary-requirements.md §3.3).
const TLDR = (text: string) => `<div class="tldr">\n\n${text}\n\n</div>`;
const SUMMARY =
  '<div class="summary">\n\n総評の文。\n\n<div class="summary-good">\n\n- 良い\n\n</div>\n\n</div>';

describe('excerptFromBody — TL;DR and まとめ', () => {
  it('uses the TL;DR, wherever it is, over the opening', () => {
    const body = ['書き出しの段落。', TLDR('要点の一文目。\n\n要点の二文目。'), '本文。'].join(
      '\n\n',
    );
    expect(excerptFromBody(body)).toBe('要点の一文目。要点の二文目。');
  });

  it('falls back to the opening when the TL;DR is empty, without reading into it', () => {
    const body = [TLDR(''), '書き出しの段落。'].join('\n\n').replace('\n\n\n\n', '\n\n');
    expect(excerptFromBody(body)).toBe('書き出しの段落。');
  });

  it('leaves the まとめ out of the opening: it is written for someone who has read the post', () => {
    expect(excerptFromBody(['短い書き出し。', SUMMARY].join('\n\n'))).toBe('短い書き出し。');
  });

  it('keeps counting <div>s it does not own, so a card inside does not end the box early', () => {
    const body = [
      '<div class="tldr">',
      '要点。',
      '<div class="link-card" data-href="/posts/abc"></div>',
      '続きの要点。',
      '</div>',
      '本文。',
    ].join('\n\n');
    expect(excerptFromBody(body)).toBe('要点。続きの要点。');
  });

  it('clips a long TL;DR at the same limit as the opening', () => {
    const excerpt = excerptFromBody(TLDR('あ'.repeat(EXCERPT_MAX_CHARS + 10)));
    expect(Array.from(excerpt)).toHaveLength(EXCERPT_MAX_CHARS + 1);
    expect(excerpt.endsWith('…')).toBe(true);
  });
});
