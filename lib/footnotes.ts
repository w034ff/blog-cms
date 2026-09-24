// Which footnotes in a post are still unfinished (docs/footnote-requirements.md §5.2, §5.3).
//
// On the server, over the stored markdown, which is all the publish action has. An empty definition
// may not survive serialization, so the question is asked of each *reference*: does it have a
// definition, and does that say anything.
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

  // `\r?\n`: form submission turns newlines into CRLF, and a trailing `\r` stopped `DEFINITION`
  // matching, so written notes counted as empty. Storage is LF now (lib/posts-write.ts), but older
  // rows still hold CRLF.
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
