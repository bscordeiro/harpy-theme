import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { copyThemes } from '../scripts/copy-to-themes.mjs';

const themeFiles = ['harpy-noct.json', 'harpy-insone.json'];
const script = fileURLToPath(new URL('../scripts/copy-to-themes.mjs', import.meta.url));

async function sandbox(t) {
  const directory = await mkdtemp(join(tmpdir(), 'harpy-copy-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('creates the destination and copies both bundled themes byte-for-byte', async (t) => {
  const directory = await sandbox(t);
  const destination = join(directory, '.pi', 'agent', 'themes');
  assert.deepEqual(await copyThemes(destination), themeFiles.map((name) => join(destination, name)));
  for (const name of themeFiles) {
    const expected = await readFile(new URL(`../themes/${name}`, import.meta.url));
    assert.deepEqual(await readFile(join(destination, name)), expected);
  }
});

test('refreshes existing Harpy files without changing other themes or leaving staging files', async (t) => {
  const destination = await sandbox(t);
  for (const name of themeFiles) await writeFile(join(destination, name), 'outdated');
  await writeFile(join(destination, 'other-theme.json'), 'keep unchanged');
  await copyThemes(destination);
  for (const name of themeFiles) {
    const expected = await readFile(new URL(`../themes/${name}`, import.meta.url));
    assert.deepEqual(await readFile(join(destination, name)), expected);
  }
  assert.equal(await readFile(join(destination, 'other-theme.json'), 'utf8'), 'keep unchanged');
  assert.deepEqual((await readdir(destination)).sort(), [...themeFiles, 'other-theme.json'].sort());
});

test('replaces a destination symlink without overwriting its target outside the theme directory', async (t) => {
  const directory = await sandbox(t);
  const destination = join(directory, 'themes');
  await mkdir(destination);
  const unrelated = join(directory, 'unrelated.json');
  await writeFile(unrelated, 'keep unchanged');
  await symlink(unrelated, join(destination, 'harpy-noct.json'));
  await copyThemes(destination);
  assert.equal(await readFile(unrelated, 'utf8'), 'keep unchanged');
  const expected = await readFile(new URL('../themes/harpy-noct.json', import.meta.url));
  assert.deepEqual(await readFile(join(destination, 'harpy-noct.json')), expected);
});

test('cleans staging files when a destination file cannot be replaced', async (t) => {
  const destination = await sandbox(t);
  await mkdir(join(destination, 'harpy-insone.json'));
  await writeFile(join(destination, 'harpy-insone.json', 'keep.txt'), 'keep unchanged');
  await assert.rejects(copyThemes(destination), /EISDIR|ENOTEMPTY|EEXIST/);
  assert.deepEqual((await readdir(destination)).sort(), [...themeFiles].sort());
  assert.equal(await readFile(join(destination, 'harpy-insone.json', 'keep.txt'), 'utf8'), 'keep unchanged');
});

test('CLI uses the user theme directory and resolves sources independently of the working directory', async (t) => {
  const directory = await sandbox(t);
  const result = spawnSync(process.execPath, [script], {
    cwd: directory,
    env: { ...process.env, HOME: directory, USERPROFILE: directory },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  for (const name of themeFiles) {
    const destination = join(directory, '.pi', 'agent', 'themes', name);
    assert.ok(result.stdout.includes(`Copied ${destination}`));
    const expected = await readFile(new URL(`../themes/${name}`, import.meta.url));
    assert.deepEqual(await readFile(destination), expected);
  }
});

test('CLI reports failure when the theme destination is not a directory', async (t) => {
  const directory = await sandbox(t);
  const agent = join(directory, '.pi', 'agent');
  await mkdir(agent, { recursive: true });
  await writeFile(join(agent, 'themes'), 'keep unchanged');
  const result = spawnSync(process.execPath, [script], {
    cwd: directory,
    env: { ...process.env, HOME: directory, USERPROFILE: directory },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EEXIST|ENOTDIR/);
  assert.equal(result.stdout, '');
  assert.equal(await readFile(join(agent, 'themes'), 'utf8'), 'keep unchanged');
});
