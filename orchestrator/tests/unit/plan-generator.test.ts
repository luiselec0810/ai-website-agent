/**
 * Tests del Plan Generator.
 * SRS §20 — extrae Change Plans del content del LLM.
 */

import { describe, it, expect } from 'vitest';
import { extractChangePlan } from './_plan-helper.js';

describe('Plan Generator — extractChangePlan', () => {
  it('extracts a JSON plan from a markdown fence', () => {
    const content = `Aquí va el plan:

\`\`\`json
{
  "title": "Cambiar título",
  "description": "Modifica el heading principal",
  "operations": [
    { "tool": "update_widget", "arguments": { "page_id": 12, "element_id": "abc", "settings": { "title": "Nuevo" } } }
  ]
}
\`\`\`

Espero tu aprobación.`;

    const plan = extractChangePlan(content);
    expect(plan).not.toBeNull();
    expect(plan?.title).toBe('Cambiar título');
    expect(plan?.operations).toHaveLength(1);
    expect(plan?.operations[0].tool).toBe('update_widget');
  });

  it('extracts a JSON plan without language hint', () => {
    const content = `\`\`\`
{"title":"Test","description":"x","operations":[]}
\`\`\``;
    const plan = extractChangePlan(content);
    expect(plan).not.toBeNull();
  });

  it('returns null for non-plan content', () => {
    const content = 'Hola, ¿en qué puedo ayudarte?';
    const plan = extractChangePlan(content);
    expect(plan).toBeNull();
  });

  it('returns null when JSON is malformed', () => {
    const content = '```json\n{ "title": "Test"\n```';
    const plan = extractChangePlan(content);
    expect(plan).toBeNull();
  });
});
