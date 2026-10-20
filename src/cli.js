#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { apply, clean, context, loadPlan, makePlan, preview, savePlan, undo } from './core.js';
import { propose, selectModel } from './providers.js';

const HELP = `Vibe Patch — Claude / OpenAI / Gemini code changes you review.

  vibe-patch propose "request" --provider claude --model MODEL_ID [--file src/app.js]
  vibe-patch chat --provider gemini --model MODEL_ID
  vibe-patch preview
  vibe-patch apply                  Review again, then type APPLY
  vibe-patch undo BACKUP_ID         Restore only if files have not changed
  vibe-patch demo                   Offline sample; no API key needed

Options: --root DIRECTORY, --file PATH (repeatable), --provider, --model, --help
Only explicitly selected --file contents are sent to the chosen provider.
Use Node's --env-file=/private/path/.env to load API keys. No shell execution.
In chat: /model PROVIDER MODEL_ID, /files path1 path2, /exit.
Use propose with repeated --file options for filenames containing spaces.
`;

export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    root: { type: 'string', default: '.' }, file: { type: 'string', multiple: true, default: [] },
    provider: { type: 'string' }, model: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help || !positionals.length) { console.log(HELP); return; }
  const root = await fs.realpath(path.resolve(values.root));
  if (!(await fs.stat(root)).isDirectory()) throw new Error('--root must be an existing directory.');
  const [command, ...rest] = positionals;
  const confirm = async (plan) => {
    console.log(preview(plan));
    if (!process.stdin.isTTY) throw new Error('Apply requires an interactive terminal.');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if ((await rl.question('Type APPLY to write these files: ')) !== 'APPLY') { console.log('Cancelled.'); return; }
    } finally { rl.close(); }
    const id = await apply(root, plan);
    console.log(`Applied. Undo with: vibe-patch undo ${id}`);
  };
  if (command === 'preview') { console.log(preview(await loadPlan(root))); return; }
  if (command === 'apply') { await confirm(await loadPlan(root)); return; }
  if (command === 'undo') { await undo(root, rest[0] ?? ''); console.log('Restored original files.'); return; }
  if (command === 'demo') {
    const plan = await makePlan(root, { summary: 'Offline demo: a responsive starter page. No AI request was made.', files: [{
      path: 'vibe-demo.html', content: '<!doctype html>\n<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vibe Patch</title>\n<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#121a2b;color:#eef3ff;font:18px system-ui}main{padding:3rem;max-width:44rem}h1{font-size:clamp(3rem,9vw,6rem);line-height:1}b{color:#a7f3d0}p{line-height:1.7}</style>\n<main><b>IDEA → REVIEW → BUILD</b><h1>Make something useful.</h1><p>Your project starts with a conversation. Choose Claude, OpenAI, or Gemini. Review the changes. Keep building.</p></main></html>\n',
    }] });
    await savePlan(root, plan); console.log(preview(plan)); console.log('Saved offline demo. Next: vibe-patch apply'); return;
  }
  let provider = values.provider, modelId = values.model, names = values.file;
  const generate = async (request) => {
    if (!request.trim() || request.length > 12000) throw new Error('Request must contain 1–12000 characters.');
    const selected = await context(root, names);
    const model = selectModel(provider, modelId);
    console.log(`Sending request and ${Object.keys(selected).length} selected file(s) to ${provider}…`);
    const { output, usage } = await propose(model, request, selected);
    const plan = await makePlan(root, output, selected);
    await savePlan(root, plan);
    console.log(`Tokens: input=${usage.inputTokens ?? '?'} output=${usage.outputTokens ?? '?'}`);
    return plan;
  };
  if (command === 'propose') {
    const plan = await generate(rest.join(' ')); console.log(preview(plan));
    console.log('Proposal saved. Run vibe-patch apply to review and write.'); return;
  }
  if (command !== 'chat') throw new Error('Unknown command. Run with --help.');
  if (!process.stdin.isTTY) throw new Error('Chat requires an interactive terminal.');
  selectModel(provider, modelId); // Fail before starting a chat with missing credentials.
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log('Vibe Patch chat. /model PROVIDER MODEL_ID • /files path1 path2 • /exit');
  try {
    while (true) {
      const request = (await rl.question(`\n${provider}> `)).trim();
      if (request === '/exit') break;
      if (!request) continue;
      try {
        if (request.startsWith('/model ')) {
          const [next, id] = request.slice(7).trim().split(/\s+/);
          selectModel(next, id); provider = next; modelId = id; continue;
        }
        if (request.startsWith('/files')) {
          const next = request.slice(6).trim().split(/\s+/).filter(Boolean);
          await context(root, next); names = next; console.log(`Selected ${names.length} files.`); continue;
        }
        const plan = await generate(request);
        console.log(preview(plan));
        if ((await rl.question('Type APPLY to write, or Enter to skip: ')) === 'APPLY') {
          const id = await apply(root, plan);
          names = [...new Set([...names, ...plan.files.map(file => file.path)])];
          console.log(`Applied. Undo: vibe-patch undo ${id}`);
        }
      } catch (error) { console.error(clean(error.message)); }
    }
  } finally { rl.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(clean(error.message)); process.exitCode = 1; });
}
