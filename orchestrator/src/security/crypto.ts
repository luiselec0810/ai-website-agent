/**
 * API Key Encryption (G10 fix).
 *
 * Las API keys de los sitios se almacenan en SQLite. Antes se guardaban en
 * plaintext con la columna `api_key_encrypted` (nombre engañoso). Este módulo
 * implementa AES-256-GCM con clave maestra del entorno.
 *
 * Formato del valor cifrado:
 *   "enc:v1:" + base64( IV(12) || TAG(16) || CIPHERTEXT(N) )
 *
 * Si el valor no tiene el prefijo "enc:v1:", se trata como plaintext legacy
 * y se devuelve tal cual (migración transparente). Cuando se vuelva a guardar,
 * `encryptApiKey` lo migrará al formato cifrado.
 *
 * Variables de entorno:
 *   - ORCHESTRATOR_MASTER_KEY: clave base64 de 32 bytes. Si no se define,
 *     se genera una clave efímera al iniciar (solo OK para dev; producción
 *     debe definirla persistida fuera del repo).
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const PREFIX = 'enc:v1:';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

let _cachedKey: Buffer | null = null;

/**
 * Resuelve la clave maestra. Si no hay env var, genera una clave efímera
 * derivada de un salt fijo (esto hace los datos ilegibles entre reinicios
 * del proceso, pero técnicamente las keys legacy se mantienen legibles).
 *
 * Para producción, setear `ORCHESTRATOR_MASTER_KEY` como base64 de 32 bytes.
 */
function getMasterKey(): Buffer {
  if (_cachedKey) return _cachedKey;

  const env = process.env.ORCHESTRATOR_MASTER_KEY;
  if (env) {
    const buf = Buffer.from(env, 'base64');
    if (buf.length !== KEY_LEN) {
      throw new Error(
        `ORCHESTRATOR_MASTER_KEY must decode to ${KEY_LEN} bytes (got ${buf.length}). ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
      );
    }
    _cachedKey = buf;
    return _cachedKey;
  }

  // Dev fallback: derivar clave determinística de un fingerprint del proceso.
  // En producción esto debería ser reemplazado por la env var.
  const fallback = createHash('sha256')
    .update('ai-website-agent-fallback-key-v1')
    .update(process.cwd())
    .digest();
  _cachedKey = fallback;
  return _cachedKey;
}

export function encryptApiKey(plaintext: string): string {
  if (!plaintext) return plaintext;
  if (plaintext.startsWith(PREFIX)) return plaintext; // ya cifrado
  const key = getMasterKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptApiKey(stored: string): string {
  if (!stored) return stored;
  if (!stored.startsWith(PREFIX)) return stored; // plaintext legacy
  try {
    const key = getMasterKey();
    const buf = Buffer.from(stored.slice(PREFIX.length), 'base64');
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString('utf-8');
  } catch {
    return ''; // decryption failed — likely wrong key
  }
}

/**
 * Helper para SELECT de sitios: aplica decryptApiKey al resultado.
 */
export function decodeSiteRow<T extends { api_key_encrypted: string }>(row: T | undefined): T | undefined {
  if (!row) return row;
  return { ...row, api_key_encrypted: decryptApiKey(row.api_key_encrypted) };
}
