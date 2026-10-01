import { copyFile, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const themeFiles = ['harpy-noct.json', 'harpy-insone.json'];

export async function copyThemes(destination = join(homedir(), '.pi', 'agent', 'themes')) {
  await mkdir(destination, { recursive: true });
  const staging = await mkdtemp(join(destination, '.harpy-copy-'));
  try {
    for (const name of themeFiles) {
      await copyFile(new URL(`../themes/${name}`, import.meta.url), join(staging, name));
    }
    for (const name of themeFiles) {
      await rename(join(staging, name), join(destination, name));
    }
    return themeFiles.map((name) => join(destination, name));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const copied = await copyThemes();
  copied.forEach((file) => console.log(`Copied ${file}`));
}
