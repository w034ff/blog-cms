import { test, expect } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolveEmbed } from '../lib/embed-provider';

// docs/embed-requirements.md §18.5, criterion G11: the gist's frame document, run for real, which
// public-embed.spec.ts cannot stub (sandboxed without `allow-same-origin`). `srcdoc` takes the script
// URL, so the shipped reporter runs against a script served here. Not a data: URL: Chrome refuses it
// as `<script src>`, reporting zero files.
const GIST = 'https://gist.github.com/qiitan/fa7df2b570a3f16b39e990b2d2c20aae';
const HEIGHT = 612;

type Report = { source: string; id: string; height: number; files: number };

test('the frame announces its height, answers an ask, and reports an empty gist (G11)', async ({
  page,
}) => {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/gist.js')) {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(`document.write('<div class="gist-file" style="height:${HEIGHT}px">stub</div>')`);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port;

  try {
    const target = resolveEmbed(GIST)!;
    const drawn = target.srcdoc!(`http://127.0.0.1:${port}/gist.js`, 'emb-drawn');
    // A missing script is what GitHub serves for a dead id: nothing drawn.
    const empty = target.srcdoc!(`http://127.0.0.1:${port}/missing.js`, 'emb-empty');

    // A real origin: from `about:blank` the script cannot load, reporting zero files.
    await page.goto('/');
    await page.evaluate(() => {
      (window as unknown as { reports: Report[] }).reports = [];
      addEventListener('message', (event) => {
        const data = event.data as Report | null;
        if (data && data.source === 'gist-embed') {
          (window as unknown as { reports: Report[] }).reports.push(data);
        }
      });
    });
    await page.evaluate((docs) => {
      for (const doc of docs) {
        const frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-scripts allow-popups');
        frame.style.cssText = 'width:600px;height:200px;border:0;display:block';
        frame.srcdoc = doc;
        document.body.appendChild(frame);
      }
    }, [drawn, empty]);

    const reports = async () =>
      page.evaluate(() => (window as unknown as { reports: Report[] }).reports);

    // **The height, unprompted**, the reason for our own document over `.pibb` (§18.3).
    await expect
      .poll(async () => (await reports()).find((r) => r.id === 'emb-drawn')?.height)
      .toBe(HEIGHT);
    expect((await reports()).find((r) => r.id === 'emb-drawn')?.files).toBe(1);
    // Zero files: the signal for a link or a note (§18.5).
    await expect
      .poll(async () => (await reports()).find((r) => r.id === 'emb-empty')?.files)
      .toBe(0);

    // **The ask**: a parent listening late would keep the guess, so it asks, and the reply is counted.
    const before = (await reports()).filter((r) => r.id === 'emb-drawn').length;
    await page.evaluate(() => {
      document.querySelectorAll('iframe')[0].contentWindow?.postMessage({ ask: 'gist-embed' }, '*');
    });
    await expect
      .poll(async () => (await reports()).filter((r) => r.id === 'emb-drawn').length)
      .toBeGreaterThan(before);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});
