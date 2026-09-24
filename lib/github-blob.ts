// What a `github.com/<owner>/<repo>/blob/…` URL becomes, and which such URLs may become it
// (docs/embed-requirements.md §19).
//
// **Not a provider or an embed:** GitHub publishes no frameable blob page (§18.9), so the editor
// reads the file once at insert time and writes an ordinary ```lang:filename code block; the
// published page fetches nothing. Pure (no DOM, no fetch); the fetch is in
// components/editor/github-blob-import.ts.

// A GitHub login, as §18.2's gist owner. Case kept: it is the author's spelling for the attribution.
const OWNER = /^[A-Za-z0-9-]{1,39}$/;
// A repository name (GitHub's own rules). `.`/`..` are excluded below: traversal, not illegal names.
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
// One `<ref>/<path>` segment (never split; see `refLength`). Percent-escapes allowed; nothing outside
// RFC 3986 `pchar`, since the segments are joined into a fetched URL.
const SEGMENT = /^[A-Za-z0-9._~!$&'()*+,;=:@%-]+$/;

// `#L12`, `#L12-L20` and the column forms (`#L12C4-L20C9`), columns discarded: a fence holds whole
// lines.
const LINE_HASH = /^#L(\d+)(?:C\d+)?(?:-L(\d+)(?:C\d+)?)?$/;

// Extension → the stored language id. **Limited to the editor's own menu** (`CODE_LANGUAGES` in
// components/editor/code-block-extension.ts), so the block's <select> can show it; anything else is
// `null`, a plain fence.
const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  sh: 'bash',
  bash: 'bash',
  zsh: 'shell',
  fish: 'shell',
  js: 'js',
  mjs: 'js',
  cjs: 'js',
  ts: 'ts',
  mts: 'ts',
  cts: 'ts',
  jsx: 'jsx',
  tsx: 'tsx',
  json: 'json',
  jsonc: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  py: 'python',
  pyi: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  md: 'markdown',
  markdown: 'markdown',
  graphql: 'graphql',
  gql: 'graphql',
};

// Extensions refused outright, so the import isn't offered for them (§19.2). **A deny list, not an
// allow list:** many text files have no extension (`LICENSE`, `Dockerfile`). A missed binary costs
// one press and a toast, and `readBlob`'s content-type check is the net that can't be fooled.
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  // images (`svg` too: raw serves it as `image/svg+xml`)
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'bmp',
  'ico',
  'icns',
  'svg',
  'tif',
  'tiff',
  'psd',
  // video and audio
  'mp4',
  'webm',
  'mov',
  'avi',
  'mkv',
  'mp3',
  'wav',
  'ogg',
  'flac',
  'm4a',
  // archives
  'zip',
  'gz',
  'tgz',
  'bz2',
  'xz',
  '7z',
  'rar',
  'tar',
  'jar',
  'war',
  // documents
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  // fonts
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  // built artefacts and stores
  'exe',
  'dll',
  'so',
  'dylib',
  'bin',
  'wasm',
  'class',
  'o',
  'a',
  'lib',
  'pdb',
  'sqlite',
  'sqlite3',
  'db',
  'pyc',
  'pyo',
  // design
  'sketch',
  'fig',
  'xd',
  'ai',
  'eps',
]);

// Names with no extension that still say what they are, matched against the whole lowercased
// basename after the extension lookup finds nothing.
const LANGUAGE_BY_NAME: Readonly<Record<string, string>> = {
  dockerfile: 'dockerfile',
  makefile: 'bash',
  '.bashrc': 'bash',
  '.zshrc': 'shell',
};

export type GithubBlobTarget = {
  // What the editor fetches, built from validated segments only: the author's string never becomes a
  // fetched URL (§6.1).
  rawUrl: string;
  // The canonical blob URL for the attribution (§19.4), keeping the line fragment.
  href: string;
  // `<owner>/<repo>` and the path, for the header (§19.4). The ref is assumed one segment; see
  // `refLength`.
  repo: string;
  path: string;
  // The code block's `language` attribute, or null for a plain fence.
  language: string | null;
  // The `#L…` range, 1-based and inclusive, or null for the whole file.
  lines: { from: number; to: number } | null;
};

// `refs/heads/<branch>`: the one multi-segment ref recognisable without asking GitHub.
const REFS_PREFIX = /^refs\/(?:heads|tags)$/;

// How many leading segments of `<ref>/<path>` are the ref. **A branch name may contain a slash**, and
// only the repository's ref list can resolve that. Not asked: raw takes `<ref>/<path>` verbatim, so
// the content is right either way; only the displayed path may keep part of a branch name, and the
// basename and editable filename are right regardless.
function refLength(segments: readonly string[]): number {
  return segments.length >= 3 && REFS_PREFIX.test(`${segments[0]}/${segments[1]}`) ? 3 : 1;
}

// The lowercased extension of a path's last segment, or '' when it has none. A leading dot does
// not start one — `.bashrc` is a name, not an extension.
function extensionOf(path: string): { base: string; extension: string } {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const dot = base.lastIndexOf('.');
  return { base, extension: dot > 0 ? base.slice(dot + 1) : '' };
}

// The language a path's last segment names, or null.
export function blobLanguage(path: string): string | null {
  const { base, extension } = extensionOf(path);
  return LANGUAGE_BY_EXTENSION[extension] ?? LANGUAGE_BY_NAME[base] ?? null;
}

// Whether the import refuses this file. Exported for its test.
export function isBinaryPath(path: string): boolean {
  return BINARY_EXTENSIONS.has(extensionOf(path).extension);
}

// The importable blob reference, or null, leaving the link's other offers (§19.2).
export function parseGithubBlob(href: string): GithubBlobTarget | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  // One host; `www.github.com` only redirects here.
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;

  const segments = url.pathname.split('/').slice(1);
  const [owner, repo, kind, ...rest] = segments;
  // `blob` only: `/tree/` is a directory, `/blame/` and `/commits/` are about the file, `/raw/` is a
  // redirect.
  if (kind !== 'blob') return null;
  if (!OWNER.test(owner ?? '') || !REPO.test(repo ?? '')) return null;
  if (repo === '.' || repo === '..') return null;
  // A ref and at least one path segment: a ref on its own points at no file.
  if (rest.length < 2) return null;
  if (!rest.every(isSafeSegment)) return null;

  const refPath = rest.join('/');
  const path = rest.slice(refLength(rest)).join('/');
  // `refs/heads/<branch>` with nothing after it.
  if (path === '') return null;
  // Not importable: falls through to the card, as Qiita and Zenn do (§19.2).
  if (isBinaryPath(path)) return null;

  const hash = LINE_HASH.exec(url.hash);
  const first = hash ? Number(hash[1]) : 0;
  const last = hash?.[2] ? Number(hash[2]) : first;
  // **A fragment naming no line (`#L0`, a backwards range) means the whole file**, not a refusal.
  const lines = hash && first >= 1 && last >= first ? { from: first, to: last } : null;
  const fragment = lines ? `#L${lines.from}${lines.to === lines.from ? '' : `-L${lines.to}`}` : '';

  return {
    rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${refPath}`,
    href: `https://github.com/${owner}/${repo}/blob/${refPath}${fragment}`,
    repo: `${owner}/${repo}`,
    path: decodePath(path),
    language: blobLanguage(path),
    lines,
  };
}

// **Dot segments never arrive:** `new URL()` collapses `..` in every escaped spelling. What survives
// is an escaped separator (`%2f`), which the server would decode into an extra segment, and a
// malformed escape, answered as normalizeCardHref does (lib/link-card-href.ts).
function isSafeSegment(segment: string): boolean {
  if (!SEGMENT.test(segment)) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return false;
  }
  return !decoded.includes('/');
}

// The path decoded for display, unless the decoded name has whitespace or a backtick, which the
// fence's info string can't hold (`sanitizeFilename`): then it stays escaped, lossless.
function decodePath(path: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return path;
  }
  return /[\s`]/.test(decoded) ? path : decoded;
}

// The lines a `#L…` range names, or the whole text. Null when the range starts past the end, a
// failure to report rather than an empty block. CRLF is normalised, or every fence line would end in
// `\r`.
export function sliceBlobLines(
  text: string,
  lines: { from: number; to: number } | null,
): string | null {
  const normalised = text.replace(/\r\n?/g, '\n');
  if (!lines) return normalised.replace(/\n+$/, '');
  const all = normalised.split('\n');
  if (lines.from > all.length) return null;
  return all.slice(lines.from - 1, Math.min(lines.to, all.length)).join('\n');
}

// Where a code block's code came from, per its stored filename, or null (§19.4). **The `:filename`
// slot carries the reference:** lib/rehype-code-filename.ts splits at the *first* colon, so
// `ts:https://github.com/…` round-trips, needing no node, syntax or sanitize change. Both the editor
// header and the published pipeline ask this.
export function blobSourceFromFilename(
  filename: string,
): { href: string; repo: string; path: string } | null {
  // Skips the parse for ordinary filenames.
  if (!filename.startsWith('https://github.com/')) return null;
  const target = parseGithubBlob(filename);
  return target ? { href: target.href, repo: target.repo, path: target.path } : null;
}
