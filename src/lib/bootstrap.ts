/**
 * Bootstrap-discoverability helpers.
 *
 * Detect whether the current project has the Lamina skill installed at
 * `<cwd>/.claude/skills/lamina/SKILL.md` (or globally at
 * `~/.claude/skills/lamina/SKILL.md`). When it doesn't, commands print
 * a one-line footer suggesting `lamina init`. This closes the
 * bootstrap-discoverability gap — even an agent that didn't think to
 * run `lamina --help` first gets nudged toward the skill on its first
 * data command in the project.
 *
 * Quiet by design:
 *   - Suppressed when stdout is not a TTY AND --json is in effect
 *     (don't pollute machine-readable output)
 *   - Suppressed when the skill IS installed (no false alarms)
 *   - Single-line, dim styling so it doesn't compete with primary output
 */
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { isJsonMode } from './outputMode.js';

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function skillInstalledLocally(): Promise<boolean> {
  const cwdPath = join(process.cwd(), '.claude', 'skills', 'lamina', 'SKILL.md');
  const homePath = join(homedir(), '.claude', 'skills', 'lamina', 'SKILL.md');
  return (await exists(cwdPath)) || (await exists(homePath));
}

/**
 * Print a single-line tip on stdout when the skill is missing. No-op if:
 *   - the skill IS installed
 *   - --json mode is active (don't pollute structured output)
 *   - LAMINA_NO_TIPS=1 in the environment (escape hatch for power users)
 */
export async function maybePrintBootstrapHint(): Promise<void> {
  if (isJsonMode()) return;
  if (process.env.LAMINA_NO_TIPS === '1') return;
  if (await skillInstalledLocally()) return;
  process.stdout.write(
    `\n(tip) Run \`lamina init\` once in this project so AI coding agents auto-load the Lamina skill. Set LAMINA_NO_TIPS=1 to silence.\n`,
  );
}
