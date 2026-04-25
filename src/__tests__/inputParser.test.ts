import test from 'node:test';
import assert from 'node:assert/strict';

import { parseInlineInputs, validateInputsAgainstSchema } from '../lib/inputParser.js';

test('parseInlineInputs parses key value pairs and simple scalars', () => {
  const parsed = parseInlineInputs([
    'Front=https://example.com/front.jpg',
    'Enabled=true',
    'Count=3',
  ]);

  assert.deepEqual(parsed, {
    Front: 'https://example.com/front.jpg',
    Enabled: true,
    Count: 3,
  });
});

test('validateInputsAgainstSchema rejects unknown keys', () => {
  assert.throws(() =>
    validateInputsAgainstSchema(
      { Unknown: 'value' },
      [{ id: '1', name: 'Front', type: 'url', required: true }]
    )
  );
});
