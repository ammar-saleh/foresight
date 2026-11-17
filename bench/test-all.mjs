// `npm test`: everything that can run offline against the local test pages. Starts the test server itself if needed.
import { spawn, spawnSync } from 'node:child_process';
let server = null;
const up = async () => { try { return (await fetch('http://localhost:4600/')).ok; } catch { return false; } };
if (!(await up())) { server = spawn(process.execPath, ['server.mjs'], { stdio: 'ignore' }); for (let k = 0; k < 50 && !(await up()); k++) await new Promise((r) => setTimeout(r, 100)); }
const runs = [['matching rules', ['bench/unit.mjs']], ['regression pages', ['bench/smoke.mjs']], ['safety traps', ['bench/adversarial.mjs', '2']], ['abilities', ['bench/abilities.mjs', '2']], ['review cases', ['bench/review3.mjs']], ['review variants', ['bench/review4.mjs']], ['MCP server', ['bench/mcp-check.mjs']]];
let failed = 0;
for (const [label, args] of runs) {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const bad = r.status !== 0 || /FAIL|HARM/.test(out) || (label === 'regression pages' && (out.match(/ OK /g) || []).length < 6);
  if (bad) failed++;
  console.log(`${bad ? 'FAIL' : 'ok  '}  ${label.padEnd(18)} ${(out.trim().split('\n').pop() || '').slice(0, 90)}`);
  if (bad) console.log(out.split('\n').filter((l) => /FAIL|HARM|Error/.test(l)).slice(0, 8).join('\n'));
}
server?.kill();
console.log(failed ? `\n${failed} suite(s) failed` : '\nall offline suites passed');
process.exit(failed ? 1 : 0);
