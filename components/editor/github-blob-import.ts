import type { Editor } from '@tiptap/core';
import type { NodeType } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import {
  blobSourceFromFilename,
  parseGithubBlob,
  sliceBlobLines,
  type GithubBlobTarget,
} from '@/lib/github-blob';

// Turning a `github.com/…/blob/…` link into a code block: the one fetch, and the one insertion
// (docs/embed-requirements.md §19).
//
// **The fetch runs in the author's own browser:** `raw.githubusercontent.com` answers
// `access-control-allow-origin: *` on a hit and on a 404, so this server never requests a URL the
// author chose (unlike the link card and `lib/guarded-fetch.ts`). **Once, at insert time:** the
// code is stored in an ordinary fence, so the published page fetches nothing (§18.9).

// The node this builds. Named rather than taken from the extension so this module has no import
// cycle with code-block-extension.ts, which is where the type is defined.
const CODE_BLOCK = 'codeBlock';

// A bound checked against `content-length` (which raw hits carry) before the body is read.
// Generous, because a line range needs the whole file: raw has no line addressing.
const MAX_FETCH_BYTES = 2 * 1024 * 1024;
// What may be written into the document, after the range is taken. **The number the author feels:**
// past a few hundred lines the honest answer is a link, and the refusal suggests a range.
const MAX_INSERT_CHARS = 64 * 1024;

// One import per reference at a time. The button stays live during the fetch (hiding it would
// shift the controls), so a second press is answered rather than queued.
const inFlight = new Set<string>();

export const BLOB_NOTICES = {
  busy: '取り込み中です',
  fetch: 'GitHub からファイルを取得できませんでした',
  binary: 'テキストファイルではないため取り込めません',
  tooLarge: 'ファイルが大きすぎます（URL に行指定を付けると取り込めます）',
  outOfRange: '指定された行がファイルの末尾を超えています',
  moved: 'リンクが動いたため取り込みを中止しました',
} as const;

// Whether this link can become a code block *here*. The placement question is the one `linkToCard`
// asks and not `canPlaceAfterCaret`: what happens is that the link's own textblock is replaced, so
// that is what has to be legal (a table cell and an accordion title refuse; a list item's first
// paragraph must not be taken).
export function canImportGithubBlob(
  state: EditorState,
  range: { from: number; to: number },
): boolean {
  const type = state.schema.nodes[CODE_BLOCK] as NodeType | undefined;
  if (!type) return false;
  const $from = state.doc.resolve(range.from);
  if (!$from.parent.isTextblock || $from.depth < 1) return false;
  // The link has to be the whole line, for the reason a card does: a block cannot replace a phrase
  // without taking the sentence apart.
  if (range.from !== $from.start() || range.to !== $from.end()) return false;
  return $from
    .node($from.depth - 1)
    .canReplaceWith($from.index($from.depth - 1), $from.index($from.depth - 1) + 1, type);
}

// The range still holds the same link, and the block may still be placed there. Asked again after
// the fetch, against positions mapped through everything that landed while it was out.
function stillTheLink(
  state: EditorState,
  range: { from: number; to: number },
  href: string,
): boolean {
  if (range.from >= range.to || range.to > state.doc.content.size) return false;
  if (!canImportGithubBlob(state, range)) return false;
  let found = false;
  let foreign = false;
  state.doc.nodesBetween(range.from, range.to, (node) => {
    if (!node.isText) return;
    const mark = node.marks.find((m) => m.type.name === 'link');
    if (mark?.attrs.href === href) found = true;
    else foreign = true;
  });
  return found && !foreign;
}

// Read the file, or say why not. Split out so the network half can be read on its own: everything
// it can return is one of `BLOB_NOTICES`, and none of it touches the document.
async function readBlob(target: GithubBlobTarget): Promise<{ text: string } | { notice: string }> {
  let response: Response;
  try {
    response = await fetch(target.rawUrl, {
      // No credentials, and none would help: a private repository answers 404 to this host whatever
      // the browser sends, since GitHub's cookies are not scoped to it.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return { notice: BLOB_NOTICES.fetch };
  }
  // A private repo, a deleted file, a missing ref and a directory all answer 404, so one wording.
  if (!response.ok) return { notice: BLOB_NOTICES.fetch };
  // Raw serves source as `text/plain` and binaries as their own type; this keeps binaries out.
  const type = response.headers.get('content-type') ?? '';
  if (!type.startsWith('text/')) return { notice: BLOB_NOTICES.binary };
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_FETCH_BYTES)
    return { notice: BLOB_NOTICES.tooLarge };

  let text: string;
  try {
    text = await response.text();
  } catch {
    return { notice: BLOB_NOTICES.fetch };
  }
  // The declared length is a claim; this is the measurement. A server that lies, or omits the
  // header, does not get to hand the editor a document-sized string.
  if (text.length > MAX_FETCH_BYTES) return { notice: BLOB_NOTICES.tooLarge };
  return { text };
}

// The whole gesture. Returns a notice to show, or null when the block was made.
//
// **The document may change while the fetch is out**, unlike every other insertion here. So the
// range is mapped through each transaction and re-checked at the end; if it no longer holds this
// link, nothing is inserted and the author is told.
export async function importGithubBlob(
  editor: Editor,
  initial: { from: number; to: number },
  href: string,
): Promise<string | null> {
  const target = parseGithubBlob(href);
  if (!target) return BLOB_NOTICES.fetch;
  if (inFlight.has(target.rawUrl)) return BLOB_NOTICES.busy;
  inFlight.add(target.rawUrl);

  let range = initial;
  // `assoc` is chosen so the range grows with text typed at either edge rather than being left
  // pointing inside it: -1 keeps the start before an insertion there, 1 keeps the end after one.
  const track = ({ transaction }: { transaction: Transaction }) => {
    range = {
      from: transaction.mapping.map(range.from, -1),
      to: transaction.mapping.map(range.to, 1),
    };
  };
  editor.on('transaction', track);

  let result: { text: string } | { notice: string };
  try {
    result = await readBlob(target);
  } finally {
    editor.off('transaction', track);
    inFlight.delete(target.rawUrl);
  }
  // The editor can be gone by now: the author may have navigated away, and this call site is a
  // fire-and-forget `void … .then(…)`. Touching a destroyed editor's state throws into nothing.
  if (editor.isDestroyed) return null;
  if ('notice' in result) return result.notice;

  const code = sliceBlobLines(result.text, target.lines);
  if (code === null) return BLOB_NOTICES.outOfRange;
  if (code.length > MAX_INSERT_CHARS) return BLOB_NOTICES.tooLarge;
  if (!stillTheLink(editor.state, range, href)) return BLOB_NOTICES.moved;

  const $from = editor.state.doc.resolve(range.from);
  return (
    editor
      .chain()
      .focus()
      // Its own undo event: prosemirror-history closes the current event on this meta. Without it,
      // one Ctrl-Z took the block and the preceding typing (or the whole loaded document).
      .setMeta('uiEvent', 'paste')
      .insertContentAt(
        { from: $from.before($from.depth), to: $from.after($from.depth) },
        {
          type: CODE_BLOCK,
          // **The filename slot holds the blob URL, not the path** (§19.4). Both surfaces read it
          // back with `blobSourceFromFilename` and draw the header as a link to GitHub, so the
          // reference survives with no node of its own, no new spelling in the stored markdown, and
          // nothing left sitting under the block.
          attrs: { language: target.language, filename: target.href, diff: false },
          // An empty file has no text node to hold: `{ type: 'text', text: '' }` is not a node the
          // schema can build, and an empty code block is what an empty file should look like anyway.
          ...(code === '' ? {} : { content: [{ type: 'text', text: code }] }),
        },
      )
      .run()
      ? null
      : BLOB_NOTICES.moved
  );
}

// The way back (§19.4). The block came from a link, so it can become one again — the same door the
// embed and the link card each carry, and the same wording on it.
//
// **Offered only for a block whose filename is a blob URL**, read back from the stored filename, so
// it works for a block imported in any session. The code, edits included, is discarded, as the
// embed's 「リンクに戻す」 does; one Ctrl-Z brings it back.
export function unsetGithubBlob(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (node?.type.name !== CODE_BLOCK) return false;
  const source = blobSourceFromFilename(
    typeof node.attrs.filename === 'string' ? node.attrs.filename : '',
  );
  if (!source) return false;
  return editor
    .chain()
    .focus()
    .insertContentAt(
      { from: pos, to: pos + node.nodeSize },
      {
        type: 'paragraph',
        // The URL as the link's text, for `unsetEmbed`'s reason: the reference is what the author
        // pasted in the first place, and there is no title here to put in its place.
        content: [
          {
            type: 'text',
            marks: [{ type: 'link', attrs: { href: source.href } }],
            text: source.href,
          },
        ],
      },
    )
    .run();
}
