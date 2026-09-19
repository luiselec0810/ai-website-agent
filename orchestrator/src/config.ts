/**
 * Config — carga y valida las variables de entorno con zod.
 *
 * El LLM provider es configurable. Si no se especifica LLM_PROVIDER,
 * el orchestrator falla al arrancar (no hay default hardcodeado).
 */

import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  LLM_PROVIDER: z.enum(['anthropic', 'openai', 'ollama', 'minimax', 'gemini']),
  LLM_MODEL: z.string().min(1),

  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  MINIMAX_BASE_URL: z.string().url().default('https://api.minimax.io/v1'),
  MINIMAX_API_KEY: z.string().optional(),
  GEMINI_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com/v1beta/openai'),
  GEMINI_API_KEY: z.string().optional(),

  DEFAULT_WP_URL: z.string().url().optional(),
  DEFAULT_WP_API_KEY: z.string().optional(),

  DATABASE_PATH: z.string().default('./orchestrator.db'),

  // G10 fix: clave maestra para cifrar api_key en SQLite (AES-256-GCM).
  // Debe ser base64 de 32 bytes. Si se omite, se usa una clave derivada del cwd
  // (solo OK para dev local; producción debe setear la env var).
  ORCHESTRATOR_MASTER_KEY: z.string().optional(),

  // TTL del cache de inventario (ms). Default 60 s.
  // 0 fuerza refresh en cada llamada (útil para tests).
  AI_AGENT_INVENTORY_TTL_MS: z.coerce.number().int().min(0).optional(),

  CORS_ORIGINS: z.string().default('http://localhost:3000'),
}).refine(
  (env) => {
    if (env.LLM_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      return false;
    }
    if (env.LLM_PROVIDER === 'openai' && !env.OPENAI_API_KEY) {
      return false;
    }
    if (env.LLM_PROVIDER === 'minimax' && !env.MINIMAX_API_KEY) {
      return false;
    }
    if (env.LLM_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) {
      return false;
    }
    return true;
  },
  {
    message: 'API key is required for the selected LLM provider',
    path: ['LLM_PROVIDER'],
  }
);

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;

export const corsOrigins = config.CORS_ORIGINS.split(',').map((s) => s.trim());

export const isDev = config.NODE_ENV === 'development';
export const isProd = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';
