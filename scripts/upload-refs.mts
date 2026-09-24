import type Database from 'better-sqlite3';

// Which uploads the database still points at — the half of scripts/gc-uploads.mts that decides
// what a sweep must keep. Its own module so it can be tested: importing gc-uploads.mts runs the
// sweep.

export const UPLOAD_REF = /\/uploads\/([A-Za-z0-9._-]+)/g;

export function addUploadRefs(refs: Set<string>, text: string | null | undefined): void {
  if (!text) return;
  for (const match of text.matchAll(UPLOAD_REF)) refs.add(match[1]);
}

type PostTextRow = {
  body: string | null;
  description: string | null;
  title: string | null;
  thumbnail: string | null;
  draft_content: string | null;
};

// Every column a reference can hide in, not just the published body.
//
// `thumbnail` holds a card image the body need not mention at all — that is the whole point of
// choosing one — so a sweep blind to it deletes exactly the image the author picked.
// `draft_content` is the private working copy of a *published* post's pending edits: an image added
// in an edit that has not been published yet is referenced nowhere else, and once the file ages
// past the grace period the sweep would take it while the author is still writing.
// `post_revisions.content` is a past version the author can restore (docs/revision-requirements.md
// §6): an image dropped from the current text but kept in a revision would come back broken. All
// three are unreferenced-looking and in use, which is the failure this function exists to prevent.
//
// JSON columns are scanned as raw text rather than parsed: every field in them is a string,
// `UPLOAD_REF` is looking for a substring, and a shape change in DraftContent must not be able to
// quietly narrow what this sees.
export function referencedInDb(db: Database.Database): Set<string> {
  const refs = new Set<string>();
  const rows = db
    .prepare('SELECT body, description, title, thumbnail, draft_content FROM posts')
    .all() as PostTextRow[];
  for (const row of rows) {
    addUploadRefs(refs, row.body);
    addUploadRefs(refs, row.description);
    addUploadRefs(refs, row.title);
    addUploadRefs(refs, row.thumbnail);
    addUploadRefs(refs, row.draft_content);
  }
  // A DB the revisions migration has not reached yet has no revisions to protect.
  const hasRevisions = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'post_revisions'")
    .get();
  if (hasRevisions) {
    const revisions = db.prepare('SELECT content FROM post_revisions').all() as {
      content: string;
    }[];
    for (const revision of revisions) addUploadRefs(refs, revision.content);
  }
  return refs;
}
