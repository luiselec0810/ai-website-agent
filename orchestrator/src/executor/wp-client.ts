/**
 * WP Client — wrapper HTTP para la REST API del plugin AI Website Bridge.
 *
 * Centraliza la autenticación por API Key y el manejo de errores.
 */

import { logger } from '../logger.js';

export interface WpSite {
  id: string;
  name: string;
  url: string;
  apiKey: string;
}

export interface WpSuccessResponse<T> {
  success: true;
  data: T;
}

export interface WpErrorResponse {
  success: false;
  error: { code: string; message: string; details?: unknown; data?: unknown };
}

export type WpResponse<T> = WpSuccessResponse<T> | WpErrorResponse;

export class WpError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
    public httpStatus?: number
  ) {
    super(message);
  }
}

/**
 * Hace una llamada a la REST API del plugin en el sitio dado.
 */
export async function callWp<T = unknown>(
  site: WpSite,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  options: { body?: unknown; query?: Record<string, string | number | undefined>; changeId?: string } = {}
): Promise<T> {
  const url = new URL(`/wp-json/ai-agent/v1${path}`, site.url);

  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    'X-AI-Agent-Key': site.apiKey,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  if (options.changeId) {
    headers['X-AI-Agent-Change-Id'] = options.changeId;
  }

  logger.debug({ method, url: url.toString(), site: site.name }, 'Calling WP REST API');

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new WpError(
      'INVALID_RESPONSE',
      `WP returned non-JSON response (HTTP ${response.status})`,
      text.slice(0, 500),
      response.status
    );
  }

  if (!response.ok) {
    const err = (json as WpErrorResponse)?.error;
    // G7 fix: aceptar tanto `data` (formato nuevo del plugin, {success:false,error:{code,message,data}})
    // como `details` (formato legacy, conservado por compatibilidad).
    const details = err?.details ?? err?.data;
    throw new WpError(
      err?.code ?? 'HTTP_ERROR',
      err?.message ?? `HTTP ${response.status}`,
      details,
      response.status
    );
  }

  const wrapped = json as WpResponse<T>;
  if (wrapped && wrapped.success === false) {
    throw new WpError(wrapped.error.code, wrapped.error.message, wrapped.error.details, response.status);
  }

  // El plugin devuelve { success: true, data: ... } — devolvemos data.
  return (wrapped as WpSuccessResponse<T>).data;
}
