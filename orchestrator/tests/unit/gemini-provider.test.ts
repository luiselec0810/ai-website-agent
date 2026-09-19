/**
 * Tests del Gemini Provider.
 *
 * Solo verifica la estructura — no hace llamadas reales.
 * Para integration test, usar mock con nock/MSW.
 */

import { describe, it, expect } from 'vitest';
import { GeminiProvider } from '../../src/llm/gemini-provider.js';

describe('GeminiProvider', () => {
  it('implements LlmProvider interface', () => {
    const provider = new GeminiProvider('https://generativelanguage.googleapis.com/v1beta/openai', 'test-key');
    expect(provider.name).toBe('gemini');
  });

  it('accepts custom base URL', () => {
    const provider = new GeminiProvider('https://my-mock-api.com/v1', 'k');
    expect(provider.name).toBe('gemini');
  });

  it('has generate method that returns a Promise', () => {
    const provider = new GeminiProvider();
    expect(typeof provider.generate).toBe('function');
    const result = provider.generate([], {});
    expect(result).toBeInstanceOf(Promise);
    result.catch(() => {}); // ignore network rejection
  });
});
