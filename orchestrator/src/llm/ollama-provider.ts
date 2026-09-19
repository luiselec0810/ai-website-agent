/**
 * Ollama Provider.
 *
 * Ollama expone una API compatible con OpenAI. Usamos el SDK openai
 * apuntando a la URL de Ollama local.
 */

import OpenAI from 'openai';
import { config } from '../config.js';
import type { LlmMessage, LlmProvider, LlmResponse, ToolDefinition } from './provider.js';

export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama';
  private client: OpenAI;

  constructor(baseUrl?: string) {
    this.client = new OpenAI({
      apiKey: 'ollama',  // Ollama no requiere API key, pero el SDK exige algo.
      baseURL: baseUrl ?? config.OLLAMA_BASE_URL,
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

      openaiMessages.push({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      });
    }

    try {
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
      };
    } catch (err) {
      throw new Error(
        `Ollama request failed. Make sure Ollama is running at ${config.OLLAMA_BASE_URL} and the model "${config.LLM_MODEL}" is pulled. Original error: ${(err as Error).message}`
      );
    }
  }
}
