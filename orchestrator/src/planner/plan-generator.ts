/**
 * Plan Generator.
 *
 * Recibe un mensaje del usuario y decide si necesita generar un Change Plan
 * (para instrucciones complejas) o responder directamente con tool calls
 * (para preguntas/lecturas).
 */

import { getLlmProvider } from '../llm/factory.js';
import { getToolsForLLM } from '../tools/index.js';
import { SYSTEM_PROMPT } from './system-prompt.js';
import { formatInventoryForPrompt } from './inventory-formatter.js';
import type { SiteInventory } from '../context/site-inventory.js';
import type { LlmMessage, ToolCall } from '../llm/provider.js';
import { logger } from '../logger.js';

export interface Operation {
  tool: string;
  arguments: Record<string, unknown>;
}

export interface ChangePlan {
  title: string;
  description: string;
  operations: Operation[];
}

export type AgentResult =
  | { type: 'answer'; text: string; tool_calls: ToolCall[] }
  | { type: 'plan'; plan: ChangePlan; tool_calls: ToolCall[] }
  | { type: 'clarification'; question: string };

/**
 * Envía el mensaje del usuario al LLM y devuelve el resultado interpretado.
 *
 * @param messages Historial de la conversación (sin system prompt).
 * @param siteContext Contexto del sitio (URL, página actual, design system, etc.)
 */
export async function generateAgentResponse(
  messages: LlmMessage[],
  siteContext: {
    siteName: string;
    siteUrl: string;
    availableWidgets?: string[];
    currentPageId?: number;
    /**
     * Inventario read-only del sitio (páginas, templates, media, etc.)
     * Si está presente, se inyecta en el system prompt para darle al LLM
     * ground truth sobre IDs y evitar alucinaciones.
     */
    inventory?: SiteInventory | null;
  }
): Promise<AgentResult> {
  const provider = getLlmProvider();
  const tools = getToolsForLLM();

  // Construir el system prompt con contexto del sitio.
  const inventoryBlock = siteContext.inventory
    ? formatInventoryForPrompt(siteContext.inventory)
    : '';
  const systemWithContext = `${SYSTEM_PROMPT}

Current site:
- Name: ${siteContext.siteName}
- URL: ${siteContext.siteUrl}
- Available widgets: ${(siteContext.availableWidgets ?? []).slice(0, 30).join(', ')}${(siteContext.availableWidgets ?? []).length > 30 ? '...' : ''}
${siteContext.currentPageId ? `- Current page ID: ${siteContext.currentPageId}` : ''}
${inventoryBlock ? '\n' + inventoryBlock : ''}`;

  const response = await provider.generate(messages, {
    tools,
    system: systemWithContext,
    max_tokens: 4096,
  });

  logger.debug({
    content_preview: response.content.slice(0, 200),
    tool_calls: response.tool_calls.length,
    stop_reason: response.stop_reason,
  }, 'LLM response received');

  // Detectar si el LLM devolvió un Change Plan en el content.
  const plan = extractChangePlan(response.content);

  if (plan) {
    return { type: 'plan', plan, tool_calls: response.tool_calls };
  }

  // Si el LLM pide clarificación explícitamente.
  const clarification = detectClarification(response.content);
  if (clarification) {
    return { type: 'clarification', question: clarification };
  }

  // Si no, devolver respuesta normal con los tool calls realizados.
  return { type: 'answer', text: response.content, tool_calls: response.tool_calls };
}

/**
 * Extrae un Change Plan del content del LLM.
 *
 * El LLM puede devolverlo en un bloque ```json o ``` con markdown.
 */
function extractChangePlan(content: string): ChangePlan | null {
  // Buscar bloque ```json ... ``` o ``` ... ```
  const fenceMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenceMatch && fenceMatch[1]) {
    return tryParsePlan(fenceMatch[1]);
  }

  // Buscar JSON inline (start with {).
  const jsonStart = content.indexOf('{');
  if (jsonStart >= 0) {
    const slice = content.slice(jsonStart);
    // Intentar parsear lo que parezca un plan completo (buscar el "operations" key).
    if (slice.includes('"operations"') || slice.includes("'operations'")) {
      // Encontrar el final del objeto balanceando llaves.
      const jsonEnd = findBalancedJson(slice);
      if (jsonEnd > 0) {
        return tryParsePlan(slice.slice(0, jsonEnd));
      }
    }
  }

  return null;
}

function tryParsePlan(json: string): ChangePlan | null {
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
        operations: parsed.operations.map((op: unknown) => {
          const o = op as { tool?: string; arguments?: Record<string, unknown> };
          return { tool: o.tool ?? '', arguments: o.arguments ?? {} };
        }),
      };
    }
  } catch {
    // No es JSON válido.
  }
  return null;
}

/**
 * Encuentra el final balanceado de un JSON object.
 */
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

function detectClarification(content: string): string | null {
  const lc = content.toLowerCase().trim();
  if (lc.startsWith('clarification:') || lc.startsWith('question:')) {
    return content.split(':').slice(1).join(':').trim();
  }
  return null;
}
