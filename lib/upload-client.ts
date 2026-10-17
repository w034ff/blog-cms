// Send one file to /api/uploads and report the path it now lives at, or null if
// the upload was refused (the alert is raised here so no caller has to).
//
// Outside the editor so every picker — the editor's, the thumbnail's, the site settings' share
// image — uploads through the same limits and error reporting without pulling in TipTap.
export async function uploadImageFile(file: File): Promise<string | null> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/uploads', { method: 'POST', body: formData });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (res.ok && typeof data.url === 'string') return data.url;
  window.alert(`アップロードに失敗しました: ${data.error ?? res.status}`);
  return null;
}
