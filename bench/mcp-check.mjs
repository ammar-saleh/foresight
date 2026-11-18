// End-to-end check of the MCP server: speaks the protocol over stdio exactly as an AI client would.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
const srv = spawn(process.execPath, ['mcp/server.mjs'], { stdio: ['pipe', 'pipe', 'inherit'] });
const rl = readline.createInterface({ input: srv.stdout });
const waiting = new Map(); let id = 0;
rl.on('line', (l) => { const m = JSON.parse(l); waiting.get(m.id)?.(m); waiting.delete(m.id); });
const rpc = (method, params) => new Promise((res) => { const i = ++id; waiting.set(i, res); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
const tool = async (name, args) => (await rpc('tools/call', { name, arguments: args })).result;
let fails = 0; const ok = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); };

const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'check', version: '1' } });
ok('initialize', init.result?.serverInfo?.name === 'foresight');
srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const list = await rpc('tools/list', {});
ok('tools/list', list.result?.tools?.length === 6, list.result?.tools?.map((t) => t.name).join(', '));
ok('guide', (await tool('foresight_guide', {})).content[0].text.includes('Plan format'));
const o = await tool('foresight_open', { session: 'mcp-check', url: 'http://localhost:4600/more.html?case=native' });
ok('open', /Start date/.test(o.content[0].text) && !o.isError);
const r = await tool('foresight_run', { session: 'mcp-check', steps: [{ fill: 'Start date', value: '{{d}}' }, { fill: 'Seats', value: '4' }, { click: 'Save', expect: { text: 'Saved' } }], vars: { d: '2026-12-01' }, find: 'Saved' });
ok('run', /"ok":true/.test(r.content[0].text) && !r.isError);
const bad = await tool('foresight_run', { session: 'mcp-check', steps: [{ click: 'No such button' }] });
ok('stopped run is a normal result with guidance', /"ok":false/.test(bad.content[0].text) && /"next"/.test(bad.content[0].text) && bad.isError === false);
const inv = await tool('foresight_run', { session: 'mcp-check', steps: [{ clik: 'Save' }] });
ok('malformed plan is rejected', /no known action/.test(inv.content[0].text));
const l = await tool('foresight_look', { session: 'mcp-check', find: 'Saved' });
ok('look/find', /FIND "Saved"/.test(l.content[0].text));
// a file the page hands over is kept in the session's own folder (never the user's Downloads) and listed in the result
const dl = await tool('foresight_run', { session: 'mcp-check', steps: [{ goto: 'http://localhost:4600/apply.html?case=download' }, { click: 'Export as CSV', expect: { text: 'Export started' } }] });
ok('download kept in the session folder', /"downloads":\[\{"file":"[^"]*downloads[^"]*mcp-check[^"]*export[^"]*\.csv","bytes":\d+/.test(dl.content[0].text.replace(/\\\\/g, '/')), dl.content[0].text.match(/"downloads":[^\]]*\]/)?.[0] || 'no downloads listed');
ok('close', (await tool('foresight_close', { session: 'mcp-check' })).content[0].text === 'closed');
ok('unknown tool -> error', !!(await rpc('tools/call', { name: 'nope', arguments: {} })).error);
srv.stdin.end();
console.log(fails ? `\n${fails} check(s) failed` : '\nall MCP checks passed');
process.exit(fails ? 1 : 0);
