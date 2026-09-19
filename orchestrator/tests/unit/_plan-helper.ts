/**
 * Helper: expone la función interna `extractChangePlan` para tests.
 *
 * Como extractChangePlan es interno a plan-generator.ts, este helper
 * lo reimplementa para validar el patrón de parsing.
 */

export function extractChangePlan(content: string): { title: string; description: string; operations: Array<{ tool: string; arguments: Record<string, unknown> }> } | null {
  const fenceMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenceMatch && fenceMatch[1]) {
    return tryParse(fenceMatch[1]);
  }

  const jsonStart = content.indexOf('{');
  if (jsonStart >= 0) {
    const slice = content.slice(jsonStart);
    if (slice.includes('"operations"') || slice.includes("'operations'")) {
      const jsonEnd = findBalancedJson(slice);
      if (jsonEnd > 0) {
        return tryParse(slice.slice(0, jsonEnd));
      }
    }
  }

  return null;
}

function tryParse(json: string): { title: string; description: string; operations: Array<{ tool: string; arguments: Record<string, unknown> }> } | null {
  try {
    const parsed = JSON.parse(json);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.title === 'string' &&
      Array.isArray(parsed.operations)
    ) {
      return {
        title: parsed.title,
        description: parsed.description ?? '',
        operations: parsed.operations.map((op: { tool?: string; arguments?: Record<string, unknown> }) => ({
          tool: op.tool ?? '',
          arguments: op.arguments ?? {},
        })),
      };
    }
  } catch {
    // ignore
  }
  return null;
}

function findBalancedJson(s: string): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\') {
      escape = true;
      continue;
    }
    if (c === '"' && !escape) {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}
