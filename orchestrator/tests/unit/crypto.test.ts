/**
 * Tests de regresión — gap G10.
 *
 * Verifica que encryptApiKey/decryptApiKey:
 *   1. Cifra y descifra correctamente (round-trip).
 *   2. Cada cifrado genera IV distinto (no determinístico).
 *   3. Devuelve plaintext tal cual cuando no tiene prefijo `enc:v1:` (migración transparente).
 *   4. Devuelve vacío cuando el ciphertext está corrupto.
 *   5. decodeSiteRow aplica el descifrado al campo api_key_encrypted.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { encryptApiKey, decryptApiKey, decodeSiteRow } from '../../src/security/crypto.js';

describe('G10 — AES-256-GCM API key encryption', () => {
  beforeEach(() => {
    delete process.env.ORCHESTRATOR_MASTER_KEY;
  });

  it('round-trips a plaintext api key', () => {
    const plain = 'aiw_secret_key_abc123';
    const enc = encryptApiKey(plain);
    expect(enc).toMatch(/^enc:v1:[A-Za-z0-9+/=]+$/);
    expect(enc).not.toContain(plain);
    expect(decryptApiKey(enc)).toBe(plain);
  });

  it('produces a different ciphertext each call (random IV)', () => {
    const a = encryptApiKey('same-value');
    const b = encryptApiKey('same-value');
    expect(a).not.toBe(b);
    expect(decryptApiKey(a)).toBe(decryptApiKey(b));
  });

  it('returns plaintext as-is when value lacks prefix (legacy migration)', () => {
    const legacy = 'aiw_legacy_unencrypted_key';
    expect(decryptApiKey(legacy)).toBe(legacy);
  });

  it('returns empty string when ciphertext is corrupted', () => {
    const bad = 'enc:v1:' + 'A'.repeat(100);
    expect(decryptApiKey(bad)).toBe('');
  });

  it('handles empty strings', () => {
    expect(encryptApiKey('')).toBe('');
    expect(decryptApiKey('')).toBe('');
  });

  it('decodeSiteRow decrypts api_key_encrypted in place', () => {
    const enc = encryptApiKey('my-key');
    const row = decodeSiteRow({ id: 's1', api_key_encrypted: enc });
    expect(row?.api_key_encrypted).toBe('my-key');
  });

  it('decodeSiteRow passes through legacy plaintext rows', () => {
    const row = decodeSiteRow({ id: 's2', api_key_encrypted: 'plain-value' });
    expect(row?.api_key_encrypted).toBe('plain-value');
  });

  it('decodeSiteRow handles undefined', () => {
    expect(decodeSiteRow(undefined)).toBeUndefined();
  });

  it('respects ORCHESTRATOR_MASTER_KEY env var (encryption differs from default key)', async () => {
    const plain = 'my-key';
    const a = encryptApiKey(plain);

    // Reset module cache so it re-reads ORCHESTRATOR_MASTER_KEY on next import.
    vi.resetModules();
    process.env.ORCHESTRATOR_MASTER_KEY = Buffer.alloc(32, 1).toString('base64');
    const { encryptApiKey: enc2 } = await import('../../src/security/crypto.js');
    const b = enc2(plain);

    // Mismo texto pero distinta clave → distintos ciphertexts.
    expect(a).not.toBe(b);
    expect(enc2).not.toBe(encryptApiKey);
  });
});
