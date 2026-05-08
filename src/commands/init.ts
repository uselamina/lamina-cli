/**
 * `lamina init` — install the Lamina foundational skill into the cwd.
 *
 * Drops `.claude/skills/lamina/SKILL.md` (and any reference files) into the
 * current project so AI coding agents (Claude Code, Cursor, etc.) auto-load
 * Lamina's operating instructions on session start. Idempotent — second
 * invocation is a no-op unless `--force` is passed.
 *
 * Why the skill ships inside this npm package: each CLI release carries the
 * canonical skill content as `dist/skills/lamina/SKILL.md`. The package
 * version IS the skill version. To update the skill in a project, the user
 * `npm install -g @uselamina/cli@latest && lamina init --force`.
 *
 * Pattern modeled on `genmedia init` (fal-ai-community/genmedia-cli) which
 * pioneered this convention. Claude Code's skill loader reads
 * `.claude/skills/<name>/SKILL.md` regardless of vendor.
 */
import { readFile, mkdir, copyFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXIT, LaminaCliError } from '../lib/errors.js';
import { detectJsonModeFromArgs, isJsonMode } from '../lib/outputMode.js';
import { printJson } from '../lib/output.js';

const HELP = `Usage: lamina init [--force] [--json]

Install the Lamina foundational skill into this project's
\`.claude/skills/lamina/\` directory. AI coding agents (Claude Code, Cursor,
custom MCP clients) auto-load these on session start, so a fresh agent
in this project knows how to use Lamina's apps, brand intelligence,
and run commands without any further setup.

Run this once per project. Re-run with \`--force\` after a CLI update to
refresh the skill content.

Options:
  --force   Reinstall even if the skill is already present.
  --json    Emit a structured JSON result (for agents / scripts).
  --help, -h
`;

interface InitResult {
  ok: true;
  installed: boolean;
  alreadyInstalled?: boolean;
  path: string;
  skill: string;
  message?: string;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function copyTree(src: string, dst: string): Promise<void> {
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

/**
 * Find the skill source directory inside the published npm package.
 * Layout when installed: <package-root>/dist/skills/lamina/
 * This file is at <package-root>/dist/commands/init.js, so we walk up two
 * levels to the package root, then into dist/skills/lamina/.
 */
function resolveSkillSource(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // here = .../dist/commands; package root = ../..; skills = ../skills/lamina
  return resolve(here, '..', 'skills', 'lamina');
}

async function readSkillVersion(skillSrc: string): Promise<string> {
  try {
    const content = await readFile(join(skillSrc, 'SKILL.md'), 'utf8');
    const match = content.match(/^\s*version:\s*"?([^"\n]+)"?\s*$/m);
    return match?.[1]?.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function handleInitCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  detectJsonModeFromArgs(args);

  const force = args.includes('--force');
  const cwd = process.cwd();
  const skillSrc = resolveSkillSource();
  const skillDst = join(cwd, '.claude', 'skills', 'lamina');
  const skillVersion = await readSkillVersion(skillSrc);
  const skillId = `lamina@${skillVersion}`;

  // Sanity-check the source exists. If not, the build pipeline didn't copy
  // skills/ into dist/. Report a clear, actionable error.
  if (!(await pathExists(join(skillSrc, 'SKILL.md')))) {
    throw new LaminaCliError({
      code: 'unknown',
      exitCode: EXIT.RUNTIME_ERROR,
      message: 'Lamina skill content is missing from this CLI install.',
      suggestion:
        'This is a packaging issue, not your fault. Reinstall the CLI: `npm install -g @uselamina/cli@latest`. If it persists, please file an issue.',
    });
  }

  const alreadyInstalled = await pathExists(skillDst);
  if (alreadyInstalled && !force) {
    const result: InitResult = {
      ok: true,
      installed: false,
      alreadyInstalled: true,
      path: relative(cwd, skillDst) || skillDst,
      skill: skillId,
      message: 'Skill already installed. Use --force to reinstall.',
    };
    if (isJsonMode()) {
      printJson(result);
      return;
    }
    process.stdout.write(`Lamina skill already installed at ${result.path}\n`);
    process.stdout.write(`(${skillId}) — re-run with --force to refresh.\n`);
    return;
  }

  await copyTree(skillSrc, skillDst);

  const result: InitResult = {
    ok: true,
    installed: true,
    path: relative(cwd, skillDst) || skillDst,
    skill: skillId,
  };

  if (isJsonMode()) {
    printJson(result);
    return;
  }

  process.stdout.write(`✓ Installed Lamina skill (${skillId}) at ${result.path}\n`);
  process.stdout.write(
    `Claude Code, Cursor, and other agent-aware editors will auto-load it on\n`,
  );
  process.stdout.write(`session start. No further setup needed.\n`);
}
