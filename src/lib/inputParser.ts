import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Parameter } from '@uselamina/sdk';

import { EXIT, LaminaCliError } from './errors.js';

/**
 * Parse a `--input <key>=<value>` value.
 *
 * The CLI is a thin wrapper over the same agent surface the MCP server uses,
 * so we keep value coercion conservative: `true`/`false`/`null` and bare JSON
 * literals (`{...}`, `[...]`, `"..."`) are decoded; everything else is passed
 * through as a string. Coercing bare numbers (e.g. `"123"` → `123`) would
 * change the wire shape for text params and cause `invalid_type` errors at
 * the server, so we don't.
 */
function parseValue(raw: string): unknown {
  const trimmed = raw.trim();

  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;

  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return raw;
    }
  }

  return raw;
}

export function parseInlineInputs(entries: string[] = []): Record<string, unknown> {
  return entries.reduce<Record<string, unknown>>((acc, entry) => {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0) {
      throw new LaminaCliError({
        code: 'invalid_argument',
        exitCode: EXIT.INVALID_USAGE,
        message: `Invalid --input value "${entry}". Expected key=value.`,
        suggestion: 'Example: --input celebrity_text="Brad Pitt"',
      });
    }

    const key = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1);
    if (!key) {
      throw new LaminaCliError({
        code: 'invalid_argument',
        exitCode: EXIT.INVALID_USAGE,
        message: `Invalid --input value "${entry}". Expected a non-empty key.`,
      });
    }

    acc[key] = parseValue(value);
    return acc;
  }, {});
}

export async function loadInputsFromFile(filePath: string): Promise<Record<string, unknown>> {
  const raw = await readFile(resolve(filePath), 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: `Could not parse ${filePath}: ${(err as Error).message}`,
      suggestion: 'The file must be valid JSON: { "key1": "value1", ... }',
    });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: `${filePath} must contain a JSON object.`,
      suggestion:
        'Either { "key1": "value1", ... } or { "inputs": { "key1": "value1", ... } }.',
    });
  }

  const maybeInputs = parsed as Record<string, unknown>;
  if (
    'inputs' in maybeInputs &&
    maybeInputs.inputs &&
    typeof maybeInputs.inputs === 'object' &&
    !Array.isArray(maybeInputs.inputs)
  ) {
    return maybeInputs.inputs as Record<string, unknown>;
  }

  return maybeInputs;
}

interface InputError {
  param: string;
  code: 'unknown_parameter' | 'missing_no_default' | 'invalid_option' | 'invalid_type' | 'invalid_media';
  message: string;
}

/**
 * Validate caller-supplied inputs against the app's parameter schema.
 *
 * Mirrors the server-side `resolveAgentInputs` resolver (which is what the
 * REST/MCP surfaces both call) so the CLI gives the same answers the server
 * would, just earlier and without a round trip:
 *
 *   - Lookup is `key`-first (snake_case), then `name`, then `id`.
 *   - **Default-presence is the must-supply signal, not `parameter.required`.**
 *     Workflow authors set `required` inconsistently; what matters is whether
 *     the workflow can run without a value. If the author saved any default
 *     (incl. `""` / `[]`), the workflow handles "blank" natively.
 *   - Errors collect into a structured list and surface as one CLI error so
 *     the user sees every problem at once instead of fixing them one at a time.
 */
export function validateInputsAgainstSchema(
  inputs: Record<string, unknown>,
  parameters: Parameter[]
): void {
  const byKey = new Map<string, Parameter>();
  const byName = new Map<string, Parameter>();
  const byId = new Map<string, Parameter>();
  for (const p of parameters) {
    if (p.key) byKey.set(p.key, p);
    if (p.name) byName.set(p.name, p);
    if (p.id) byId.set(p.id, p);
  }

  const errors: InputError[] = [];
  const matched = new Set<string>();

  for (const [suppliedKey, value] of Object.entries(inputs)) {
    const param = byKey.get(suppliedKey) || byId.get(suppliedKey) || byName.get(suppliedKey);
    if (!param) {
      errors.push({
        param: suppliedKey,
        code: 'unknown_parameter',
        message: `Unknown input "${suppliedKey}".`,
      });
      continue;
    }
    matched.add(param.id || param.key || param.name);

    if (param.type === 'options' && Array.isArray(param.options)) {
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        if (typeof item !== 'string' || !param.options.includes(item)) {
          errors.push({
            param: param.key || param.name,
            code: 'invalid_option',
            message: `"${param.key || param.name}" must be one of: ${param.options.join(', ')}.`,
          });
        }
      }
    } else if (param.type === 'url') {
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        if (typeof item !== 'string' || !/^https?:\/\//.test(item)) {
          errors.push({
            param: param.key || param.name,
            code: 'invalid_media',
            message: `"${param.key || param.name}" must be an http(s) URL.`,
          });
        }
      }
    } else {
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        errors.push({
          param: param.key || param.name,
          code: 'invalid_type',
          message: `"${param.key || param.name}" expected a text value.`,
        });
      }
    }
  }

  // Default-presence check: any param without a saved default and without a
  // supplied value is missing. `""`, `[]`, `0`, and `false` count as defaults.
  for (const p of parameters) {
    const ident = p.id || p.key || p.name;
    if (matched.has(ident)) continue;
    const hasDefault = p.default !== undefined && p.default !== null;
    if (hasDefault) continue;
    errors.push({
      param: p.key || p.name,
      code: 'missing_no_default',
      message: `"${p.key || p.name}" has no default and was not supplied.`,
    });
  }

  if (errors.length === 0) return;

  const lines = errors.map((e) => `  - [${e.code}] ${e.message}`).join('\n');
  throw new LaminaCliError({
    code: 'invalid_argument',
    exitCode: EXIT.INVALID_USAGE,
    message: `Invalid inputs:\n${lines}`,
    suggestion: 'Run `lamina apps get <appId>` to see valid keys and defaults.',
  });
}
