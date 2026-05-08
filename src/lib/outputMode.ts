/**
 * Output mode resolution: pretty text (humans) vs structured JSON (agents).
 *
 * Resolution chain (highest priority first):
 *   1. Explicit `--json` flag in command args  → JSON
 *   2. Explicit `--output <mode>` flag         → text | json | auto
 *   3. LAMINA_OUTPUT env var                   → text | json | auto
 *   4. `auto` mode (the default):
 *        - stdout is a TTY  → text (humans)
 *        - stdout is piped  → JSON (agents)
 *
 * The auto-default-to-JSON-when-piped behavior is what fal does and what
 * makes the CLI agent-first by default — agents pipe everything through
 * `jq` or their own parser and get structured data without typing
 * `--json`. Humans in a terminal still see a pretty table.
 *
 * Why a module-level flag: the alternative is plumbing this through every
 * command's call stack. Single state per process is fine because the CLI
 * handles exactly one invocation per process.
 */
let explicitlySet = false;
let jsonMode = false;

function envMode(): 'text' | 'json' | 'auto' | undefined {
  const v = (process.env.LAMINA_OUTPUT || '').toLowerCase().trim();
  if (v === 'text' || v === 'json' || v === 'auto') return v;
  return undefined;
}

function resolveMode(): boolean {
  // Default behavior: auto. Pretty in TTY, JSON when piped.
  return !process.stdout.isTTY;
}

function applyEnvOrAuto(): void {
  const env = envMode();
  if (env === 'json') {
    jsonMode = true;
  } else if (env === 'text') {
    jsonMode = false;
  } else {
    // 'auto' or unset → resolve from TTY
    jsonMode = resolveMode();
  }
}

// Initialize once at module load. If a flag (--json, --output) is later
// detected by a command, it OVERRIDES this initial value.
applyEnvOrAuto();

export function setJsonMode(on: boolean): void {
  jsonMode = on;
  explicitlySet = true;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

/**
 * Helper for handlers: scan args for output-mode flags.
 *   --json                → force JSON
 *   --output text|json|auto → explicit mode
 * Returns true if an explicit flag was found (so the caller knows the
 * user/agent expressed an intent vs. relying on auto-detection).
 */
export function detectJsonModeFromArgs(args: readonly string[]): boolean {
  // --json (boolean) takes precedence (legacy + simple)
  if (args.includes('--json')) {
    setJsonMode(true);
    return true;
  }
  // --output <mode> or --output=<mode>
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--output') {
      const next = args[i + 1];
      if (next === 'json') {
        setJsonMode(true);
        return true;
      }
      if (next === 'text') {
        setJsonMode(false);
        return true;
      }
      if (next === 'auto') {
        applyEnvOrAuto();
        explicitlySet = true;
        return true;
      }
    } else if (a.startsWith('--output=')) {
      const v = a.slice('--output='.length);
      if (v === 'json') {
        setJsonMode(true);
        return true;
      }
      if (v === 'text') {
        setJsonMode(false);
        return true;
      }
      if (v === 'auto') {
        applyEnvOrAuto();
        explicitlySet = true;
        return true;
      }
    }
  }
  // No explicit flag — keep whatever the env/auto resolution gave us.
  return false;
}

export function wasExplicitlySet(): boolean {
  return explicitlySet;
}
