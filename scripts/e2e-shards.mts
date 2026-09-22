// Run the Playwright E2E suite as N independent processes, one per shard.
//
// Two levers, and they multiply: `workers: 4` in playwright.config.ts runs four spec files at once
// on ONE server, and this script runs N of those as independent processes on N servers. What makes
// the suite slow is not that any test is slow — measured 2026-09-01: 693 tests, median 1.10s, no
// dominant file — it is that they accumulate one after another, and both levers split that
// accumulation on the same unit, the file (`fullyParallel: false` keeps a file's tests in order on
// one worker, which is what the drag-select and autosave specs depend on).
//
// Workers are the lever to reach for first: another browser context is roughly 0.3GB against 1.6GB
// for another `next dev` (measured 2026-09-13), and that cost is what capped this script at three
// shards. Sharding is what buys a second server, and with it a second DB copy — so it is for the
// runs that cannot share one, not for parallelism per se.
//
// Each shard gets its own port, and every other per-server path is derived from that port in
// e2e/constants.ts — DB copy, saved session, build dir, tsconfig. So the only thing this script
// sets is E2E_PORT.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// `node scripts/e2e-shards.mts [count] [playwright args...]` — a leading integer is the shard
// count, and everything after it is handed to each shard's `playwright test` unchanged, so a
// sharded run can be narrowed the same way a plain one is (a file, a --grep).
const argv = process.argv.slice(2);
const countArg = /^\d+$/.test(argv[0] ?? '') ? argv.shift() : undefined;
const shards = Number(countArg ?? process.env.E2E_SHARDS ?? 3);
const basePort = Number(process.env.E2E_PORT ?? 3100);
if (!Number.isInteger(shards) || shards < 1) {
  console.error(`[e2e] shard count must be a positive integer, got "${countArg}"`);
  process.exit(1);
}

const root = process.cwd();
const blobRoot = path.join(root, 'blob-report');
fs.rmSync(blobRoot, { recursive: true, force: true });
fs.mkdirSync(blobRoot, { recursive: true });

// Each shard's console output goes to its own file: three interleaved reporters on one terminal are
// unreadable, and the merged report below is what the run is actually read from. The tail of a
// failing shard's log is printed, so a red run says something without needing the file opened.
const logDir = path.join(root, 'test-results');
fs.mkdirSync(logDir, { recursive: true });

const started = Date.now();
const secs = (ms: number) => `${(ms / 1000).toFixed(0)}s`;

const runs = Array.from({ length: shards }, (_, i) => {
  const shard = i + 1;
  const port = basePort + i;
  const logPath = path.join(logDir, `shard-${shard}.log`);
  const log = fs.createWriteStream(logPath);
  const child = spawn(
    path.join(root, 'node_modules', '.bin', 'playwright'),
    [
      'test',
      `--shard=${shard}/${shards}`,
      '--reporter=blob',
      `--output=test-results/shard-${shard}`,
      ...argv,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        E2E_PORT: String(port),
        PLAYWRIGHT_BLOB_OUTPUT_DIR: path.join(blobRoot, `shard-${shard}`),
      },
    },
  );
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  console.log(
    `[e2e] shard ${shard}/${shards} started on port ${port} → ${path.relative(root, logPath)}`,
  );

  return new Promise<{ shard: number; code: number; logPath: string }>((resolve) => {
    child.on('close', (code) => {
      const status = code === 0 ? 'passed' : `FAILED (exit ${code})`;
      console.log(`[e2e] shard ${shard}/${shards} ${status} after ${secs(Date.now() - started)}`);
      resolve({ shard, code: code ?? 1, logPath });
    });
  });
});

const results = await Promise.all(runs);

// merge-reports wants every blob in one directory; the shards each wrote into their own so that
// the reporter's start-up wipe of its output dir could not race another shard's.
const merged = path.join(blobRoot, 'all');
fs.mkdirSync(merged, { recursive: true });
for (const entry of fs.readdirSync(blobRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'all') continue;
  for (const file of fs.readdirSync(path.join(blobRoot, entry.name))) {
    if (file.endsWith('.zip')) {
      fs.copyFileSync(path.join(blobRoot, entry.name, file), path.join(merged, file));
    }
  }
}

const failed = results.filter((r) => r.code !== 0);
for (const { shard, logPath } of failed) {
  console.log(`\n[e2e] tail of shard ${shard}:`);
  console.log(fs.readFileSync(logPath, 'utf8').split('\n').slice(-40).join('\n'));
}

// Merged through the JSON reporter rather than `list`. The console reporters replay every test's
// captured stdout, and this suite's is enormous — the specs' own `[measure]` lines plus the piped
// `next dev` log, which is what `stdout: 'pipe'` in playwright.config.ts asks for. Merging 695
// tests that way truncates partway through with exit 0, so the summary never prints and a third of
// the run silently goes missing from it (measured 2026-09-01: 465 of 695 listed). The JSON goes to
// a file, and what reaches the terminal is counted from it.
const mergedJson = path.join(blobRoot, 'merged.json');
const run = (args: string[], env: Record<string, string> = {}) =>
  new Promise<number>((resolve) => {
    const child = spawn(path.join(root, 'node_modules', '.bin', 'playwright'), args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: 'ignore',
    });
    child.on('close', (code) => resolve(code ?? 1));
  });

await run(['merge-reports', '--reporter=json', merged], {
  PLAYWRIGHT_JSON_OUTPUT_NAME: mergedJson,
});

type Result = { status: string };
type Spec = { file?: string; title: string; tests?: { results?: Result[] }[] };
type Suite = { file?: string; specs?: Spec[]; suites?: Suite[] };
const report = JSON.parse(fs.readFileSync(mergedJson, 'utf8')) as {
  suites: Suite[];
  stats?: { expected: number; unexpected: number; flaky: number; skipped: number };
};

const red: string[] = [];
let total = 0;
const walk = (suite: Suite, file?: string): void => {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      for (const result of test.results ?? []) {
        total += 1;
        if (result.status !== 'passed') red.push(`${spec.file ?? file} › ${spec.title}`);
      }
    }
  }
  for (const child of suite.suites ?? []) walk(child, suite.file ?? file);
};
for (const suite of report.suites) walk(suite, suite.file);

console.log(`\n[e2e] ${total} tests across ${shards} shards in ${secs(Date.now() - started)}.`);
if (red.length > 0) {
  console.log(`[e2e] ${red.length} not passed:`);
  for (const name of red) console.log(`  ✘ ${name}`);
  // The traces (`trace: 'retain-on-failure'`) are in the blobs; this is what opens them.
  await run(['merge-reports', '--reporter=html', merged]);
  console.log('[e2e] html report: npx playwright show-report');
}

process.exit(failed.length > 0 || red.length > 0 ? 1 : 0);
