/**
 * `lamina init` — install all Lamina skills into the cwd.
 *
 * Discovers every skill directory under the CLI's bundled `dist/skills/`
 * tree and copies each into `.claude/skills/<skill-name>/` so AI coding
 * agents (Claude Code, Cursor, custom MCP clients) auto-load them on
 * session start. Idempotent — re-running without `--force` is a no-op
 * for already-installed skills; with `--force`, all skills are
 * refreshed.
 *
 * Why skills ship inside this npm package: each CLI release carries the
 * canonical skill content as `dist/skills/<name>/SKILL.md`. The package
 * version IS the skill version. To update skills in a project, the user:
 *
 *   npm install -g @uselamina/cli@latest && lamina init --force
 *
 * Layout when installed:
 *   <package-root>/dist/skills/
 *       lamina/SKILL.md            ← core / foundational
 *       lamina-models/SKILL.md     ← atomic dispatch
 *       lamina-apps/SKILL.md       ← curated workflows
 *       lamina-content/SKILL.md    ← agentic routing
 *       lamina-intelligence/SKILL.md ← brand DNA / predictions
 *
 * Claude Code's skill loader reads `.claude/skills/<name>/SKILL.md`
 * regardless of vendor; same convention as `genmedia init`
 * (fal-ai-community/genmedia-cli) which pioneered this pattern.
 */
import { readFile, mkdir, copyFile, readdir, stat, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXIT, LaminaCliError } from '../lib/errors.js';
import { detectJsonModeFromArgs, isJsonMode } from '../lib/outputMode.js';
import { printJson } from '../lib/output.js';

const HELP = `Usage: lamina init [--force] [--json]

Install every Lamina skill into this project's \`.claude/skills/\`
directory. AI coding agents (Claude Code, Cursor, custom MCP clients)
auto-load these on session start, so a fresh agent knows how to use
Lamina's apps, brand intelligence, atomic models, and run commands
without any further setup.

Skills installed:
  lamina               foundational rules + command index (always loaded)
  lamina-models        atomic model-pinned generate image / video
  lamina-apps          curated app discovery + execution
  lamina-content       agentic routing from natural-language briefs
  lamina-intelligence  brand DNA, predictions, recommendations, trends

Run this once per project. Re-run with \`--force\` after a CLI update
to refresh skill content.

Options:
  --force   Reinstall every skill, overwriting existing copies.
  --json    Emit a structured JSON result (for agents / scripts).
  --help, -h
`;

interface InstalledSkill {
  name: string;
  version: string;
  path: string;
  installed: boolean;
  alreadyInstalled: boolean;
}

interface InitResult {
  ok: true;
  skills: InstalledSkill[];
  forced: boolean;
  cwd: string;
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
 * The CLI's bundled skills root inside the installed npm package.
 * Layout: <package-root>/dist/skills/<skill-name>/SKILL.md
 * This file lives at <package-root>/dist/commands/init.js — walk up
 * one level, then into `skills/`.
 */
function resolveSkillsRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', 'skills');
}

/**
 * Enumerate every direct child directory of `dist/skills/` that has a
 * SKILL.md. Each becomes one installable skill.
 */
async function discoverBundledSkills(skillsRoot: string): Promise<string[]> {
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await pathExists(join(skillsRoot, entry.name, 'SKILL.md'))) {
      out.push(entry.name);
    }
  }
  return out.sort();
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
  const skillsRoot = resolveSkillsRoot();

  // Sanity-check: the bundled skills root must exist. If not, the build
  // pipeline didn't copy `skills/` into `dist/skills/`.
  if (!(await pathExists(skillsRoot))) {
    throw new LaminaCliError({
      code: 'unknown',
      exitCode: EXIT.RUNTIME_ERROR,
      message: 'Lamina skill content is missing from this CLI install.',
      suggestion:
        'This is a packaging issue, not your fault. Reinstall the CLI: `npm install -g @uselamina/cli@latest`. If it persists, please file an issue.',
    });
  }

  const bundledSkills = await discoverBundledSkills(skillsRoot);
  if (bundledSkills.length === 0) {
    throw new LaminaCliError({
      code: 'unknown',
      exitCode: EXIT.RUNTIME_ERROR,
      message: 'No Lamina skills found inside this CLI install.',
      suggestion:
        'Reinstall: `npm install -g @uselamina/cli@latest`. If this persists, file an issue.',
    });
  }

  const installed: InstalledSkill[] = [];
  for (const skillName of bundledSkills) {
    const src = join(skillsRoot, skillName);
    const dst = join(cwd, '.claude', 'skills', skillName);
    const version = await readSkillVersion(src);
    const already = await pathExists(dst);

    if (already && !force) {
      installed.push({
        name: skillName,
        version,
        path: relative(cwd, dst) || dst,
        installed: false,
        alreadyInstalled: true,
      });
      continue;
    }

    // When --force, wipe the destination first so removed files don't linger.
    if (already && force) {
      await rm(dst, { recursive: true, force: true });
    }
    await copyTree(src, dst);
    installed.push({
      name: skillName,
      version,
      path: relative(cwd, dst) || dst,
      installed: true,
      alreadyInstalled: already,
    });
  }

  const result: InitResult = { ok: true, skills: installed, forced: force, cwd };

  if (isJsonMode()) {
    printJson(result);
    return;
  }

  const freshlyInstalled = installed.filter((s) => s.installed);
  const skipped = installed.filter((s) => !s.installed);

  if (freshlyInstalled.length > 0) {
    process.stdout.write(`✓ Installed ${freshlyInstalled.length} Lamina skill(s) into .claude/skills/:\n`);
    for (const s of freshlyInstalled) {
      process.stdout.write(`    ${s.name}@${s.version}\n`);
    }
  }
  if (skipped.length > 0) {
    process.stdout.write(
      `\n${skipped.length} skill(s) already installed (use --force to refresh):\n`,
    );
    for (const s of skipped) {
      process.stdout.write(`    ${s.name}@${s.version}\n`);
    }
  }
  if (freshlyInstalled.length > 0) {
    process.stdout.write(
      `\nClaude Code, Cursor, and other agent-aware editors will auto-load these on\n` +
        `session start. No further setup needed.\n`,
    );
  }
}
