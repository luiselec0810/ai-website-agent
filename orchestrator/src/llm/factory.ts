/**
 * LLM Factory — selecciona el provider según config.
 *
 * NO hay default hardcodeado: si LLM_PROVIDER no está configurado,
 * la app falla al arrancar (config.ts lo enforce).
 */

import { config } from '../config.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { OllamaProvider } from './ollama-provider.js';
import { MinimaxProvider } from './minimax-provider.js';
import { GeminiProvider } from './gemini-provider.js';
import type { LlmProvider } from './provider.js';
import { logger } from '../logger.js';

let _provider: LlmProvider | null = null;

export function getLlmProvider(): LlmProvider {
  if (_provider) return _provider;

  logger.info({ provider: config.LLM_PROVIDER, model: config.LLM_MODEL }, 'Initializing LLM provider');

  switch (config.LLM_PROVIDER) {
    case 'anthropic':
      _provider = new AnthropicProvider();
      break;
    case 'openai':
      _provider = new OpenAIProvider();
      break;
    case 'ollama':
      _provider = new OllamaProvider();
      break;
    case 'minimax':
      _provider = new MinimaxProvider();
      break;
    case 'gemini':
      _provider = new GeminiProvider();
      break;
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${config.LLM_PROVIDER}`);
  }

  return _provider;
}
