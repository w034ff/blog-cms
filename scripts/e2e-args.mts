// What `npm run test:e2e` accepts (scripts/e2e-run.mts), separate so it is testable: importing
// e2e-run.mts would start a run.

// A spec file, or one test in it by line: `e2e/<name>.spec.ts`, `e2e/<name>.spec.ts:42`.
const SPEC_PATH = /\.spec\.ts(?::\d+)?$/;

// Reruns only what failed last time, so it names its targets without a path.
const TARGETED_FLAGS = new Set(['--last-failed']);

// True when the arguments name what to run. Anything else runs every spec: `playwright test` with
// no file, or with only a `--grep`, still loads the whole suite.
export function namesTargets(args: readonly string[]): boolean {
  return args.some((arg) => SPEC_PATH.test(arg) || TARGETED_FLAGS.has(arg));
}
