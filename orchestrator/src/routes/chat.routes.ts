/**
 * Chat Routes.
 *
 *   POST /api/chat
 *
 * Body:
 *   {
 *     site_id: string,
 *     conversation_id?: string,
 *     message: string,
 *   }
 *
 * Response:
 *   {
 *     success: true,
 *     data: {
 *       conversation_id: string,
 *       type: 'answer' | 'plan' | 'clarification',
 *       text?: string,
 *       plan?: ChangePlan,
 *       tool_results?: ExecutionResult[],
 *       change_id?: string,  // si se generó un plan
 *     }
 *   }
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../db/client.js';
import { callWp, type WpSite, WpError } from '../executor/wp-client.js';
import { executeTool } from '../executor/tool-executor.js';
import { generateAgentResponse, type AgentResult } from '../planner/plan-generator.js';
import { getInventoryForSite, clearInventoryCache, type SiteInventory } from '../context/site-inventory.js';
import type { LlmMessage } from '../llm/provider.js';
import { logger } from '../logger.js';
import { decodeSiteRow } from '../security/crypto.js';

export const chatRoutes = new Hono();

interface ChatRequest {
  site_id: string;
  conversation_id?: string;
  message: string;
  /**
   * Si false, el chat NO inyecta el inventario del sitio en el system
   * prompt del LLM. Útil para benchmarks y para tests que quieran aislar
   * el efecto del inventario sobre la respuesta del LLM.
   */
  include_inventory?: boolean;
}

/**
 * Si el LLM ejecutó tools pero no generó texto, sintetizamos uno a partir de los resultados.
 */
function synthesizeTextFromToolResults(
  results: Array<{ tool: string; status: string; result?: unknown; error?: { code: string; message: string } }>
): string {
  const lines: string[] = [];
  for (const r of results) {
    if (r.status !== 'success') {
      lines.push(`❌ ${r.tool} falló: ${r.error?.message ?? 'desconocido'}`);
      continue;
    }
    switch (r.tool) {
      case 'list_pages': {
        const data = (r.result as { data?: Array<{ id: number; title: string; status: string; url: string }> } | Array<{ id: number; title: string; status: string; url: string }>) ?? [];
        const items = Array.isArray(data) ? data : (data.data ?? []);
        if (items.length === 0) {
          lines.push('No se encontraron páginas.');
        } else {
          lines.push(`Encontré ${items.length} página(s):`);
          for (const p of items) {
            lines.push(`- **${p.title}** (id=${p.id}, status=${p.status})`);
          }
        }
        break;
      }
      case 'get_page': {
        const data = r.result as { id: number; title: string; status: string; url: string };
        if (data) lines.push(`📄 ${data.title} (id=${data.id}) — ${data.status}`);
        break;
      }
      case 'get_elementor_structure':
      case 'analyze_page': {
        const data = r.result as { analysis?: { containers: number; widgets: number; images: number; buttons: number; headings: number; total: number } };
        if (data?.analysis) {
          const a = data.analysis;
          lines.push(`Análisis: ${a.containers} containers, ${a.widgets} widgets, ${a.headings} headings, ${a.buttons} buttons, ${a.images} images.`);
        }
        break;
      }
      case 'search_media': {
        const arr = (r.result as unknown[] | { data?: unknown[] }) ?? [];
        const items = Array.isArray(arr) ? arr : (arr.data ?? []);
        lines.push(`Encontré ${items.length} archivos multimedia.`);
        break;
      }
      default:
        // Mostrar JSON resumido del resultado si existe
        if (r.result !== undefined && r.result !== null) {
          try {
            const json = JSON.stringify(r.result, null, 0).slice(0, 300);
            lines.push(`✓ ${r.tool}: ${json}`);
          } catch {
            lines.push(`✓ ${r.tool} ejecutado correctamente.`);
          }
        } else {
          lines.push(`✓ ${r.tool} ejecutado correctamente.`);
        }
    }
  }
  return lines.join('\n');
}

/**
 * Detecta si el mensaje del usuario indica intención de hacer cambios.
 * Devuelve true si hay verbos de cambio (crear, modificar, agregar, etc.).
 */
function detectsChangeIntent(message: string): boolean {
  const lower = message.toLowerCase();
  const keywords = [
    // Crear / agregar / añadir
    'crea', 'crear', 'creame', 'creame', 'agrega', 'agregar', 'añade', 'añadir',
    // Modificar / cambiar / editar
    'modifica', 'modificar', 'cambia', 'cambiar', 'edita', 'editar',
    // Reemplazar / poner
    'reemplaza', 'reemplazar', 'sustituye', 'sustituir', 'pon', 'poner',
    // Eliminar / quitar / borrar
    'elimina', 'eliminar', 'borra', 'borrar', 'quitar', 'quita', 'remueve', 'remover',
    // Mover / copiar
    'mueve', 'mover', 'copia', 'copiar', 'duplica', 'duplicar',
    // Inglés
    'update', 'delete', 'create', 'replace', 'swap', 'move', 'copy', 'duplicate',
    // Plantillas / aplicar
    'usa la plantilla', 'aplica', 'aplicar', 'use template',
  ];
  return keywords.some((k) => lower.includes(k));
}

chatRoutes.post('/', async (c) => {
  const body = (await c.req.json()) as ChatRequest;
  if (!body.site_id || !body.message) {
    return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'site_id and message required' } }, 400);
  }

  const db = getDb();

  // 1. Cargar sitio
  const siteRow = decodeSiteRow(
    db
      .prepare(`SELECT id, name, url, api_key_encrypted FROM sites WHERE id = ?`)
      .get(body.site_id) as { id: string; name: string; url: string; api_key_encrypted: string } | undefined
  );

  if (!siteRow) {
    return c.json({ success: false, error: { code: 'SITE_NOT_FOUND', message: 'Site not found' } }, 404);
  }

  const site: WpSite = { id: siteRow.id, name: siteRow.name, url: siteRow.url, apiKey: siteRow.api_key_encrypted };

  // 2. Crear o cargar conversación
  let conversationId = body.conversation_id;
  if (!conversationId) {
    conversationId = `conv_${nanoid(10)}`;
    db.prepare(
      `INSERT INTO conversations (id, site_id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(conversationId, site.id, 'default_user', body.message.slice(0, 60), new Date().toISOString(), new Date().toISOString());
  } else {
    db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(new Date().toISOString(), conversationId);
  }

  // 3. Guardar mensaje del usuario
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)`
  ).run(`msg_${nanoid(10)}`, conversationId, body.message, new Date().toISOString());

  // 4. Cargar historial de mensajes
  const history = db
    .prepare(`SELECT role, content, tool_calls, tool_results FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 50`)
    .all(conversationId) as Array<{ role: string; content: string; tool_calls: string | null; tool_results: string | null }>;

  const messages: LlmMessage[] = history.map((h) => ({
    role: h.role as LlmMessage['role'],
    content: h.content,
    tool_calls: h.tool_calls ? JSON.parse(h.tool_calls) : undefined,
    tool_results: h.tool_results ? JSON.parse(h.tool_results) : undefined,
  }));

  // 5. Cargar contexto del sitio
  let availableWidgets: string[] = [];
  let siteName = siteRow.name;
  let siteUrl = siteRow.url;
  try {
    const health = await callWp<{ available_widgets: string[]; site_name: string; site_url: string }>(site, 'GET', '/health');
    availableWidgets = health.available_widgets ?? [];
    siteName = health.site_name ?? siteName;
    siteUrl = health.site_url ?? siteUrl;
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch site health for context');
  }

  // 5b. Cargar inventario (cacheado, ~30 s TTL en chat). El inventario le da
  // al LLM ground truth sobre IDs reales de páginas, templates y media, así
  // no inventa IDs al generar un Change Plan. Opt-out vía `include_inventory=false`.
  const includeInventory = body.include_inventory !== false;
  let inventoryContext: SiteInventory | null = null;
  if (includeInventory) {
    try {
      inventoryContext = await getInventoryForSite(site, { maxAgeMs: 30_000 });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Inventory fetch failed; proceeding without it');
      inventoryContext = null;
    }
  }

  // 6. Llamar al LLM
  let result: AgentResult;
  try {
    result = await generateAgentResponse(messages, {
      siteName,
      siteUrl,
      availableWidgets,
      inventory: inventoryContext,
    });
  } catch (err) {
    return c.json(
      {
        success: false,
        error: { code: 'LLM_ERROR', message: (err as Error).message },
      },
      500
    );
  }

  // 7. Loop de tool execution + LLM re-call hasta convergencia.
  // El LLM a veces necesita varios pasos (analyze, search_media, etc.) antes de
  // generar el plan final. Iteramos automáticamente sin pedirle al usuario
  // confirmación, hasta que el LLM produzca una respuesta sin tool_calls
  // (Answer) o un Plan. Solo se muestra la respuesta final al usuario.
  const toolResults: Array<{ tool: string; status: string; result?: unknown; error?: { code: string; message: string }; retries: number }> = [];
  const MAX_ITERATIONS = 6;
  let iter = 0;
  const toolMessages: LlmMessage[] = [...messages];

  while (
    iter < MAX_ITERATIONS &&
    result.type === 'answer' &&
    result.tool_calls &&
    result.tool_calls.length > 0
  ) {
    iter++;

    // Ejecutar los tool calls (read-only en este loop).
    const iterResults: typeof toolResults = [];
    for (const tc of result.tool_calls) {
      try {
        // Para tools de lectura usamos el sistema change_id "read" que existe
        // automáticamente en el bootstrap del DB (no requiere changeId válido).
        const r = await executeTool(site, '__system_read__', 'approved', tc.name, tc.arguments, { maxRetries: 1 });
        iterResults.push(r);
        toolResults.push(r);
      } catch (err) {
        const failed = {
          tool: tc.name,
          status: 'failed' as const,
          error: { code: 'EXEC_ERROR', message: (err as Error).message },
          retries: 0,
        };
        iterResults.push(failed);
        toolResults.push(failed);
      }
    }

    // Construir mensajes incrementales: assistant original + tool_results.
    toolMessages.push({
      role: 'assistant',
      content: result.text ?? '',
      tool_calls: result.tool_calls,
    });
    for (let i = 0; i < result.tool_calls.length; i++) {
      const tc = result.tool_calls[i];
      const tr = iterResults[i];
      toolMessages.push({
        role: 'user',
        content: '',
        tool_results: [{
          tool_call_id: tc.id,
          content: tr.status === 'success'
            ? JSON.stringify(tr.result ?? null)
            : JSON.stringify({ error: tr.error?.message ?? 'unknown' }),
          is_error: tr.status !== 'success',
        }],
      });
    }

    // Re-llamar al LLM con todos los mensajes acumulados.
    try {
      const next = await generateAgentResponse(toolMessages, {
        siteName,
        siteUrl,
        availableWidgets,
        inventory: inventoryContext,
      });
      // Si el LLM produce un plan, salir del loop inmediatamente.
      if (next.type === 'plan') {
        result = next;
        break;
      }
      // Si el LLM produce una clarification, salir (esperando input del usuario).
      if (next.type === 'clarification') {
        result = next;
        break;
      }
      // Si es answer, ver si tiene más tool_calls. Si no, terminó.
      if (next.type === 'answer') {
        if (!next.tool_calls || next.tool_calls.length === 0) {
          result = next;
          break;
        }
        // Continuar iterando.
        result = { ...next };
      }
    } catch (err) {
      logger.warn({ err, iter }, 'LLM call failed during tool-execution loop');
      // Si falla, generar texto a partir de los resultados disponibles.
      const curText = (result.type === 'answer') ? result.text : null;
      if (!curText && toolResults.length > 0) {
        const synth = synthesizeTextFromToolResults(toolResults);
        if (result.type === 'answer') {
          result.text = synth;
        }
      }
      break;
    }
  }

  // Si tenemos toolResults pero el result final no tiene texto, sintetizar uno.
  const resultText = (result.type === 'answer') ? result.text : null;
  if (!resultText && toolResults.length > 0) {
    const synth = synthesizeTextFromToolResults(toolResults);
    if (result.type === 'answer') {
      result.text = synth;
    }
    logger.info({ toolResults }, 'Synthesized text from tool results');
  }

  // Si el usuario pidió cambios (palabras clave) pero el LLM solo ejecutó tools
  // de lectura y NO generó un plan, forzar iteraciones adicionales de la LLM
  // hasta que produzca un Change Plan o se agote el presupuesto.
  //
  // El LLM a veces, después de leer templates/structure, responde con texto
  // analítico en vez de generar el plan. Para esos casos, le inyectamos un
  // recordatorio explícito ("continúa con el plan"). Si aún así pide más
  // tools, las ejecutamos y seguimos iterando. Limitamos a MAX_FORCE_ITERATIONS
  // para evitar loops infinitos.
  if (result.type !== 'plan' && detectsChangeIntent(body.message) && toolResults.length > 0) {
    const MAX_FORCE_ITERATIONS = 4;
    let forceIter = 0;

    while (forceIter < MAX_FORCE_ITERATIONS) {
      forceIter++;

      // Mensaje de nudge con urgencia creciente: el primer intento es firme,
      // los siguientes son más cortos y directos.
      const nudgeContent = forceIter === 1
        ? 'IMPORTANTE: el usuario pidió cambios ("' + body.message +
          '"). Ahora que ya tienes el contexto, debes devolver un Change Plan JSON con las operaciones para realizarlos. ' +
          'NO devuelvas solo texto explicativo. Responde solo con el JSON del plan.'
        : 'continúa con el Change Plan JSON. Devuelve SOLO el JSON del plan, NO texto explicativo. ' +
          'Si necesitas más información, pregunta de forma concreta.';

      const nudgeMessages: LlmMessage[] = [
        ...messages,
        ...toolMessages.slice(messages.length),  // historial acumulado de iteraciones previas
        { role: 'user', content: nudgeContent },
      ];

      let forcedResult: AgentResult;
      try {
        forcedResult = await generateAgentResponse(nudgeMessages, {
          siteName,
          siteUrl,
          availableWidgets,
          inventory: inventoryContext,
        });
      } catch (err) {
        logger.warn({ err, forceIter }, 'Forced plan iteration failed');
        break;
      }

      if (forcedResult.type === 'plan') {
        logger.info({ forceIter }, 'Forced plan succeeded');
        result = forcedResult;
        toolResults.length = 0;
        break;
      }

      if (forcedResult.type === 'clarification') {
        // El LLM tiene una pregunta legítima — devolvemos al usuario.
        result = forcedResult;
        break;
      }

      // forcedResult.type === 'answer'
      if (forcedResult.tool_calls && forcedResult.tool_calls.length > 0) {
        // El LLM pidió más tools — las ejecutamos y añadimos al historial para
        // que la próxima iteración del while vea el contexto completo.
        const newToolResults: typeof toolResults = [];
        for (const tc of forcedResult.tool_calls) {
          try {
            const r = await executeTool(site, '__system_read__', 'approved', tc.name, tc.arguments, { maxRetries: 1 });
            newToolResults.push(r);
            toolResults.push(r);
          } catch (err) {
            const failed = {
              tool: tc.name,
              status: 'failed' as const,
              error: { code: 'EXEC_ERROR', message: (err as Error).message },
              retries: 0,
            };
            newToolResults.push(failed);
            toolResults.push(failed);
          }
        }

        // Acumular en toolMessages para la siguiente iteración.
        toolMessages.push({
          role: 'assistant',
          content: forcedResult.text || '',
          tool_calls: forcedResult.tool_calls,
        });
        for (let i = 0; i < forcedResult.tool_calls.length; i++) {
          const tc = forcedResult.tool_calls[i];
          const tr = newToolResults[i];
          toolMessages.push({
            role: 'user',
            content: '',
            tool_results: [{
              tool_call_id: tc.id,
              content: tr.status === 'success'
                ? JSON.stringify(tr.result ?? null)
                : JSON.stringify({ error: tr.error?.message ?? 'unknown' }),
              is_error: tr.status !== 'success',
            }],
          });
        }
        // Continuar iterando — la próxima llamada verá los nuevos resultados.
        continue;
      }

      // answer sin tool_calls: actualizar text al último del LLM y continuar
      // iterando con un nudge más directo. El loop termina cuando se agota
      // MAX_FORCE_ITERATIONS o cuando el LLM produce un plan.
      logger.warn({ forceIter, text: forcedResult.text?.slice(0, 200) }, 'Forced plan: LLM returned text without plan or tool_calls');
      result = { type: 'answer', text: forcedResult.text ?? '', tool_calls: [] };
      continue;
    }
  }

  // 8. Si es un plan, guardarlo en la tabla `changes`
  if (result.type === 'plan') {
    const changeId = `ch_${nanoid(10)}`;
    db.prepare(
      `INSERT INTO changes (id, site_id, conversation_id, title, description, operations, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'awaiting_approval', ?)`
    ).run(
      changeId,
      site.id,
      conversationId,
      result.plan.title,
      result.plan.description,
      JSON.stringify(result.plan.operations),
      new Date().toISOString()
    );

    // Guardar mensaje del assistant con el plan
    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, tool_calls, created_at) VALUES (?, ?, 'assistant', ?, ?, ?)`
    ).run(
      `msg_${nanoid(10)}`,
      conversationId,
      result.tool_calls && result.tool_calls.length > 0 ? JSON.stringify(result.tool_calls) : result.plan.description,
      result.tool_calls && result.tool_calls.length > 0 ? JSON.stringify(result.tool_calls) : null,
      new Date().toISOString()
    );

    // Invalidar el cache de inventario: el plan va a modificar el sitio
    // (crear páginas, cambiar media, etc.), así que el inventario que
    // inyectamos en el próximo turno debe ser fresco. Esto evita que el
    // LLM use IDs obsoletos para operaciones posteriores.
    clearInventoryCache(site.id);

    return c.json({
      success: true,
      data: {
        conversation_id: conversationId,
        type: 'plan',
        text: result.plan.description,
        plan: result.plan,
        change_id: changeId,
      },
    });
  }

  // 9. Guardar mensaje del assistant
  const toolCallsJson = 'tool_calls' in result && result.tool_calls && result.tool_calls.length > 0
    ? JSON.stringify(result.tool_calls)
    : null;
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, tool_calls, created_at) VALUES (?, ?, 'assistant', ?, ?, ?)`
  ).run(
    `msg_${nanoid(10)}`,
    conversationId,
    result.type === 'clarification' ? `Clarification: ${result.question}` : result.text,
    toolCallsJson,
    new Date().toISOString()
  );

  return c.json({
    success: true,
    data: {
      conversation_id: conversationId,
      type: result.type,
      text: result.type === 'clarification' ? result.question : result.text,
      tool_results: toolResults,
    },
  });
});
