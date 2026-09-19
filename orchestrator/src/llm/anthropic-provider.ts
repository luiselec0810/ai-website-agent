/**
 * Anthropic Provider.
 *
 * Usa el SDK oficial @anthropic-ai/sdk.
 * Convierte entre nuestro formato interno y el formato Anthropic Messages API.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import type {
  LlmMessage,
  LlmProvider,
  LlmResponse,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from './provider.js';

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey ?? config.ANTHROPIC_API_KEY,
    });
  }

  async generate(
    messages: LlmMessage[],
    options: { tools?: ToolDefinition[]; system?: string; model?: string; max_tokens?: number }
  ): Promise<LlmResponse> {
    // Convertir mensajes a formato Anthropic.
    const anthropicMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => this.toAnthropicMessage(m));

    const response = await this.client.messages.create({
      model: options.model ?? config.LLM_MODEL,
      max_tokens: options.max_tokens ?? 4096,
      system: options.system ?? '',
      tools: options.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      })),
      messages: anthropicMessages,
    });

    return this.fromAnthropicResponse(response);
  }

  private toAnthropicMessage(m: LlmMessage): Anthropic.MessageParam {
    if (m.role === 'assistant') {
      if (m.tool_calls && m.tool_calls.length > 0) {
        return {
          role: 'assistant',
          content: m.tool_calls.map((tc) => ({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          })),
        };
      }
      return { role: 'assistant', content: m.content };
    }

    if (m.role === 'user') {
      // Si hay tool_results, devolverlos como tool_result blocks.
      if (m.tool_results && m.tool_results.length > 0) {
        return {
          role: 'user',
          content: m.tool_results.map((tr) => ({
            type: 'tool_result',
            tool_use_id: tr.tool_call_id,
            content: tr.content,
            is_error: tr.is_error ?? false,
          })),
        };
      }
      return { role: 'user', content: m.content };
    }

    // 'tool' no existe en Anthropic, se mapea a user.
    return { role: 'user', content: m.content };
  }

  private fromAnthropicResponse(response: Anthropic.Messages.Message): LlmResponse {
    let content = '';
    const tool_calls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        tool_calls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    let stop_reason: LlmResponse['stop_reason'] = 'end_turn';
    if (response.stop_reason === 'tool_use') stop_reason = 'tool_use';
    else if (response.stop_reason === 'max_tokens') stop_reason = 'max_tokens';
    else if (response.stop_reason === 'end_turn') stop_reason = 'end_turn';

    return {
      content,
      tool_calls,
      stop_reason,
      usage: response.usage
        ? {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
          }
        : undefined,
    };
  }
}
