import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const clean = (text) => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
const LIMIT = 200_000;

/** Validate portable project paths, including on Windows. */
export function validatePath(name) {
  if (typeof name !== 'string' || !name || name.length > 240) throw new Error('Invalid file path.');
  const segments = name.split('/');
  for (const part of segments) {
    if (!/^[\w.@ -]+$/.test(part) || ['.', '..'].includes(part) || /[. ]$/.test(part)
      || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)
      || /^(\.env(?:\.|$)|\.git$|\.vibepatch$|node_modules$|\.ssh$|\.aws$)/i.test(part)
      || /\.(pem|key|p12|pfx)$/i.test(part)) throw new Error(`Blocked path: ${clean(name)}`);
  }
  return name;
}

/** Reject symlinks/junctions in every existing component. */
export async function target(root, name) {
  validatePath(name);
  let current = root;
  const parts = name.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory())) throw new Error('Unsafe path component.');
      if (i === parts.length - 1 && !stat.isFile()) throw new Error('Target is not a regular file.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return current;
}

export async function read(root, name) {
  const filename = await target(root, name);
  try {
    const stat = await fs.stat(filename);
    if (stat.size > LIMIT || stat.nlink > 1) throw new Error('File is too large or hard-linked.');
    const bytes = await fs.readFile(filename);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.includes('\0')) throw new Error('Binary files are not supported.');
    return text;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function context(root, names) {
  const result = {};
  let size = 0;
  for (const name of names) {
    const text = await read(root, name);
    if (text === null) throw new Error(`Context file does not exist: ${name}`);
    size += Buffer.byteLength(text);
    if (size > LIMIT) throw new Error('Selected context exceeds 200 KB.');
    Object.defineProperty(result, name, { value: text, enumerable: true });
  }
  return result;
}

/** Validate untrusted model output before touching files. */
export async function makePlan(root, output, selected = {}) {
  if (!output || typeof output.summary !== 'string' || output.summary.length > 4000
    || !Array.isArray(output.files) || !output.files.length || output.files.length > 20) throw new Error('Invalid proposal schema.');
  const files = [];
  const seen = new Set();
  let size = 0;
  for (const file of output.files) {
    validatePath(file.path);
    if (typeof file.content !== 'string' || file.content.includes('\0')) throw new Error('Invalid file content.');
    const key = file.path.toLowerCase();
    if (seen.has(key) || [...seen].some(other => key.startsWith(other + '/') || other.startsWith(key + '/'))) throw new Error('Conflicting output paths.');
    seen.add(key);
    size += Buffer.byteLength(file.content);
    if (size > LIMIT) throw new Error('Proposal exceeds 200 KB.');
    const before = await read(root, file.path);
    if (before !== null && (!Object.hasOwn(selected, file.path) || selected[file.path] !== before)) {
      throw new Error(`Select this existing file with --file before editing: ${file.path}`);
    }
    if (before !== file.content) files.push({ path: file.path, before, content: file.content });
  }
  if (!files.length) throw new Error('No changes proposed.');
  return { version: 1, id: randomUUID(), summary: output.summary, files };
}

/** Internal storage must never follow a user-created symlink. */
async function storage(root) {
  const dir = path.join(root, '.vibepatch');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if ((await fs.lstat(dir)).isSymbolicLink()) throw new Error('Unsafe .vibepatch directory.');
  return dir;
}

export async function savePlan(root, plan) {
  const dir = await storage(root);
  const name = path.join(dir, 'pending.json');
  // Unlink a prior directory entry rather than following a symlink/hard link.
  try { await fs.unlink(name); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.writeFile(name, JSON.stringify(plan, null, 2), { flag: 'wx', mode: 0o600 });
}

export async function loadPlan(root) {
  const dir = await storage(root);
  const name = path.join(dir, 'pending.json');
  const stat = await fs.lstat(name);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 3_000_000) throw new Error('Invalid pending plan.');
  const plan = JSON.parse(await fs.readFile(name, 'utf8'));
  if (plan.version !== 1 || typeof plan.id !== 'string' || !/^[a-f0-9-]{36}$/.test(plan.id)
    || typeof plan.summary !== 'string' || !Array.isArray(plan.files) || !plan.files.length || plan.files.length > 20) throw new Error('Invalid pending plan.');
  const seen = new Set();
  for (const file of plan.files) {
    validatePath(file.path);
    if (typeof file.content !== 'string' || !(file.before === null || typeof file.before === 'string') || seen.has(file.path.toLowerCase())) throw new Error('Invalid pending file.');
    seen.add(file.path.toLowerCase());
  }
  return plan;
}

export function preview(plan) {
  let text = `${clean(plan.summary)}\n`;
  for (const file of plan.files) {
    text += `\n--- ${file.before === null ? '/dev/null' : file.path}\n+++ ${file.path}\n`;
    // Whole-file comparison: intentionally simple; exact before/after content.
    if (file.before !== null) text += file.before.split('\n').map(line => '-' + clean(line)).join('\n') + '\n';
    text += file.content.split('\n').map(line => '+' + clean(line)).join('\n') + '\n';
  }
  return text;
}

export async function apply(root, plan) {
  // Preflight every file before the first write.
  for (const file of plan.files) {
    if (await read(root, file.path) !== file.before) throw new Error(`File changed since proposal: ${file.path}`);
  }
  const dir = await storage(root);
  const journal = path.join(dir, `${plan.id}.json`);
  await fs.writeFile(journal, JSON.stringify(plan), { flag: 'wx', mode: 0o600 });
  const written = [];
  try {
    for (const file of plan.files) {
      const filename = await target(root, file.path);
      await fs.mkdir(path.dirname(filename), { recursive: true });
      if (await read(root, file.path) !== file.before) throw new Error('Concurrent file change detected.');
      if (file.before === null) await fs.writeFile(filename, file.content, { flag: 'wx' });
      else await fs.writeFile(filename, file.content);
      written.push(file);
    }
  } catch (error) {
    // Best-effort recovery; journal retains original text even on I/O failure.
    for (const file of written.reverse()) {
      try {
        const filename = await target(root, file.path);
        if (file.before === null) await fs.unlink(filename);
        else await fs.writeFile(filename, file.before);
      } catch { /* Keep the journal for manual recovery. */ }
    }
    throw error;
  }
  return plan.id;
}

export async function undo(root, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid backup ID.');
  const dir = await storage(root);
  const filename = path.join(dir, `${id}.json`);
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 3_000_000) throw new Error('Invalid backup.');
  const plan = JSON.parse(await fs.readFile(filename, 'utf8'));
  if (!Array.isArray(plan.files)) throw new Error('Invalid backup.');
  for (const file of plan.files) {
    if (await read(root, file.path) !== file.content) throw new Error(`Refusing undo: file changed: ${file.path}`);
    if (!(file.before === null || typeof file.before === 'string')) throw new Error('Invalid backup content.');
  }
  for (const file of plan.files) {
    const name = await target(root, file.path);
    if (file.before === null) await fs.unlink(name);
    else await fs.writeFile(name, file.before);
  }
}
