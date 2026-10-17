import type Database from 'better-sqlite3';

// The uploads the DB still references: gc-uploads.mts's keep-list, separate so it is testable
// (importing gc-uploads.mts runs the sweep).

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

// Every column a reference can hide in: `thumbnail` (a card image the body need not mention),
// `draft_content` (a published post's unpublished edits), `post_revisions.content` (restorable
// versions, docs/revision-requirements.md §6), and `app_settings.value`. JSON is scanned as text, so a shape change cannot
// narrow it.
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
  // The site's share image (docs/site-settings-requirements.md §9). Every value is scanned, so a
  // setting added later that holds an upload is kept without a change here.
  const hasSettings = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_settings'")
    .get();
  if (hasSettings) {
    const settings = db.prepare('SELECT value FROM app_settings').all() as { value: string }[];
    for (const setting of settings) addUploadRefs(refs, setting.value);
  }
  return refs;
}
