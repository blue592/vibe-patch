import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { apply, context, loadPlan, makePlan, preview, read, savePlan, undo, validatePath } from '../src/core.js';

async function workspace(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibe-patch-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('path traversal, credentials, Windows aliases and private directories are blocked', () => {
  for (const name of ['../escape', '/absolute', 'a\\b', 'C:/x', '.env', '.env.local', '.git/config', '.vibepatch/pending.json', 'node_modules/pkg.js', 'CON.txt', 'a:stream', 'a./b', 'id.key', '.ssh/config']) {
    assert.throws(() => validatePath(name), name);
  }
  assert.equal(validatePath('src/my app.js'), 'src/my app.js');
});

test('new file + edit roundtrip with persisted preview, backup and undo', async t => {
  const root = await workspace(t);
  await fs.writeFile(path.join(root, 'app.js'), '\ufeffold\r\n');
  const selected = await context(root, ['app.js']);
  const plan = await makePlan(root, { summary: 'Improve', files: [{ path: 'app.js', content: 'new\n' }, { path: 'src/new.js', content: 'hello' }] }, selected);
  await savePlan(root, plan);
  assert.equal(await read(root, 'src/new.js'), null);
  assert.match(preview(await loadPlan(root)), /--- app.js/);
  const id = await apply(root, await loadPlan(root));
  assert.equal(await read(root, 'app.js'), 'new\n');
  assert.equal(await read(root, 'src/new.js'), 'hello');
  await undo(root, id);
  assert.equal(await read(root, 'app.js'), '\ufeffold\r\n');
  assert.equal(await read(root, 'src/new.js'), null);
});

test('unselected existing files cannot be overwritten', async t => {
  const root = await workspace(t);
  await fs.writeFile(path.join(root, 'app.js'), 'original');
  await assert.rejects(makePlan(root, { summary: 'x', files: [{ path: 'app.js', content: 'bad' }] }), /--file/);
});

test('stale proposal fails preflight before writing any file', async t => {
  const root = await workspace(t);
  const plan = await makePlan(root, { summary: 'x', files: [{ path: 'first.js', content: 'a' }, { path: 'second.js', content: 'b' }] });
  await fs.writeFile(path.join(root, 'second.js'), 'user edit');
  await assert.rejects(apply(root, plan), /changed/);
  assert.equal(await read(root, 'first.js'), null);
});

test('undo refuses to overwrite edits made after apply', async t => {
  const root = await workspace(t);
  const plan = await makePlan(root, { summary: 'x', files: [{ path: 'app.js', content: 'new' }] });
  const id = await apply(root, plan);
  await fs.writeFile(path.join(root, 'app.js'), 'later user edit');
  await assert.rejects(undo(root, id), /file changed/);
});

test('malformed, duplicate, ancestor and oversized proposals are rejected', async t => {
  const root = await workspace(t);
  for (const files of [[], [{ path: 'a', content: 1 }], [{ path: 'a', content: 'x' }, { path: 'A', content: 'y' }], [{ path: 'a', content: 'x' }, { path: 'a/b', content: 'y' }], [{ path: 'a', content: 'x'.repeat(200001) }]]) {
    await assert.rejects(makePlan(root, { summary: 'x', files }));
  }
});

test('symlink directories cannot escape root', async t => {
  const root = await workspace(t), outside = await workspace(t);
  await fs.symlink(outside, path.join(root, 'linked'), 'junction');
  await assert.rejects(read(root, 'linked/file.js'), /Unsafe/);
});

test('context rejects binary and caps total content', async t => {
  const root = await workspace(t);
  await fs.writeFile(path.join(root, 'binary'), Buffer.from([0, 1, 2]));
  await assert.rejects(context(root, ['binary']), /Binary/);
  await fs.writeFile(path.join(root, 'a'), 'a'.repeat(120000));
  await fs.writeFile(path.join(root, 'b'), 'b'.repeat(120000));
  await assert.rejects(context(root, ['a', 'b']), /200 KB/);
});

test('preview strips terminal control codes', () => {
  const result = preview({ summary: '\x1b[31mhello', files: [{ path: 'a', before: null, content: '\x1b[2Jcode' }] });
  assert.ok(!result.includes('\x1b'));
});

test('CLI offline demo saves a proposal and requires a terminal to apply', async t => {
  const root = await workspace(t);
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const demo = spawnSync(process.execPath, [cli, 'demo', '--root', root], { encoding: 'utf8' });
  assert.equal(demo.status, 0, demo.stderr);
  assert.equal(await read(root, 'vibe-demo.html'), null);
  assert.equal((await loadPlan(root)).files.length, 1);
  const result = spawnSync(process.execPath, [cli, 'apply', '--root', root], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /interactive terminal/);
});
