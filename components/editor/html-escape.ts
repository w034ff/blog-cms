// HTML attribute escaping for the raw-HTML lines the editor writes into markdown (the link card's
// and embed's `data-href`, a footnote's `data-label`). `&` first, so the entities added after it
// are not escaped again.
export function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}
