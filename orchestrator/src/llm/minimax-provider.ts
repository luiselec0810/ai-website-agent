/**
 * Minimax M3 Provider.
 *
 * Minimax M3 expone una API compatible con OpenAI Chat Completions
 * (function calling incluido). Usamos el SDK openai apuntando a la URL
 * configurable de Minimax M3.
 *
 * Variables de entorno:
 *   MINIMAX_BASE_URL    - URL base del API (ej: https://api.minimax.io/v1)
 *   MINIMAX_API_KEY     - API key de Minimax M3
 *   MINIMAX_MODEL       - Modelo a usar (ej: MiniMax-M3)
 *   LLM_MODEL           - Override global; si está vacío en runtime, usa LLM_MODEL
 */

import OpenAI from 'openai';
import { config } from '../config.js';
import type { LlmMessage, LlmProvider, LlmResponse, ToolDefinition } from './provider.js';

export class MinimaxProvider implements LlmProvider {
  readonly name = 'minimax';
  private client: OpenAI;

  constructor(baseUrl?: string, apiKey?: string) {
    this.client = new OpenAI({
      apiKey: apiKey ?? config.MINIMAX_API_KEY ?? '',
      baseURL: baseUrl ?? config.MINIMAX_BASE_URL ?? 'https://api.minimax.io/v1',
    });
  }

  async generate(
    messages: LlmMessage[],
    options: { tools?: ToolDefinition[]; system?: string; model?: string; max_tokens?: number }
  ): Promise<LlmResponse> {
    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (options.system) {
      openaiMessages.push({ role: 'system', content: options.system });
    }

    for (const m of messages) {
      if (m.role === 'system') continue;

      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        openaiMessages.push({
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        });
        continue;
      }

      if (m.role === 'tool') {
        openaiMessages.push({
          role: 'tool',
          tool_call_id: (m as unknown as { tool_call_id?: string }).tool_call_id ?? '',
          content: m.content,
        });
        continue;
      }

      openaiMessages.push({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      });
    }

    const response = await this.client.chat.completions.create({
      model: options.model ?? config.LLM_MODEL,
      max_tokens: options.max_tokens ?? 4096,
      messages: openaiMessages,
      tools: options.tools?.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      })),
    });

    const choice = response.choices[0];
    if (!choice) {
      return { content: '', tool_calls: [], stop_reason: 'error' };
    }

    const tool_calls = (choice.message.tool_calls ?? [])
      .filter((tc) => tc.type === 'function')
      .map((tc) => {
        const fnTc = tc as { id: string; function: { name: string; arguments: string } };
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(fnTc.function.arguments);
        } catch {
          args = {};
        }
        return { id: fnTc.id, name: fnTc.function.name, arguments: args };
      });

    let stop_reason: LlmResponse['stop_reason'] = 'end_turn';
    if (choice.finish_reason === 'tool_calls') stop_reason = 'tool_use';
    else if (choice.finish_reason === 'length') stop_reason = 'max_tokens';

    return {
      content: choice.message.content ?? '',
      tool_calls,
      stop_reason,
      usage: response.usage
        ? {
            input_tokens: response.usage.prompt_tokens,
            output_tokens: response.usage.completion_tokens,
          }
        : undefined,
    };
  }
}
