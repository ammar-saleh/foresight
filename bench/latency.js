// Simulates a remote/cloud browser: a TCP proxy in front of Chrome's DevTools port that delays every
// chunk by half the round-trip time in each direction (order preserved). Every executor talks to the
// browser through it, so each protocol round trip costs what it would against a hosted browser.
import net from 'node:net';
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { findBrowser } from '../cli/core.mjs';

const CHROME = findBrowser();   // Chrome, Edge, Chromium or Brave; FORESIGHT_CHROME overrides

function delayedPipe(from, to, ms) {
  let chain = Promise.resolve();
  from.on('data', (buf) => {
    const due = Date.now() + ms;
    chain = chain.then(() => new Promise((r) => setTimeout(() => { if (!to.destroyed) to.write(buf); r(); }, Math.max(0, due - Date.now()))));
  });
  from.on('close', () => chain.then(() => to.destroy()));
  from.on('error', () => {});
}

export async function launchRemoteLike(rttMs, { headless = true } = {}) {
  const port = 9300 + Math.floor(Math.random() * 500), proxyPort = port + 1000;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-chrome-'));
  const proc = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    ...(headless ? ['--headless=new'] : []), 'about:blank'], { stdio: 'ignore' });
  let ver;
  for (let k = 0; k < 100 && !ver; k++) {
    try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  const server = net.createServer((client) => {
    const upstream = net.connect(port, '127.0.0.1');
    delayedPipe(client, upstream, rttMs / 2);
    delayedPipe(upstream, client, rttMs / 2);
    upstream.on('error', () => client.destroy());
  }).listen(proxyPort);
  const ws = ver.webSocketDebuggerUrl.replace(`:${port}/`, `:${proxyPort}/`);
  const browser = await chromium.connectOverCDP(ws);
  return {
    browser,
    async close() { await browser.close().catch(() => {}); server.close(); proc.kill(); },
  };
}
