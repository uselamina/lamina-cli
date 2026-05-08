/**
 * Module-level flag tracking whether the current invocation was called with
 * `--json`. Set by command handlers (and the top-level dispatcher) the
 * moment they parse their args; read by `printCliError()` so error output
 * matches the success-output format the agent expects.
 *
 * Why module-level: the alternative is plumbing a flag through every
 * command's call stack down to the error formatter. That touches every file
 * for the same one-bit of state. A module-level boolean is fine here
 * because the CLI process handles exactly one invocation at a time.
 */
let jsonMode = false;

export function setJsonMode(on: boolean): void {
  jsonMode = on;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

/**
 * Helper for handlers: if any of their args is `--json`, switch on JSON mode.
 * Idempotent and safe to call from anywhere.
 */
export function detectJsonModeFromArgs(args: readonly string[]): void {
  if (args.includes('--json')) {
    jsonMode = true;
  }
}
