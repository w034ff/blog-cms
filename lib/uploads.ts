// Single source of truth for which image types the editor accepts and the
// upload route stores. Shared by the client editor and the server route, so
// the paste/drop filter, the <input accept>, and the server check never drift.
export const ALLOWED_IMAGE_EXTENSIONS = new Map<string, string>([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
]);

export const ALLOWED_IMAGE_MIME_TYPES = Array.from(ALLOWED_IMAGE_EXTENSIONS.keys());

export const ALLOWED_IMAGE_ACCEPT = ALLOWED_IMAGE_MIME_TYPES.join(',');

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
