import { writeFileSync } from 'node:fs';
import { jsonSchema } from '../packages/adapters/src/providers.ts';
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Gebal external agent review',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'snapshotHash', 'contextHash', 'review'],
  properties: {
    schemaVersion: { const: 1 },
    snapshotHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    contextHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    review: jsonSchema,
  },
};
writeFileSync('agents/response.schema.json', JSON.stringify(schema, null, 2) + '\n');
