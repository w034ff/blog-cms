import { describe, expect, it } from 'vitest';
import { incompleteFootnotes } from './footnotes';

describe('incompleteFootnotes', () => {
  it('passes a footnote whose note is written', () => {
    expect(incompleteFootnotes('本文[^a]\n\n[^a]: 注釈\n')).toEqual([]);
  });

  it('catches a definition with nothing after the colon', () => {
    expect(incompleteFootnotes('本文[^a]\n\n[^a]:\n')).toEqual(['a']);
    expect(incompleteFootnotes('本文[^a]\n\n[^a]:   \n')).toEqual(['a']);
  });

  it('catches a reference whose definition never made it into the file', () => {
    // docs/footnote-requirements.md §5.3: an empty definition may not survive serialization, so
    // what reaches the server can be the reference alone. Same defect, same answer.
    expect(incompleteFootnotes('本文[^a]\n')).toEqual(['a']);
  });

  it('leaves an orphan definition alone', () => {
    // No reader ever sees it, and §5.4 keeps it on purpose — the author's words are not the
    // editor's to throw away. It is not a reason to refuse a publish.
    expect(incompleteFootnotes('本文\n\n[^a]: 注釈\n')).toEqual([]);
  });

  it('reports each label once, in the order they appear', () => {
    expect(incompleteFootnotes('[^b] と [^a] と [^b]\n')).toEqual(['b', 'a']);
  });

  it('ignores footnote syntax inside a fenced code block', () => {
    // A post documenting footnote syntax must still be publishable.
    const body = '本文[^a]\n\n```md\n見本[^x]\n\n[^x]:\n```\n\n[^a]: 注釈\n';
    expect(incompleteFootnotes(body)).toEqual([]);
  });

  it('ignores the escaped literal form the editor used to save', () => {
    // `\[^1\]` is text *about* a footnote — what the literal-text guard produced before footnotes
    // were supported. It has no definition and must not block a publish.
    expect(incompleteFootnotes('本文\\[^1\\]\n')).toEqual([]);
  });

  it('accepts the indentation markdown-it allows on a definition line', () => {
    expect(incompleteFootnotes('本文[^a]\n\n   [^a]: 注釈\n')).toEqual([]);
  });
});
