// What a `github.com/<owner>/<repo>/blob/…` URL becomes, and which such URLs may become it
// (docs/embed-requirements.md §19).
//
// **This is not a provider, and nothing here is an embed.** §18.9 measured GitHub as publishing no
// frameable form of a blob page, so §3.2's「埋め込みは取得を要求しない」leaves only two honest
// answers: a card that shows none of the code, or a copy made once. This file is the second — the
// editor reads the file at insert time and writes an ordinary ```lang:filename code block, so the
// published page fetches nothing and the block rides Shiki, the filename header, the copy button
// and the diff toggle that already exist.
//
// Pure: no DOM, no fetch, no editor. The fetch that uses `rawUrl` lives in
// components/editor/github-blob-import.ts, which is the only caller — this half is here so it can
// be tested as a string function, the way lib/speakerdeck-snippet.ts is.

// A GitHub login: the class §18.2 already measured for a gist's owner, and the ceiling GitHub
// itself enforces. Case is not normalised — GitHub resolves either, and the author's spelling is
// what their attribution line should show.
const OWNER = /^[A-Za-z0-9-]{1,39}$/;
// A repository name. GitHub accepts letters, digits, dot, hyphen and underscore, and 100 is its own
// limit. `.` and `..` are excluded below rather than here: they are path traversal wearing a legal
// name, not an illegal name.
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
// One segment of `<ref>/<path>`, which this file never splits (see `refLength`). Percent-escapes
// are what `URL.pathname` hands over for a name with a space or a multibyte character, so they are
// admitted; everything outside RFC 3986's `pchar` set is not, because these segments are joined
// back into a URL that is fetched.
const SEGMENT = /^[A-Za-z0-9._~!$&'()*+,;=:@%-]+$/;

// `#L12`, `#L12-L20`, and the column forms GitHub writes when a selection starts mid-line
// (`#L12C4-L20C9`). The columns are read and discarded: a code block holds whole lines, and half a
// first line is not something a fence can express.
const LINE_HASH = /^#L(\d+)(?:C\d+)?(?:-L(\d+)(?:C\d+)?)?$/;

// Extension → the language id the code block stores. **The range is the editor's own menu**
// (`CODE_LANGUAGES` in components/editor/code-block-extension.ts), not the whole of Shiki: an id
// outside that list is one the author cannot re-pick from the block's own <select> afterwards, and
// one this pipeline has never asked rehype-pretty-code to resolve. Anything unmapped becomes
// `null`, which is the plain ``` fence — the same state picking「Plain Text」leaves.
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

// Extensions this refuses outright, so a URL naming one is never offered the import (§19.2).
//
// **A deny list, not an allow list**, and the asymmetry is the whole argument: a text file often
// has no extension at all (`LICENSE`, `Dockerfile`, `Makefile`, `.gitignore`), so an allow list
// would refuse real files and stop the author's work. What this list misses instead is a binary
// with an unusual extension, and that costs one press and the「テキストファイルではない」toast —
// `readBlob`'s content-type check is the second net, and it is the one that cannot be fooled
// (components/editor/github-blob-import.ts).
//
// Without this the button was still offered for a `.png`, where **it could only ever fail**
// (2026-08-29). Qiita and Zenn both fall back to a link for a non-text file; they can decide it
// after fetching server-side, and this is the same decision made from the URL alone.
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  // images — `svg` included: raw serves it as `image/svg+xml`, so the import would refuse it anyway
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
  // What the editor fetches, built here from validated segments and nowhere else. The author's
  // string never becomes a fetched URL — §6.1's lesson applied to the one place in this feature
  // that holds a network address.
  rawUrl: string;
  // The canonical blob URL, rebuilt the same way, for the attribution line the import leaves under
  // the block (§19.4). It keeps the line fragment: that is the part of the reference a reader
  // following the link would otherwise have to find by hand.
  href: string;
  // `<owner>/<repo>`, and the repo-relative path — the two halves of the header the block wears
  // once it is imported (§19.4). **The ref is assumed to be one segment** for the path — see
  // `refLength` for what that costs and why it cannot be settled without a second request.
  repo: string;
  path: string;
  // The code block's `language` attribute, or null for a plain fence.
  language: string | null;
  // The `#L…` range, 1-based and inclusive, or null for the whole file.
  lines: { from: number; to: number } | null;
};

// A ref that names itself. GitHub writes this form when a branch is ambiguous with a tag, and it is
// the one multi-segment ref recognisable without asking GitHub anything.
const REFS_PREFIX = /^refs\/(?:heads|tags)$/;

// How many leading segments of `<ref>/<path>` belong to the ref.
//
// **A branch name may contain a slash, and nothing in the URL says where the ref ends.** GitHub's
// own blob URL is ambiguous — `/blob/feature/x/a.ts` is either branch `feature` holding `x/a.ts` or
// branch `feature/x` holding `a.ts` — and only the repository's ref list resolves it. This file
// does not ask, because the ambiguity never reaches the fetch: `raw.githubusercontent.com` takes
// the same `<ref>/<path>` string verbatim, so the content is right either way (measured 2026-08-29,
// including the `refs/heads/main` form). What it reaches is the displayed path, where a slashed
// branch leaves a leading directory that is really part of the branch name. The basename — the part
// that carries the meaning — is right regardless, and the filename field is editable.
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

// Whether the file this path names is one the import will refuse. Exported for its test; the one
// caller is `parseGithubBlob` below.
export function isBinaryPath(path: string): boolean {
  return BINARY_EXTENSIONS.has(extensionOf(path).extension);
}

// The blob URL the author is holding, or null when it is not one this can import — in which case
// the link keeps whatever it was already offered (§19.2).
export function parseGithubBlob(href: string): GithubBlobTarget | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  // One host, as §18.2's gist takes one. `www.github.com` redirects to this one, and a redirect is
  // not something to reproduce in a table of what may be fetched.
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;

  const segments = url.pathname.split('/').slice(1);
  const [owner, repo, kind, ...rest] = segments;
  // `blob` only. `/tree/` is a directory, `/blame/` and `/commits/` are pages *about* the file
  // rather than the file, and `/raw/` is a redirect into the host this builds by hand.
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
  // A file this cannot import is not this file's to claim: the URL falls through to the link card,
  // which is what §19.2's table says and what Qiita and Zenn both do for a non-text file.
  if (isBinaryPath(path)) return null;

  const hash = LINE_HASH.exec(url.hash);
  const first = hash ? Number(hash[1]) : 0;
  const last = hash?.[2] ? Number(hash[2]) : first;
  // **A fragment that names no line falls back to the whole file rather than refusing the URL.**
  // `#L0` and a backwards range are both that: the fragment is a detail of the reference, and
  // turning the button off over it would answer a smaller question than the author asked.
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

// **A dot segment cannot arrive here at all**, in any spelling: `new URL()` collapses `..`,
// `%2e%2e`, `%2E%2E` and `.%2e` alike before this file sees the path (measured 2026-08-29, all four
// leave `/o/r/blob/main/../etc/passwd` as `/o/r/blob/etc/passwd`). So traversal is not what this
// checks — it is left to that normalisation, which is a spec rule rather than a habit.
//
// What does survive the parser is an escaped *separator* and a malformed escape (`%2f`, `%zz`,
// measured unchanged). The first would be decoded into a second path segment by the server at the
// other end, so the segment count this file reasons about and the one raw sees would differ; the
// second names nothing, and gets the answer normalizeCardHref gives it (lib/link-card-href.ts).
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

// The path as a person writes it. `URL.pathname` keeps percent-escapes, so a name with a space or a
// multibyte character arrives escaped — and the fence's info string is what the decoded form has to
// survive, which admits only `[^\s`]+` (`sanitizeFilename`, code-block-extension.ts). A decoded
// name carrying whitespace or a backtick therefore keeps its escaped form: lossless and
// round-tripping, rather than silently repaired into a different filename.
function decodePath(path: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return path;
  }
  return /[\s`]/.test(decoded) ? path : decoded;
}

// The lines a `#L…` range names, or the whole text when there is none. Null when the range starts
// past the end of the file — a determinate failure the caller reports, rather than an empty code
// block that reads as an empty file.
//
// CRLF is normalised for the reason lib/posts-write.ts scans with `/\r?\n/`: what arrives over the
// network is not what this repository stores, and a code block holding `\r` serialises into a fence
// whose every line ends in an invisible character.
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

// What a code block's stored filename says about where its code came from, or null when it says
// nothing (§19.4).
//
// **The fence's `:filename` slot is what carries the reference**, and it can: markdown's info
// string admits any run without whitespace, and `lib/rehype-code-filename.ts` splits it at the
// *first* colon, so `ts:https://github.com/o/r/blob/main/a.ts` round-trips as language `ts` and
// filename `https://github.com/…`. That is the whole reason this feature needs no node of its own,
// no new spelling in the stored markdown, and nothing added to the sanitize schema.
//
// Both surfaces ask this — the editor's NodeView header and the published pipeline's — so that a
// block whose header is a source link in one is a source link in the other.
export function blobSourceFromFilename(
  filename: string,
): { href: string; repo: string; path: string } | null {
  // Cheap enough to skip the parse for every ordinary filename, which is what this is called with
  // almost every time.
  if (!filename.startsWith('https://github.com/')) return null;
  const target = parseGithubBlob(filename);
  return target ? { href: target.href, repo: target.repo, path: target.path } : null;
}
