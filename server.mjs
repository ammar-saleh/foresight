// Local test server: serves the scenario site, the task specs, and collects timings.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4600);
const RESULTS = path.join(ROOT, 'results', 'results.jsonl');
fs.mkdirSync(path.dirname(RESULTS), { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/api/result' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const rec = JSON.parse(body);
        rec.receivedAt = new Date().toISOString();
        fs.appendFileSync(RESULTS, JSON.stringify(rec) + '\n');
        send(res, 200, '{"ok":true}');
      } catch { send(res, 400, '{"ok":false}'); }
    });
    return;
  }
  if (url.pathname === '/api/results') {
    const txt = fs.existsSync(RESULTS) ? fs.readFileSync(RESULTS, 'utf8') : '';
    return send(res, 200, JSON.stringify(txt.split('\n').filter(Boolean).map((l) => JSON.parse(l))));
  }
  if (url.pathname === '/api/airports') {
    // Slow, jittery suggestion API (350-650 ms) like a real typeahead backend.
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const all = ['Amman, Jordan (AMM)', 'Aqaba, Jordan (AQJ)', 'Ammassalik, Greenland (AGM)', 'Amsterdam, Netherlands (AMS)',
      'Istanbul, Türkiye (IST)', 'Istanbul Sabiha Gökçen, Türkiye (SAW)', 'Isfahan, Iran (IFN)', 'Austin, USA (AUS)', 'Athens, Greece (ATH)'];
    const hits = q.length < 2 ? [] : all.filter((a) => a.toLowerCase().includes(q));
    setTimeout(() => send(res, 200, JSON.stringify(hits)), 350 + Math.random() * 300);
    return;
  }
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const base = p.startsWith('/tasks/') ? ROOT : path.join(ROOT, 'site');
  const file = path.normalize(path.join(base, p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found', 'text/plain');
  send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
});

server.listen(PORT, () => console.log(`test site on http://localhost:${PORT}`));
