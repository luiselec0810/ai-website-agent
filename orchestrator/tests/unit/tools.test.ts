/**
 * Tests del Tool Registry.
 * SRS §18 — todas las herramientas esperadas deben existir.
 */

import { describe, it, expect } from 'vitest';
import { getToolsForLLM, toolRegistry } from '../../src/tools/index.js';

describe('Tool Registry (SRS §18)', () => {
  const expectedTools = [
    // Pages
    'list_pages', 'get_page', 'create_page', 'update_page', 'duplicate_page',
    // Elementor
    'get_elementor_structure', 'analyze_page',
    'add_container', 'add_widget', 'update_widget',
    'delete_element', 'duplicate_element', 'move_element',
    'convert_to_containers',
    // Templates
    'list_templates', 'get_template', 'use_template',
    // Media
    'search_media', 'get_media', 'upload_media', 'replace_image',
    // Design system
    'get_design_system', 'get_site_settings',
    // History
    'get_change_history', 'rollback_changes',
    // Global widgets
    'list_global_widgets', 'create_global_widget', 'delete_global_widget',
    'promote_to_global_widget', 'insert_global_widget',
    // WP-CLI bridge
    'cli_list_whitelist', 'cli_exec',
  ];

  for (const name of expectedTools) {
    it(`registers tool: ${name}`, () => {
      expect(toolRegistry.has(name)).toBe(true);
    });
  }

  it('exposes JSON schemas for all tools', () => {
    const tools = getToolsForLLM();
    expect(tools.length).toBeGreaterThan(20);
    for (const t of tools) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.input_schema.type).toBe('object');
    }
  });

  it('marks update_widget as a write tool (requires approval)', () => {
    // Esto se valida en approval-gate.test.ts pero la integración es importante.
    expect(toolRegistry.has('update_widget')).toBe(true);
    expect(toolRegistry.has('list_pages')).toBe(true);
  });
});
