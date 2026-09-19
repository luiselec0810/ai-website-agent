/**
 * Tool Registry.
 *
 * Cada tool del SRS §18 está implementada como una función que toma
 * (site, arguments) y devuelve un resultado (o lanza WpError).
 *
 * Cada tool tiene un JSON Schema que se envía al LLM.
 */

import { readFileSync } from 'node:fs';
import type { ToolDefinition } from '../llm/provider.js';
import { WpSite, callWp, WpError } from '../executor/wp-client.js';
import { logger } from '../logger.js';

export interface ToolHandler {
  name: string;
  description: string;
  input_schema: ToolDefinition['input_schema'];
  execute(site: WpSite, args: Record<string, unknown>, changeId?: string): Promise<unknown>;
}

const PAGES = ['list_pages', 'get_page', 'create_page', 'update_page', 'duplicate_page'];
const ELEMENTOR = [
  'get_elementor_structure',
  'analyze_page',
  'add_container',
  'add_widget',
  'update_widget',
  'delete_element',
  'duplicate_element',
  'move_element',
];
const TEMPLATES = ['list_templates', 'get_template', 'use_template'];
const MEDIA = ['search_media', 'get_media', 'upload_media', 'replace_image', 'set_featured_image'];
const DESIGN = ['get_design_system', 'get_site_settings'];
const HISTORY = ['get_change_history', 'rollback_changes'];

const allTools: ToolHandler[] = [];

// Helper para crear un handler simple que solo hace una llamada REST.
function makeRestTool(
  name: string,
  description: string,
  input_schema: ToolDefinition['input_schema'],
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: (args: Record<string, unknown>) => string,
  bodyKeys?: string[]
): ToolHandler {
  return {
    name,
    description,
    input_schema,
    async execute(site, args, changeId) {
      const p = path(args);
      const query: Record<string, string | number | undefined> = {};
      const body: Record<string, unknown> = {};

      // Argumentos que son query params (todos los input_schema properties que NO están en bodyKeys).
      for (const key of Object.keys(input_schema.properties)) {
        if (args[key] !== undefined) {
          if (bodyKeys?.includes(key)) {
            body[key] = args[key];
          } else {
            query[key] = args[key] as string | number;
          }
        }
      }

      return callWp(site, method, p, {
        body: Object.keys(body).length > 0 ? body : undefined,
        query,
        changeId,
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Pages tools
// ─────────────────────────────────────────────────────────────────
allTools.push(
  makeRestTool(
    'list_pages',
    'List all WordPress pages with optional filters.',
    {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search by title' },
        status: { type: 'string', enum: ['publish', 'draft', 'private', 'any'] },
        per_page: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
        page: { type: 'integer', minimum: 1, default: 1 },
      },
    },
    'GET',
    () => '/pages'
  )
);

allTools.push(
  makeRestTool(
    'get_page',
    'Get a single page by ID with its metadata.',
    {
      type: 'object',
      properties: { id: { type: 'integer', description: 'Page ID' } },
      required: ['id'],
    },
    'GET',
    (a) => `/pages/${a.id}`
  )
);

allTools.push(
  makeRestTool(
    'create_page',
    'Create a new WordPress page. When builder="elementor", defaults are applied automatically: page_template="elementor_canvas" (Lienzo de Elementor) and page_settings.hide_title="yes" (Esconder título). Override with template and hide_title explicitly if needed.',
    {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Page title' },
        status: { type: 'string', enum: ['draft', 'publish', 'private'] },
        slug: { type: 'string' },
        builder: { type: 'string', enum: ['elementor'], description: 'Set to "elementor" to enable Elementor editing with optimal defaults' },
        template: { type: 'string', description: '_wp_page_template value. Default "elementor_canvas" when builder=elementor.' },
        hide_title: { type: 'boolean', description: 'Hide the page title via Elementor page settings. Default true when builder=elementor.' },
      },
      required: ['title'],
    },
    'POST',
    () => '/pages',
    ['title', 'status', 'slug', 'builder', 'template', 'hide_title']
  )
);

allTools.push(
  makeRestTool(
    'update_page',
    'Update an existing page. Supports title, slug, status, and Elementor page settings (hide_title, page_template).',
    {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Page ID' },
        title: { type: 'string' },
        slug: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'publish', 'private'] },
        page_template: { type: 'string', description: 'WP page template (e.g. "elementor_canvas", "default", "elementor_header_footer")' },
        hide_title: { type: 'boolean', description: 'Hide the page title via Elementor page settings' },
        page_settings: { type: 'object', description: 'Generic Elementor page settings to merge (e.g. {"hide_title": "yes", "page_title": "Custom"})' },
      },
      required: ['id'],
    },
    'PATCH',
    (a) => `/pages/${a.id}`,
    ['title', 'slug', 'status', 'page_template', 'hide_title', 'page_settings']
  )
);

allTools.push(
  makeRestTool(
    'duplicate_page',
    'Duplicate an existing page (creates a new page with same content and Elementor data).',
    {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Source page ID' },
        new_title: { type: 'string', description: 'Title for the new page' },
        status: { type: 'string', enum: ['draft', 'publish', 'private'], default: 'draft' },
      },
      required: ['id'],
    },
    'POST',
    (a) => `/pages/${a.id}/duplicate`,
    ['new_title', 'status']
  )
);

// ─────────────────────────────────────────────────────────────────
// Elementor tools
// ─────────────────────────────────────────────────────────────────
allTools.push(
  makeRestTool(
    'get_elementor_structure',
    'Get the full Elementor structure of a page (containers, widgets, settings).',
    {
      type: 'object',
      properties: { id: { type: 'integer', description: 'Page ID' } },
      required: ['id'],
    },
    'GET',
    (a) => `/pages/${a.id}/elementor`
  )
);

allTools.push(
  makeRestTool(
    'analyze_page',
    'Analyze a page: counts of containers, widgets, images, buttons; possible issues.',
    {
      type: 'object',
      properties: { id: { type: 'integer', description: 'Page ID' } },
      required: ['id'],
    },
    'GET',
    (a) => `/pages/${a.id}/elementor`
  )
);

allTools.push(
  makeRestTool(
    'add_container',
    'Add a new container (section) to a page at a specific position.',
    {
      type: 'object',
      properties: {
        page_id: { type: 'integer', description: 'Page ID' },
        parent_id: { type: 'string', description: 'Parent container ID, or "root" for top level', default: 'root' },
        position: { type: 'string', enum: ['first', 'last'], default: 'last' },
        settings: { type: 'object', description: 'Container settings (flex_direction, padding, etc.)' },
        change_id: { type: 'string', description: 'Stable identifier for this change (for idempotency)' },
      },
      required: ['page_id'],
    },
    'POST',
    (a) => `/pages/${a.page_id}/elementor/containers`,
    ['parent_id', 'position', 'settings', 'change_id']
  )
);

allTools.push(
  makeRestTool(
    'add_widget',
    'Add a new widget (heading, button, image, etc.) to a container.',
    {
      type: 'object',
      properties: {
        page_id: { type: 'integer' },
        container_id: { type: 'string', description: 'Container ID where the widget will be added' },
        widget: { type: 'string', description: 'Widget type: heading, text-editor, button, image, video, icon, spacer, divider, html, shortcode' },
        position: { type: 'string', enum: ['first', 'last'], default: 'last' },
        settings: { type: 'object', description: 'Widget-specific settings' },
        change_id: { type: 'string' },
      },
      required: ['page_id', 'container_id', 'widget'],
    },
    'POST',
    (a) => `/pages/${a.page_id}/elementor/widgets`,
    ['container_id', 'widget', 'position', 'settings', 'change_id']
  )
);

allTools.push(
  makeRestTool(
    'update_widget',
    'Update the settings of an existing Elementor widget or container.',
    {
      type: 'object',
      properties: {
        page_id: { type: 'integer' },
        element_id: { type: 'string', description: 'The element ID to update' },
        settings: { type: 'object', description: 'New settings (merged with existing)' },
        change_id: { type: 'string' },
      },
      required: ['page_id', 'element_id', 'settings'],
    },
    'PATCH',
    (a) => `/pages/${a.page_id}/elementor/widgets/${a.element_id}`,
    ['settings', 'change_id']
  )
);

allTools.push(
  makeRestTool(
    'delete_element',
    'Delete an Elementor element and all its children.',
    {
      type: 'object',
      properties: {
        page_id: { type: 'integer' },
        element_id: { type: 'string' },
        change_id: { type: 'string' },
      },
      required: ['page_id', 'element_id'],
    },
    'DELETE',
    (a) => `/pages/${a.page_id}/elementor/elements/${a.element_id}`,
    ['change_id']
  )
);

allTools.push(
  makeRestTool(
    'duplicate_element',
    'Duplicate an Elementor element (generates new IDs for it and its children).',
    {
      type: 'object',
      properties: {
        page_id: { type: 'integer' },
        element_id: { type: 'string' },
        change_id: { type: 'string' },
      },
      required: ['page_id', 'element_id'],
    },
    'POST',
    (a) => `/pages/${a.page_id}/elementor/elements/${a.element_id}/duplicate`,
    ['change_id']
  )
);

allTools.push(
  makeRestTool(
    'move_element',
    'Move an Elementor element to a different parent or position.',
    {
      type: 'object',
      properties: {
        page_id: { type: 'integer' },
        element_id: { type: 'string' },
        parent_id: { type: 'string' },
        position: { type: 'integer', description: 'Index in the parent\'s elements array (use -1 for last)' },
        change_id: { type: 'string' },
      },
      required: ['page_id', 'element_id', 'parent_id'],
    },
    'POST',
    (a) => `/pages/${a.page_id}/elementor/elements/${a.element_id}/move`,
    ['parent_id', 'position', 'change_id']
  )
);

// ─────────────────────────────────────────────────────────────────
// Templates tools
// ─────────────────────────────────────────────────────────────────
allTools.push(
  makeRestTool(
    'list_templates',
    'List available Elementor templates (sections, pages, blocks).',
    {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Filter by type (section, page, container, etc.)' },
        per_page: { type: 'integer', default: 50 },
      },
    },
    'GET',
    () => '/templates'
  )
);

allTools.push(
  makeRestTool(
    'get_template',
    'Get a single Elementor template including its full structure.',
    {
      type: 'object',
      properties: { id: { type: 'integer', description: 'Template ID' } },
      required: ['id'],
    },
    'GET',
    (a) => `/templates/${a.id}`
  )
);

allTools.push(
  makeRestTool(
    'use_template',
    'Clone an existing Elementor template structure into a page. Returns new_element_ids (string[]) — the fresh IDs of every cloned element, in order. Use {{element_id:N}} in subsequent operations (replace_image, update_widget, delete_element, …) to reference a specific cloned element. NEVER reuse IDs from get_template — they are stale. CRITICAL: when the user mentions a template by NAME, first call list_templates?search=<name> to find the exact id; do NOT guess or pick the first template in the list.',
    {
      type: 'object',
      properties: {
        page_id: { type: 'integer', description: 'Target page ID' },
        template_id: { type: 'integer', description: 'Source template ID (use list_templates?search=<name> to find by name)' },
        position: { type: 'string', enum: ['first', 'last'], default: 'last' },
        change_id: { type: 'string' },
      },
      required: ['page_id', 'template_id'],
    },
    'POST',
    (a) => `/pages/${a.page_id}/elementor/use-template`,
    ['template_id', 'position', 'change_id']
  )
);

// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
// Media tools
// ─────────────────────────────────────────────────────────────────

/**
 * G6 fix: `upload_media` requiere multipart/form-data, que `makeRestTool` (que
 * siempre serializa JSON) no soporta. Por eso es un handler custom.
 *
 * Acepta:
 *   - `file_path`: ruta absoluta al archivo a subir.
 *   - `title` / `alt` / `caption`: metadatos opcionales.
 *
 * Devuelve el attachment normalizado que retorna el plugin.
 */
allTools.push({
  name: 'upload_media',
  description: 'Upload a file to the WordPress media library (multipart/form-data). file_path must be an absolute path on the orchestrator host.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to the file to upload' },
      title: { type: 'string', description: 'Optional media title' },
      alt: { type: 'string', description: 'Optional alt text' },
      caption: { type: 'string', description: 'Optional caption' },
      change_id: { type: 'string' },
    },
    required: ['file_path'],
  },
  async execute(site, args, changeId) {
    const filePath = String(args.file_path ?? '');
    if (!filePath) {
      throw new WpError('INVALID_REQUEST', 'file_path is required.', null, 400);
    }

    let buffer: Buffer;
    let filename: string;
    let mimeType: string;
    try {
      buffer = readFileSync(filePath);
      filename = filePath.split(/[\\/]/).pop() ?? 'upload.bin';
      // Heurística simple de MIME; el plugin también puede detectarlo.
      const ext = filename.split('.').pop()?.toLowerCase();
      mimeType =
        ext === 'png' ? 'image/png' :
        ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
        ext === 'gif' ? 'image/gif' :
        ext === 'webp' ? 'image/webp' :
        ext === 'svg' ? 'image/svg+xml' :
        ext === 'pdf' ? 'application/pdf' :
        'application/octet-stream';
    } catch (err) {
      throw new WpError('FILE_READ_ERROR', `Cannot read file: ${(err as Error).message}`, null, 400);
    }

    // Construir multipart manualmente para tener control sobre los headers.
    const boundary = `----ai-boundary-${Date.now().toString(36)}`;
    const parts: Buffer[] = [];

    function appendField(name: string, value: string): void {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        'utf-8'
      ));
    }

    appendField('title', String(args.title ?? filename));
    if (args.alt) appendField('alt', String(args.alt));
    if (args.caption) appendField('caption', String(args.caption));

    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
      'utf-8'
    ));
    parts.push(buffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8'));

    const body = Buffer.concat(parts);
    const url = new URL('/wp-json/ai-agent/v1/media', site.url);

    const headers: Record<string, string> = {
      'X-AI-Agent-Key': site.apiKey,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
      'Accept': 'application/json',
    };
    if (changeId) {
      headers['X-AI-Agent-Change-Id'] = changeId;
    }

    logger.debug({ url: url.toString(), filename, size: buffer.length }, 'Uploading media');

    const response = await fetch(url.toString(), { method: 'POST', headers, body });
    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new WpError('INVALID_RESPONSE', `WP returned non-JSON (HTTP ${response.status})`, text.slice(0, 500), response.status);
    }

    if (!response.ok) {
      const err = (json as { error?: { code: string; message: string } })?.error;
      throw new WpError(err?.code ?? 'HTTP_ERROR', err?.message ?? `HTTP ${response.status}`, null, response.status);
    }

    const wrapped = json as { success: boolean; data?: unknown; error?: { code: string; message: string } };
    if (wrapped?.success === false) {
      throw new WpError(wrapped.error?.code ?? 'UNKNOWN', wrapped.error?.message ?? 'Unknown error', null, response.status);
    }

    return wrapped.data;
  },
});

allTools.push(
  makeRestTool(
    'search_media',
    'Search the WordPress media library.',
    {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search query' },
        per_page: { type: 'integer', default: 20 },
      },
    },
    'GET',
    () => '/media'
  )
);

allTools.push(
  makeRestTool(
    'get_media',
    'Get a single media item by ID.',
    {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
    },
    'GET',
    (a) => `/media/${a.id}`
  )
);

allTools.push(
  makeRestTool(
    'replace_image',
    'Replace an image widget\'s image with another from the media library. The plugin resolves the media_id to a URL and writes settings.image={id,url}.',
    {
      type: 'object',
      properties: {
        page_id: { type: 'integer' },
        element_id: { type: 'string', description: 'Image widget ID' },
        media_id: { type: 'integer', description: 'New image attachment ID' },
        change_id: { type: 'string' },
      },
      required: ['page_id', 'element_id', 'media_id'],
    },
    'PATCH',
    (a) => `/pages/${a.page_id}/elementor/widgets/${a.element_id}`,
    ['media_id', 'change_id']
  )
);

allTools.push(
  makeRestTool(
    'convert_to_containers',
    'Migrate a page from the legacy section+column layout to the modern container (flex) layout. Creates a snapshot for rollback.',
    {
      type: 'object',
      properties: {
        page_id: { type: 'integer' },
        create_snapshot: { type: 'boolean', default: true },
        change_id: { type: 'string' },
      },
      required: ['page_id'],
    },
    'POST',
    (a) => `/pages/${a.page_id}/elementor/convert-to-containers`,
    ['create_snapshot', 'change_id']
  )
);

// ─────────────────────────────────────────────────────────────────
// Global Widgets
// ─────────────────────────────────────────────────────────────────

allTools.push(
  makeRestTool(
    'list_global_widgets',
    'List Elementor Global Widgets (reusable widgets stored as elementor_library posts).',
    {
      type: 'object',
      properties: {
        search: { type: 'string' },
        per_page: { type: 'integer', default: 50 },
      },
    },
    'GET',
    () => '/global-widgets'
  )
);

allTools.push(
  makeRestTool(
    'create_global_widget',
    'Create a new Global Widget from scratch with the given type and settings.',
    {
      type: 'object',
      properties: {
        title: { type: 'string' },
        widget_type: { type: 'string', description: 'heading, button, image, etc.' },
        settings: { type: 'object' },
        change_id: { type: 'string' },
      },
      required: ['title', 'widget_type'],
    },
    'POST',
    () => '/global-widgets',
    ['title', 'widget_type', 'settings', 'change_id']
  )
);

allTools.push(
  makeRestTool(
    'delete_global_widget',
    'Delete an Elementor Global Widget by ID.',
    {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
    },
    'DELETE',
    (a) => `/global-widgets/${a.id}`
  )
);

allTools.push(
  makeRestTool(
    'promote_to_global_widget',
    'Promote an existing widget on a page to a Global Widget. Optionally replaces it with a reference.',
    {
      type: 'object',
      properties: {
        page_id: { type: 'integer' },
        element_id: { type: 'string' },
        title: { type: 'string' },
        replace_in_page: { type: 'boolean', default: false },
        change_id: { type: 'string' },
      },
      required: ['page_id', 'element_id'],
    },
    'POST',
    (a) => `/pages/${a.page_id}/elementor/promote-global-widget`,
    ['title', 'replace_in_page', 'change_id']
  )
);

allTools.push(
  makeRestTool(
    'insert_global_widget',
    'Insert a reference to an existing Global Widget into a container on a page.',
    {
      type: 'object',
      properties: {
        page_id: { type: 'integer' },
        template_id: { type: 'integer', description: 'The Global Widget ID to insert' },
        container_id: { type: 'string', default: 'root' },
        position: { type: 'string', enum: ['first', 'last'], default: 'last' },
        change_id: { type: 'string' },
      },
      required: ['page_id', 'template_id'],
    },
    'POST',
    (a) => `/pages/${a.page_id}/elementor/insert-global-widget`,
    ['template_id', 'container_id', 'position', 'change_id']
  )
);

// ─────────────────────────────────────────────────────────────────
// WP-CLI Bridge (whitelisted commands only)
// ─────────────────────────────────────────────────────────────────

allTools.push(
  makeRestTool(
    'cli_list_whitelist',
    'List the whitelisted wp-cli commands available via the bridge.',
    { type: 'object', properties: {} },
    'GET',
    () => '/cli/whitelist'
  )
);

allTools.push(
  makeRestTool(
    'cli_exec',
    'Execute a whitelisted wp-cli command (flush CSS, replace URLs, sync library, clear theme builder conditions, flush cache, flush rewrites). Command must be on the whitelist; arbitrary commands are rejected.',
    {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          enum: [
            'wp elementor flush-css',
            'wp elementor replace-urls',
            'wp elementor library sync',
            'wp elementor-pro clear-theme-builder-conditions',
            'wp cache flush',
            'wp rewrite flush',
          ],
        },
        args: {
          type: 'object',
          description: 'Arguments for the command (e.g. {old, new} for replace-urls)',
        },
      },
      required: ['command'],
    },
    'POST',
    () => '/cli/exec',
    ['args']
  )
);

allTools.push(
  makeRestTool(
    'set_featured_image',
    'Set the page\'s featured image (post thumbnail). Pass media_id=0 (or null) to clear the current thumbnail.',
    {
      type: 'object',
      properties: {
        page_id: { type: 'integer' },
        media_id: { type: 'integer', description: 'Attachment ID. 0 or null to clear the thumbnail.' },
        change_id: { type: 'string' },
      },
      required: ['page_id'],
    },
    'POST',
    (a) => `/pages/${a.page_id}/thumbnail`,
    ['media_id', 'change_id']
  )
);

// ─────────────────────────────────────────────────────────────────
// Design system tools
// ─────────────────────────────────────────────────────────────────
allTools.push(
  makeRestTool(
    'get_design_system',
    'Get the site\'s design system: global colors, fonts, spacing.',
    { type: 'object', properties: {} },
    'GET',
    () => '/design-system'
  )
);

allTools.push(
  makeRestTool(
    'get_site_settings',
    'Get general site settings (name, tagline, language, admin email, timezone).',
    { type: 'object', properties: {} },
    'GET',
    () => '/site-settings'
  )
);

// ─────────────────────────────────────────────────────────────────
// History tools
// ─────────────────────────────────────────────────────────────────
allTools.push(
  makeRestTool(
    'get_change_history',
    'Get the audit log of changes made by the agent.',
    {
      type: 'object',
      properties: {
        page_id: { type: 'integer' },
        limit: { type: 'integer', default: 50 },
      },
    },
    'GET',
    () => '/audit'
  )
);

allTools.push(
  makeRestTool(
    'rollback_changes',
    'Rollback a previous change using its change_id.',
    {
      type: 'object',
      properties: {
        change_id: { type: 'string', description: 'The change_id from the audit log' },
      },
      required: ['change_id'],
    },
    'POST',
    (a) => `/changes/${a.change_id}/rollback`,
    []
  )
);

// ─────────────────────────────────────────────────────────────────
// Registry público
// ─────────────────────────────────────────────────────────────────
export const toolRegistry = new Map<string, ToolHandler>(
  allTools.map((t) => [t.name, t])
);

export function getToolsForLLM(): ToolDefinition[] {
  return allTools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

export function getTool(name: string): ToolHandler | undefined {
  return toolRegistry.get(name);
}
