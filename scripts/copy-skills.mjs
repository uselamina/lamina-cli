// Copy skills/ → dist/skills/ at build time so `lamina init` can read the
// SKILL.md from inside the published npm package. tsc only emits .js, so
// without this step the .md files never make it into dist.
import { mkdir, readdir, copyFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'skills');
const DST = join(here, '..', 'dist', 'skills');

async function copyTree(src, dst) {
  await mkdir(dst, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyTree(s, d);
    } else {
      await copyFile(s, d);
    }
  }
}

try {
  await stat(SRC);
} catch {
  console.error(`copy-skills: source directory ${SRC} not found`);
  process.exit(1);
}
await copyTree(SRC, DST);
console.log(`copy-skills: copied ${SRC} → ${DST}`);
