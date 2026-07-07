// Content normalization shared by the editor (client) and the publish/autosave
// paths (server) — keep this module importable from both sides (no 'server-only').

// Category a post falls back to when the author leaves the field blank. Also the
// DB column default, so every layer agrees on the same fallback.
export const DEFAULT_CATEGORY = 'uncategorized';

// Parse the comma-separated tags field into clean tag names: trim each entry and
// drop empties, so stray commas and spaces don't produce ghost tags.
export function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}
