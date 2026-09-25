import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Keeps docs/embed-requirements.md's acceptance criteria honest about what measures them: every
// row's 測り方 column names a file, and nothing checked that it exists or can be found from the id.
//
// Three things are enforced:
//
//   1. Every criterion names a *.test.ts / *.spec.ts, or says in that column why it does not.
//      E6 is 手動確認, B17 is 未測, and P8 defers to P4 — those three are the shape a reason takes.
//   2. Every file so named exists.
//   3. §3.4's index of where the criteria live agrees with the tables it indexes.
//
// Whether the named file mentions the id is a ledger, not a rule, since the convention is uneven
// (some specs cite ids in titles, e2e/editor-github-blob.spec.ts only sections). UNCITED is that
// gap: a new uncited criterion fails, and so does wiring an old one up until its entry goes. The
// list may shrink, never grow silently.

const DOC = join(process.cwd(), 'docs', 'embed-requirements.md');

// `| E1  | …criterion… | `lib/render.test.ts` |` — the id column is letters then digits, which is
// what separates a criterion row from §3.4's index rows (letters only).
const CRITERION_ROW = /^\| ([A-Z]{1,2}\d{1,2}) +\|([^|]*)\|([^|]*)\|/gm;
const INDEX_ROW = /^\| ([A-Z]{1,2}) +\|[^|]*\| +(\d+) +\| §([\d.]+) +\|/gm;
const TEST_FILE = /`([\w./-]+\.(?:test|spec)\.tsx?)`/g;

// A row that names no file has to say why. 手動確認 / 未測 for the two that are not automated, or
// another criterion's id for one that is covered by its neighbour.
const REASON = /手動確認|未測|[A-Z]{1,2}\d{1,2}/;

// An id is cited when it stands alone. The `%` guard is what keeps `%E8%A6%8B` — percent-encoded
// Japanese in e2e/editor-fragment-encode.spec.ts — from reading as citations of E8 and E5.
const citation = (id: string) => new RegExp(`(?<![A-Za-z0-9%])${id}(?![A-Za-z0-9])`);

// Criteria whose measuring file does not name them. Shrink, never grow.
const UNCITED: string[] = [
  'B3 e2e/editor-github-blob.spec.ts',
  'B6 e2e/editor-github-blob.spec.ts',
  'B10 e2e/editor-github-blob.spec.ts',
  'B11 e2e/editor-github-blob.spec.ts',
  'B12 e2e/editor-github-blob.spec.ts',
  'B13 e2e/editor-github-blob.spec.ts',
  'B14 e2e/editor-github-blob.spec.ts',
  'B15 e2e/editor-github-blob.spec.ts',
  'B16 e2e/editor-github-blob.spec.ts',
  'B18 e2e/editor-github-blob.spec.ts',
  'B19 e2e/editor-github-blob.spec.ts',
  'B20 e2e/editor-github-blob.spec.ts',
  'C8 e2e/editor-embed.spec.ts',
  'C9 e2e/editor-embed.spec.ts',
  'E5 e2e/editor-embed.spec.ts',
  'E8 e2e/editor-embed.spec.ts',
  'E9 e2e/editor-embed.spec.ts',
  'E11 e2e/editor-x-embed.spec.ts',
  'E11 lib/render.test.ts',
  'E13 e2e/editor-x-embed.spec.ts',
  'E14 e2e/editor-block-drag-handle.spec.ts',
  'E15 components/editor/embed-placement.test.ts',
  'E15 e2e/editor-embed.spec.ts',
  'E16 components/editor/embed-placement.test.ts',
  'E17 e2e/editor-x-embed.spec.ts',
  'E18 e2e/editor-embed.spec.ts',
  'P2 lib/render.test.ts',
  'X2 e2e/editor-embed.spec.ts',
  'X7 e2e/editor-embed.spec.ts',
  'X8 e2e/public-x-embed.spec.ts',
  'X9 e2e/editor-x-embed.spec.ts',
  'X10 e2e/editor-x-embed.spec.ts',
  'Y1 e2e/public-embed.spec.ts',
];

type Criterion = { id: string; how: string; files: string[] };

function readDoc(): string {
  return readFileSync(DOC, 'utf8');
}

function criteria(doc: string): Criterion[] {
  return [...doc.matchAll(CRITERION_ROW)].map((row) => ({
    id: row[1],
    how: row[3],
    files: [...row[3].matchAll(TEST_FILE)].map((hit) => hit[1]),
  }));
}

describe('embed acceptance criteria (docs/embed-requirements.md)', () => {
  const doc = readDoc();
  const rows = criteria(doc);

  it('parses the criteria tables', () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it('gives every criterion a unique id', () => {
    const seen = new Map<string, number>();
    for (const { id } of rows) seen.set(id, (seen.get(id) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1).map(([id]) => id)).toEqual([]);
  });

  it('names a measuring file for every criterion, or says why not', () => {
    const silent = rows.filter(({ how, files }) => files.length === 0 && !REASON.test(how));
    expect(silent.map(({ id }) => id)).toEqual([]);
  });

  it('names only files that exist', () => {
    const gone = rows.flatMap(({ id, files }) =>
      files.filter((file) => !existsSync(join(process.cwd(), file))).map((file) => `${id} ${file}`),
    );
    expect(gone).toEqual([]);
  });

  it('has the measured gap that UNCITED records, and no other', () => {
    const gap = rows.flatMap(({ id, files }) =>
      files
        .filter((file) => !citation(id).test(readFileSync(join(process.cwd(), file), 'utf8')))
        .map((file) => `${id} ${file}`),
    );
    expect(gap.sort()).toEqual([...UNCITED].sort());
  });

  it('agrees with §3.4’s index of where the criteria live', () => {
    const counted = new Map<string, number>();
    for (const { id } of rows) {
      const prefix = id.replace(/\d+$/, '');
      counted.set(prefix, (counted.get(prefix) ?? 0) + 1);
    }
    const indexed = [...doc.matchAll(INDEX_ROW)].map((row) => `${row[1]} ${row[2]}`);
    expect(indexed).toEqual([...counted].map(([prefix, n]) => `${prefix} ${n}`));
  });
});

// §3.4's other two tables restate values declared elsewhere: marks from icon-shapes.ts and
// lib/embed-provider.ts, reader costs from the §N.5 sections. The third-party costs cannot be
// checked here, but the copies' agreement can.

const MARK_SHAPES = join(process.cwd(), 'components', 'editor', 'svg', 'icon-shapes.ts');
const PROVIDERS = join(process.cwd(), 'lib', 'embed-provider.ts');

// `| SlideShare（§14.8）   | `SLIDESHARE_MARK_SHAPES`   | …出典… | …寸法… | `SlideShare` / `''` |`
const MARK_ROW = /^\| [^|]+?（§[\d.]+）\s*\| `([A-Z_]+)`[^|]*\|[^|]*\|[^|]*\|([^|]*)\|/gm;
// `| GitHub Gist（§18.7） | 2 | …` — the section that measured it, and the first number it reports.
const COST_ROW = /^\| [^|(（]+[（(]§([\d.]+)[^)）]*[)）]\s*\| ([^|]*)\|/gm;

// Every mark the editor can draw for an embed, as `embedMarkShapes` returns them — the `if` chain
// plus the ternary that ends it, whose else-branch is the default play mark.
const MARK_CONSTANTS = /return (?:provider === '[\w-]+' \? )?([A-Z_]+)(?: : ([A-Z_]+))?;/g;

function section(doc: string, number: string): string {
  // A top-level heading spells the number with a period (`## 13. 却下した案`), a sub-heading
  // without one (`### 20.8 読者が払うもの`); the cost table cites both kinds.
  const start = doc.search(new RegExp(`^#{2,3} ${number.replace('.', '\\.')}\\.? `, 'm'));
  if (start < 0) return '';
  // Past the heading's own line, so the search below finds the *next* heading rather than this one.
  const body = doc.slice(doc.indexOf('\n', start) + 1);
  const end = body.search(/^#{2,3} \d/m);
  return end < 0 ? body : body.slice(0, end);
}

describe('§3.4’s cross-provider index (docs/embed-requirements.md)', () => {
  const doc = readDoc();
  const index = doc.slice(doc.indexOf('### 3.4'), doc.indexOf('## 4.'));

  // Each table is read out of its own `####` block. The three share a row shape — a name, its
  // section in parentheses, then values — so a regex let loose on the whole of §3.4 would read the
  // mark rows as cost rows and check numbers that are not request counts against sections that
  // never claimed one.
  const table = (heading: string): string => {
    const start = index.indexOf(`#### ${heading}`);
    const rest = index.slice(index.indexOf('\n', start) + 1);
    const end = rest.indexOf('#### ');
    return end < 0 ? rest : rest.slice(0, end);
  };
  const marks = table('マークとラベル');
  const costs = table('読者が払うもの');

  it('names marks that exist, and names all of them', () => {
    const shapes = readFileSync(MARK_SHAPES, 'utf8');
    const tabled = [...marks.matchAll(MARK_ROW)].map((row) => row[1]);
    const declared = [...shapes.matchAll(MARK_CONSTANTS)].flatMap((hit) => [hit[1], hit[2]]);
    expect(tabled.filter((name) => !shapes.includes(`export const ${name}`))).toEqual([]);
    // Both directions: a provider added to embedMarkShapes without a row here, or a row left behind
    // by one removed from it, is the drift this table exists to prevent.
    expect([...new Set(tabled)].sort()).toEqual([...new Set(declared.filter(Boolean))].sort());
  });

  it('quotes the labels lib/embed-provider.ts actually builds', () => {
    const providers = readFileSync(PROVIDERS, 'utf8');
    // `<owner>` and `@<account>` stand for a value the URL carries (§10.4, §18.8); only the literal
    // leads are a string this file can look for.
    const literal = [...marks.matchAll(MARK_ROW)]
      .map((row) => row[2].match(/`([^`]*)`/)?.[1] ?? '')
      .filter((lead) => lead.length > 0 && !lead.includes('<'));
    // Either spelling, though leads named after the provider now read `Provider.name` (§3.4's
    // naming table, §24.1). The doc must quote a string this file contains; embed-provider.test.ts
    // ties `name` to the lead.
    expect(
      literal.filter(
        (lead) => !providers.includes(`lead: '${lead}'`) && !providers.includes(`name: '${lead}'`),
      ),
    ).toEqual([]);
  });

  it('reports the request counts its own §N.5 sections measured', () => {
    const disagreed = [...costs.matchAll(COST_ROW)].flatMap((row) => {
      const [, number, cell] = row;
      const first = cell.match(/\d+/)?.[0];
      if (first === undefined) return [];
      const body = section(doc, number);
      return body.includes(first) ? [] : [`§${number} ${first}`];
    });
    expect(disagreed).toEqual([]);
  });
});
