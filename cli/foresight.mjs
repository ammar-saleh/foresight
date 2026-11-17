#!/usr/bin/env node
// Foresight command-line tool: look once -> plan -> run with checks -> ask only when stuck.  See GUIDE.md.
import fs from 'node:fs';
import * as core from './core.mjs';

const USAGE = `usage:
  foresight open  <session> <url> [--headed]         open a page, print what is on it
  foresight look  <session> [--text] [--links] [--tables] [--find "words"] [--screenshot [file]]
  foresight run   <session> <plan.json> [--from N] [--save <recipe>]
  foresight run   <session> --recipe <name> [--vars '{"key":"value"}' | --vars file.json]
  foresight close <session>
  foresight sessions | recipes | forget <recipe> | guide`;

const [cmd, ...args] = process.argv.slice(2);
const VALUED = ['--from', '--find', '--save', '--recipe', '--vars'];
const flags = {}, pos = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) { pos.push(a); continue; }
  const key = a.slice(2);
  if (VALUED.includes(a)) { if (args[i + 1] === undefined) { console.log(`${a} needs a value\n${USAGE}`); process.exit(2); } if (a === '--find') (flags.find ||= []).push(args[++i]); else flags[key] = args[++i]; }
  else if (a === '--screenshot') flags.screenshot = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
  else if (['--text', '--links', '--tables', '--headed'].includes(a)) flags[key] = true;
  else { console.log(`unknown option ${a}\n${USAGE}`); process.exit(2); }      // a misspelt option must never be silently dropped
}
const lookOpts = { text: flags.text, links: flags.links, tables: flags.tables, find: flags.find, screenshot: flags.screenshot };
const done = (r) => { console.log(r.text); process.exit(r.code); };

if (cmd === 'open' && pos.length >= 2) done(await core.open(pos[0], pos[1], { ...lookOpts, headed: flags.headed }));
if (cmd === 'look' && pos.length >= 1) done(await core.look(pos[0], lookOpts));
if (cmd === 'close' && pos.length >= 1) done(await core.close(pos[0]));
if (cmd === 'sessions') done(core.sessions());
if (cmd === 'recipes') done(core.recipes());
if (cmd === 'forget' && pos.length >= 1) done(core.forget(pos[0]));
if (cmd === 'guide') { console.log(core.guide()); process.exit(0); }
if (flags.from !== undefined && !/^\d+$/.test(flags.from)) { console.log(`--from needs a step number (got "${flags.from}")`); process.exit(2); }
if (cmd === 'run' && pos.length >= 1) {
  let plan = null, vars = {};
  if (flags.vars) {
    try { vars = JSON.parse(fs.existsSync(flags.vars) ? fs.readFileSync(flags.vars, 'utf8') : flags.vars); }
    catch (e) { console.log(`--vars must be JSON or a JSON file: ${e.message}`); process.exit(2); }
  }
  if (!flags.recipe) {
    if (!pos[1]) { console.log(USAGE); process.exit(2); }
    let raw;
    try { raw = JSON.parse(fs.readFileSync(pos[1], 'utf8')); } catch (e) { console.log(`cannot read plan "${pos[1]}": ${e.message}`); process.exit(2); }
    try { plan = flags.vars ? core.fillVars(raw, vars) : raw; } catch (e) { console.log(e.message); process.exit(2); }
    done(await core.run(pos[0], plan, { from: flags.from, save: flags.save, template: raw, look: lookOpts }));
  }
  done(await core.run(pos[0], null, { from: flags.from, recipe: flags.recipe, vars, look: lookOpts }));
}
console.log(USAGE); process.exit(2);
