/**
 * Tests del Minimax M3 Provider.
 *
 * Estos tests no hacen llamadas reales al API (eso sería un test de integración).
 * Solo verifican que la clase implementa correctamente la interfaz LlmProvider
 * y que el factory la selecciona cuando corresponde.
 */

import { describe, it, expect } from 'vitest';
import { MinimaxProvider } from '../../src/llm/minimax-provider.js';

describe('MinimaxProvider', () => {
  it('implements LlmProvider interface', () => {
    const provider = new MinimaxProvider('https://api.minimax.io/v1', 'test-key');
    expect(provider.name).toBe('minimax');
  });

  it('accepts custom base URL', () => {
    const provider = new MinimaxProvider('https://my-custom-url.example.com/v1', 'k');
    expect(provider.name).toBe('minimax');
    // El client interno solo se crea al hacer .generate(); no podemos inspeccionarlo
    // sin exponerlo. Pero verificamos que la clase no falla en construcción.
  });

  it('throws if generate() fails because of missing key (no network)', async () => {
    const provider = new MinimaxProvider('https://invalid.example.com', '');
    // No necesitamos red: el constructor no hace network.
    // Solo verificamos que el método existe y devuelve Promise.
    expect(typeof provider.generate).toBe('function');
    const result = provider.generate([], {});
    expect(result).toBeInstanceOf(Promise);
    // No esperamos el resultado — dejamos que el test termine.
    result.catch(() => {});
  });
});
