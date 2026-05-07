/**
 * Interactive prompts for the Lamina CLI.
 *
 * Uses `@clack/prompts` — a vetted, well-maintained library that handles
 * masked input, terminal resize, paste, signal forwarding, and graceful
 * cancellation across macOS / Linux / Windows. Replaces the earlier
 * hand-rolled keypress implementation.
 */
import { isCancel, password as clackPassword } from '@clack/prompts';

import { EXIT, LaminaCliError } from './errors.js';

/**
 * Prompt for a Lamina API key in a masked input. Returns the trimmed key.
 * Throws `LaminaCliError` if the user cancels (Ctrl+C) or enters an empty
 * value.
 */
export async function promptApiKey(): Promise<string> {
  const value = await clackPassword({
    message: 'Paste your Lamina API key (or press Ctrl+C to cancel)',
    validate: (input) => {
      const trimmed = (input ?? '').trim();
      if (!trimmed) return 'API key cannot be empty.';
      return undefined;
    },
  });

  if (isCancel(value)) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: 'Login cancelled.',
    });
  }

  return value.trim();
}
