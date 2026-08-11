// Which footnotes in a post are still unfinished (docs/footnote-requirements.md §5.2, §5.3).
//
// This runs on the server, over the stored markdown, because that is all the publish action ever
// sees: `contentSchema` hands it `body: z.string()` and there is no ProseMirror document on that
// side. So the check cannot be "is there an empty definition" the way the requirement is phrased to
// the author — an empty definition may not have survived serialization at all, in which case what
// arrives is a reference with nothing to point at. Both shapes are the same defect from the
// reader's side, and both are caught by asking about the *reference*: has it a definition, and does
// that definition say anything.
//
// Deliberately a scan rather than a parse. Pulling markdown-it in here would mean the editor's
// parser, its footnote plugin and its renderer overrides all loading in a server action to answer a
// yes/no question about two line shapes.

// ``` or ~~~, with up to three spaces of indent — a fence's contents are not prose and a `[^1]`
// inside one is a literal the author is writing *about*, not a footnote. Without this, publishing a
// post that documents footnote syntax would be refused for the example in its own code block.
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

// A definition line: `[^label]: text`, up to three spaces of indent (the same latitude markdown-it's
// own rule allows).
const DEFINITION = /^ {0,3}\[\^([^\]\s\\]+)\]:(.*)$/;

// A reference in prose. The lookbehind skips `\[^1\]`, the escaped literal form the editor used to
// save before footnotes were supported — that is text about a footnote, not one.
const REFERENCE = /(?<!\\)\[\^([^\]\s\\]+)\]/g;

// The labels whose notes are missing or blank, in the order they appear. Empty means the post's
// footnotes are all written.
export function incompleteFootnotes(body: string): string[] {
  const definitions = new Map<string, string>();
  const references: string[] = [];
  let fence: string | null = null;

  // `\r?\n`, not `\n`: publish reaches the server through a form, and form submission rewrites
  // every newline in the value to CRLF (PostEditor's hidden `body` input). Splitting on `\n` alone
  // leaves a trailing `\r` on every line but the last, which `DEFINITION` cannot match — `.` does
  // not match `\r` and `$` without `m` only matches the very end. Each such line then fell through
  // to the reference scan below, so a *written* note was counted as an empty one; with N footnotes
  // the last definition still matched and publish was refused with N-1. Storage is normalized to LF
  // now (lib/posts-write.ts), but every post saved before that still has CRLF in the database.
  for (const line of body.split(/\r?\n/)) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const definition = DEFINITION.exec(line);
    if (definition) {
      definitions.set(definition[1], definition[2].trim());
      continue;
    }
    for (const match of line.matchAll(REFERENCE)) references.push(match[1]);
  }

  const incomplete: string[] = [];
  for (const label of references) {
    if ((definitions.get(label) ?? '') !== '') continue;
    if (!incomplete.includes(label)) incomplete.push(label);
  }
  return incomplete;
}
