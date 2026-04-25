import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Parameter } from '@uselamina/sdk';

function parseValue(raw: string): unknown {
  const trimmed = raw.trim();

  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

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
      throw new Error(`Invalid --input value "${entry}". Expected key=value.`);
    }

    const key = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1);
    if (!key) {
      throw new Error(`Invalid --input value "${entry}". Expected a non-empty key.`);
    }

    acc[key] = parseValue(value);
    return acc;
  }, {});
}

export async function loadInputsFromFile(filePath: string): Promise<Record<string, unknown>> {
  const raw = await readFile(resolve(filePath), 'utf8');
  const parsed = JSON.parse(raw) as unknown;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Input file must contain a JSON object.');
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

export function validateInputsAgainstSchema(
  inputs: Record<string, unknown>,
  parameters: Parameter[]
): void {
  const knownNames = new Map(parameters.map((parameter) => [parameter.name, parameter]));

  for (const key of Object.keys(inputs)) {
    if (!knownNames.has(key)) {
      throw new Error(`Unknown input "${key}". Fetch the app schema and use exact parameter names.`);
    }
  }

  for (const parameter of parameters) {
    const hasValue = Object.prototype.hasOwnProperty.call(inputs, parameter.name);
    const hasDefault = parameter.default !== undefined;

    if (parameter.required && !hasValue && !hasDefault) {
      throw new Error(`Missing required input "${parameter.name}".`);
    }

    if (!hasValue) {
      continue;
    }

    const value = inputs[parameter.name];

    if (parameter.type === 'options' && Array.isArray(parameter.options)) {
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        if (typeof item !== 'string' || !parameter.options.includes(item)) {
          throw new Error(
            `Invalid option for "${parameter.name}". Expected one of: ${parameter.options.join(', ')}.`
          );
        }
      }
    }

    if (parameter.type === 'url') {
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        if (typeof item !== 'string' || !/^https?:\/\//.test(item)) {
          throw new Error(`Input "${parameter.name}" must be an http or https URL.`);
        }
      }
    }
  }
}
