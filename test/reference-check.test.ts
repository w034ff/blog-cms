import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import ts from 'typescript';

// Cross-file pointers in docs and code comments, checked against the tree. Most stale comments
// found in the 2026-09 comment trim were pointers that were right when written and left behind by
// a later move, so this is the "checks, not rewrites" of AGENTS.md applied to them.
//
// Three rules, over tracked markdown whole and over comments only in code (strings are data):
//
//   1. No line-number cite of a repo file (path, colon, digits). Cite an identifier. Cites into
//      node_modules are not checked here: AGENTS.md allows a line there when an identifier goes
//      with it, which a regex cannot tell.
//   2. A repo path named in prose exists, as a tracked file or directory. Paths that are meant to
//      be absent (planned files, deleted ones in a dated account) go in ABSENT.
//   3. A docs file plus `§N` names a heading of that file. A bare `§N` with no file (most of the
//      cites in the code) is out of scope: which document it means is not written down.
//      cms-features.md numbers § per feature, so a cite qualified with 「feature」 is looked up
//      inside that feature's `#` section.

const PATH_ROOTS = ['app', 'components', 'docs', 'e2e', 'lib', 'scripts', 'test'];
const SCANNED = /\.(?:tsx?|mts|cts|mjs|cjs|js|css|md)$/;
const CODE = /\.(?:tsx?|mts|cts|mjs|cjs|js)$/;
const SELF = 'test/reference-check.test.ts';

// Gitignored output a doc describes (.gitignore), so absent on a fresh clone by design.
const GENERATED = ['e2e/.tmp/', 'e2e/.auth/'];

// `source → target` for paths deliberately absent. Keyed without line numbers so edits around an
// entry do not stale it. Shrink, never grow silently: an entry that matches nothing fails.
const ABSENT: string[] = [
  // Planned or declined designs.
  'docs/cms-features.md → app/sitemap.ts',
  'docs/cms-features.md → docs/reading-time-requirements.md',
  'docs/cms-features.md → lib/reading-time.ts',
  'docs/multi-author-requirements.md → scripts/purge-withdrawn.mts',
  'docs/toc-requirements.md → e2e/public-toc.spec.ts',
  // Renamed or deleted, named in the account that says so.
  'docs/embed-requirements.md → docs/youtube-embed-requirements.md',
  'docs/embed-requirements.md → e2e/editor-embed-insert.spec.ts',
  'docs/footnote-requirements.md → e2e/editor-footnote-literal.spec.ts',
  'docs/footnote-requirements.md → e2e/editor-footnote-spike.spec.ts',
  // Gitignored, created when the E2E harness runs.
  'GEMINI.md → e2e/.tmp',
];

const LINE_CITE = /(?<![\w/.-])([\w./()[\]-]+\.(?:tsx?|mts|cts|mjs|cjs|js|css|md)):\d+\b/g;
const REPO_PATH = new RegExp(
  String.raw`(?<![\w/.@~-])((?:${PATH_ROOTS.join('|')})/[\w./()[\]@-]*[\w)\]])`,
  'g',
);
// `docs/x.md §3.2`, `x-requirements.md の §3`, `cms-features.md「RSS/Atom フィード」§7.1`.
const SECTION_CITE = /((?:docs\/)?[\w-]+\.md)([^§\n]{0,40}?)§\s?(\d+(?:\.\d+)*)/g;

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
}

// Every comment in a TS/JS file, JSX `{/* */}` included: the leading trivia of every token.
function codeComments(file: string, text: string): string[] {
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const seen = new Map<number, string>();
  const visit = (node: ts.Node): void => {
    for (const range of ts.getLeadingCommentRanges(text, node.pos) ?? []) {
      seen.set(range.pos, text.slice(range.pos, range.end));
    }
    for (const child of node.getChildren(source)) visit(child);
  };
  visit(source);
  return [...seen.values()];
}

function proseOf(file: string): string {
  const text = readFileSync(file, 'utf8');
  if (CODE.test(file)) return codeComments(file, text).join('\n');
  if (file.endsWith('.css')) return (text.match(/\/\*[\s\S]*?\*\//g) ?? []).join('\n');
  return text;
}

// A path as written ends at prose punctuation; a `)` closes a route group only when one opened.
function trimPath(raw: string): string {
  let path = raw;
  while (path.endsWith(')') && path.split(')').length > path.split('(').length) {
    path = path.slice(0, -1);
  }
  return path.replace(/\.+$/, '');
}

function headingExists(doc: string, section: string, feature: string | null): boolean {
  let text = doc;
  if (feature !== null) {
    // A feature heading may carry a status after its name: `# 書き方ヘルプ（設計のみ）`.
    const start = doc.search(new RegExp(`^# ${escapeRegExp(feature)}(?:（[^）]*）)?\\s*$`, 'm'));
    if (start < 0) return false;
    const rest = doc.slice(start + 1);
    const next = rest.search(/^# /m);
    text = next < 0 ? rest : rest.slice(0, next);
  }
  return new RegExp(`^#+ ${escapeRegExp(section)}[.\\s]`, 'm').test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const files = trackedFiles();
const tracked = new Set(files);
for (const file of files) {
  for (let dir = dirname(file); dir !== '.'; dir = dirname(dir)) tracked.add(dir);
}
const docNames = new Set(files.filter((f) => /^docs\/[^/]+\.md$/.test(f)).map((f) => f.slice(5)));
const scanned = files.filter((f) => SCANNED.test(f) && f !== SELF);
const prose = new Map(scanned.map((f) => [f, proseOf(f)]));

describe('references in docs and comments', () => {
  it('scans the tree', () => {
    // A glob that matched nothing would pass every rule below.
    expect(scanned.length).toBeGreaterThan(300);
    expect(prose.get('docs/embed-requirements.md')?.length ?? 0).toBeGreaterThan(0);
  });

  it('cites no repo file by line number', () => {
    const hits: string[] = [];
    for (const [file, text] of prose) {
      for (const [cite, path] of text.matchAll(LINE_CITE)) {
        const repoFile = tracked.has(path) || files.some((f) => f.endsWith(`/${path}`));
        if (repoFile) hits.push(`${file}: ${cite}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('names only repo paths that exist, or are listed in ABSENT', () => {
    let checked = 0;
    const missing = new Set<string>();
    for (const [file, text] of prose) {
      for (const [, raw] of text.matchAll(REPO_PATH)) {
        const path = trimPath(raw);
        checked++;
        if (tracked.has(path) || GENERATED.some((prefix) => path.startsWith(prefix))) continue;
        missing.add(`${file} → ${path}`);
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect([...missing].filter((entry) => !ABSENT.includes(entry)).sort()).toEqual([]);
    expect(ABSENT.filter((entry) => !missing.has(entry))).toEqual([]);
  });

  it('cites only § numbers that are headings of the named doc', () => {
    let checked = 0;
    const bad: string[] = [];
    for (const [file, text] of prose) {
      for (const [, docRef, between, section] of text.matchAll(SECTION_CITE)) {
        const name = docRef.replace(/^docs\//, '');
        // A bare basename not in docs/ is someone else's document (Next's `route.md`).
        if (!docNames.has(name)) {
          if (docRef.startsWith('docs/')) bad.push(`${file}: ${docRef} does not exist`);
          continue;
        }
        const feature = /「([^」]+)」/.exec(between)?.[1] ?? null;
        checked++;
        const doc = readFileSync(`docs/${name}`, 'utf8');
        if (!headingExists(doc, section, feature)) {
          bad.push(`${file}: ${docRef}${feature ? `「${feature}」` : ''} §${section}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(bad).toEqual([]);
  });
});
