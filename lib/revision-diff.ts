import { diffChars, diffLines } from 'diff';
import { categoryLabel } from '@/lib/content';
import { normalizeNewlines } from '@/lib/draft-content';
import type { DraftContent } from '@/lib/types';

// What restoring a revision would change (docs/revision-requirements.md §9): the revision against
// what the editor holds now. Shaped as data rather than markup so the rules — which lines pair,
// what collapses, when a change is too big to compare by character — are testable without a page.

export type Segment = { kind: 'same' | 'removed' | 'added'; text: string };

export type DiffBlock =
  // Unchanged lines kept for context around a change.
  | { kind: 'context'; lines: string[] }
  // Unchanged lines folded away, kept so the fold can be opened.
  | { kind: 'collapsed'; lines: string[] }
  // One changed stretch: the lines as they were and as they are, each with the characters that
  // differ marked. Either side is empty for a pure insertion or deletion.
  | { kind: 'change'; before: Segment[]; after: Segment[] };

export type FieldChange = { label: string; before: string; after: string };

export type RevisionDiff = {
  fields: FieldChange[];
  body: DiffBlock[];
  identical: boolean;
};

// Unchanged lines kept on each side of a change. Two is enough to find the place in the editor;
// more is the whole article again.
export const DIFF_CONTEXT_LINES = 2;

// A changed stretch longer than this (both sides together) is shown as whole lines rather than
// compared by character: a character diff of two long, unrelated passages is slow and reads as
// confetti. Japanese has no spaces to diff by word, which is why the unit is the character.
export const DIFF_INLINE_LIMIT = 2000;

function linesOf(text: string): string[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function changeBlock(removed: string, added: string): DiffBlock {
  if (removed === '' || added === '' || removed.length + added.length > DIFF_INLINE_LIMIT) {
    return {
      kind: 'change',
      before: removed === '' ? [] : [{ kind: 'removed', text: removed }],
      after: added === '' ? [] : [{ kind: 'added', text: added }],
    };
  }
  const before: Segment[] = [];
  const after: Segment[] = [];
  for (const part of diffChars(removed, added)) {
    if (part.added) after.push({ kind: 'added', text: part.value });
    else if (part.removed) before.push({ kind: 'removed', text: part.value });
    else {
      before.push({ kind: 'same', text: part.value });
      after.push({ kind: 'same', text: part.value });
    }
  }
  return { kind: 'change', before, after };
}

// Keeps DIFF_CONTEXT_LINES of an unchanged run next to each change it borders and folds the rest.
function contextBlocks(lines: string[], first: boolean, last: boolean): DiffBlock[] {
  const head = first ? 0 : DIFF_CONTEXT_LINES;
  const tail = last ? 0 : DIFF_CONTEXT_LINES;
  if (lines.length <= head + tail + 1) return [{ kind: 'context', lines }];
  const blocks: DiffBlock[] = [];
  if (head > 0) blocks.push({ kind: 'context', lines: lines.slice(0, head) });
  blocks.push({ kind: 'collapsed', lines: lines.slice(head, lines.length - tail) });
  if (tail > 0) blocks.push({ kind: 'context', lines: lines.slice(lines.length - tail) });
  return blocks;
}

export function diffBody(beforeBody: string, afterBody: string): DiffBlock[] {
  // Every line newline-terminated: jsdiff compares a last line without its newline as a different
  // line from the same text with one, so appending a paragraph would otherwise show the old last
  // line as removed and re-added.
  const terminated = (body: string) => {
    const text = normalizeNewlines(body);
    return text === '' || text.endsWith('\n') ? text : `${text}\n`;
  };
  const before = terminated(beforeBody);
  const after = terminated(afterBody);
  if (before === after) return [];

  // Adjacent removals and additions are one change, so a rewritten line is compared with what it
  // replaced rather than listed as an unrelated deletion and insertion.
  type Run = { kind: 'same'; text: string } | { kind: 'change'; removed: string; added: string };
  const runs: Run[] = [];
  for (const part of diffLines(before, after)) {
    const previous = runs.at(-1);
    if (!part.added && !part.removed) runs.push({ kind: 'same', text: part.value });
    else if (previous?.kind === 'change') {
      if (part.added) previous.added += part.value;
      else previous.removed += part.value;
    } else {
      runs.push({
        kind: 'change',
        removed: part.removed ? part.value : '',
        added: part.added ? part.value : '',
      });
    }
  }

  return runs.flatMap((run, index) =>
    run.kind === 'same'
      ? contextBlocks(linesOf(run.text), index === 0, index === runs.length - 1)
      : [changeBlock(run.removed.replace(/\n$/, ''), run.added.replace(/\n$/, ''))],
  );
}

// The fields besides the body, listed only where they differ.
export function diffFields(before: DraftContent, after: DraftContent): FieldChange[] {
  const fields: [string, string, string][] = [
    ['タイトル', before.title, after.title],
    ['カテゴリ', categoryLabel(before.category), categoryLabel(after.category)],
    ['タグ', before.tags.join(', '), after.tags.join(', ')],
    ['サムネイル', before.thumbnail, after.thumbnail],
  ];
  return fields
    .filter(([, was, is]) => was !== is)
    .map(([label, was, is]) => ({ label, before: was, after: is }));
}

export function diffRevision(before: DraftContent, after: DraftContent): RevisionDiff {
  const fields = diffFields(before, after);
  const body = diffBody(before.body, after.body);
  return { fields, body, identical: fields.length === 0 && body.length === 0 };
}
