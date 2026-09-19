/**
 * OpenAI Provider.
 *
 * Usa el SDK oficial openai. Convierte nuestro formato interno al formato
 * OpenAI Chat Completions (tool_calls).
 */

import OpenAI from 'openai';
import { config } from '../config.js';
import type {
  LlmMessage,
  LlmProvider,
  LlmResponse,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from './provider.js';

export class OpenAIProvider implements LlmProvider {
  readonly name = 'openai';
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({
      apiKey: apiKey ?? config.OPENAI_API_KEY,
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
      if (m.role === 'system') continue; // ya manejado arriba

      if (m.role === 'tool') {
        // OpenAI usa role: 'tool' con tool_call_id.
        openaiMessages.push({
          role: 'tool',
          tool_call_id: (m as unknown as { tool_call_id?: string }).tool_call_id ?? '',
          content: m.content,
        });
        continue;
      }

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

      if (m.role === 'user' && m.tool_results && m.tool_results.length > 0) {
        // Convertir tool_results a tool messages.
        for (const tr of m.tool_results) {
          openaiMessages.push({
            role: 'tool',
            tool_call_id: tr.tool_call_id,
            content: tr.content,
          });
        }
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

    return this.fromOpenAIResponse(response);
  }

  private fromOpenAIResponse(response: OpenAI.Chat.ChatCompletion): LlmResponse {
    const choice = response.choices[0];
    if (!choice) {
      return { content: '', tool_calls: [], stop_reason: 'error' };
    }

    const tool_calls: ToolCall[] = [];
    for (const tc of choice.message.tool_calls ?? []) {
      if (tc.type === 'function') {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = {};
        }
        tool_calls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: args,
        });
      }
    }

    let stop_reason: LlmResponse['stop_reason'] = 'end_turn';
    if (choice.finish_reason === 'tool_calls') stop_reason = 'tool_use';
    else if (choice.finish_reason === 'length') stop_reason = 'max_tokens';
    else if (choice.finish_reason === 'stop') stop_reason = 'end_turn';

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
