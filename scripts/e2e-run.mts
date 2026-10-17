import { spawn } from 'node:child_process';
import { namesTargets } from './e2e-args.mts';

// `npm run test:e2e -- e2e/<name>.spec.ts …`: Playwright, refusing a run that names no spec. With
// no file it runs the whole suite, about 14 minutes, and an empty spec list built by a filter that
// matched nothing looks exactly like that. The whole suite is `npm run test:e2e:all`.
const args = process.argv.slice(2);

if (!namesTargets(args)) {
  console.error(
    '[e2e] No spec named, which would run the whole suite. Pass the specs you mean\n' +
      '      (npm run test:e2e -- e2e/<name>.spec.ts), or run npm run test:e2e:all.',
  );
  process.exit(1);
}

// `playwright` resolves through node_modules/.bin, which npm puts on PATH for a script.
const child = spawn('playwright', ['test', ...args], { stdio: 'inherit' });
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
