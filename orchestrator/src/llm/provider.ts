/**
 * LLM Provider interface.
 *
 * Cada adapter (Anthropic, OpenAI, Ollama) implementa esta interfaz.
 * El orchestrator no sabe ni le importa qué proveedor se usa — solo
 * llama a `generate(messages, tools)` y recibe un resultado normalizado.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface LlmMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_results?: ToolResult[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  tool_call_id: string;
  content: string;  // JSON stringificado
  is_error?: boolean;
}

export interface LlmResponse {
  content: string;
  tool_calls: ToolCall[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error';
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface LlmProvider {
  readonly name: string;
  generate(
    messages: LlmMessage[],
    options: { tools?: ToolDefinition[]; system?: string; model?: string; max_tokens?: number }
  ): Promise<LlmResponse>;
}
