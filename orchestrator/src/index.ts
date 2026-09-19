/**
 * AI Orchestrator — entrypoint.
 *
 * Servidor HTTP con Hono. Expone:
 *   - GET  /health
 *   - /api/sites          (sites.routes)
 *   - /api/chat           (chat.routes)
 *   - /api/changes        (changes.routes)
 *   - /api/conversations  (conversations.routes) — historial de chats
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config, corsOrigins } from './config.js';
import { logger } from './logger.js';
import { getDb } from './db/client.js';
import { sitesRoutes } from './routes/sites.routes.js';
import { chatRoutes } from './routes/chat.routes.js';
import { changesRoutes } from './routes/changes.routes.js';
import { conversationsRoutes } from './routes/conversations.routes.js';
import { inventoryRoutes } from './routes/inventory.routes.js';
import { getLlmProvider } from './llm/factory.js';

const app = new Hono();

// CORS
app.use('*', cors({
  origin: corsOrigins,
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-AI-Agent-Key', 'X-AI-Agent-Change-Id'],
}));

// Logging middleware
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  logger.info({
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    ms: Date.now() - start,
  }, 'request');
});

// Health
app.get('/health', (c) => c.json({
  success: true,
  service: 'ai-website-orchestrator',
  version: '1.0.0',
  llm_provider: getLlmProvider().name,
  llm_model: config.LLM_MODEL,
}));

// Rutas
app.route('/api/sites', sitesRoutes);
app.route('/api/sites', inventoryRoutes);
app.route('/api/chat', chatRoutes);
app.route('/api/changes', changesRoutes);
app.route('/api/conversations', conversationsRoutes);

// 404
app.notFound((c) => c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }, 404));

// Error handler
app.onError((err, c) => {
  logger.error({ err }, 'Unhandled error');
  return c.json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: err.message },
  }, 500);
});

// Inicializar DB al arrancar
getDb();

// Iniciar servidor
serve({
  fetch: app.fetch,
  port: config.PORT,
  hostname: '0.0.0.0',  // explícito: antes dependía del default de Node.
                          // Hono/node-server v1.13+ acepta este parámetro.
}, (info) => {
  logger.info({ port: info.port, llm: config.LLM_PROVIDER }, '🚀 AI Orchestrator started');
});
