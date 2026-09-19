/**
 * Approval Gate.
 *
 * Enforce human-in-the-loop: ninguna tool de ESCRITURA puede ejecutarse
 * si el change no está en estado `approved`.
 *
 * Tools de LECTURA (get_*, list_*, search_*, analyze_*) siempre se permiten.
 */

export type ChangeStatus =
  | 'draft'
  | 'planned'
  | 'awaiting_approval'
  | 'approved'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'rolled_back'
  | string; // accept other strings from DB

// Tools que SIEMPRE se permiten (no requieren aprobación).
const READ_ONLY_TOOLS = new Set([
  'list_pages',
  'get_page',
  'get_elementor_structure',
  'analyze_page',
  'list_templates',
  'get_template',
  'search_media',
  'get_media',
  'get_design_system',
  'get_site_settings',
  'get_change_history',
]);

// Tools que requieren aprobación humana.
const WRITE_TOOLS = new Set([
  'create_page',
  'update_page',
  'duplicate_page',
  'add_container',
  'add_widget',
  'update_widget',
  'delete_element',
  'duplicate_element',
  'move_element',
  'use_template',
  'upload_media',
  'replace_image',
  'set_featured_image',
  'rollback_changes',
  'convert_to_containers',
  'create_global_widget',
  'delete_global_widget',
  'promote_to_global_widget',
  'insert_global_widget',
  'cli_exec',
]);

// Read-only tools adicionales para whitelist inspection.
const READ_ONLY_TOOLS_EXTRA = new Set([
  'list_global_widgets',
  'cli_list_whitelist',
]);

export class ApprovalGate {
  constructor(private status: ChangeStatus) {}

  canExecute(toolName: string): boolean {
    if (READ_ONLY_TOOLS.has(toolName) || READ_ONLY_TOOLS_EXTRA.has(toolName)) {
      return true;
    }
    if (WRITE_TOOLS.has(toolName)) {
      return this.status === 'approved' || this.status === 'executing';
    }
    // Tool desconocida: por defecto denegar.
    return false;
  }

  requireApproval(toolName: string): void {
    if (!this.canExecute(toolName)) {
      throw new Error(
        `Tool "${toolName}" cannot be executed: change status is "${this.status}". ` +
        `Write tools require status "approved". ` +
        `Current status is "${this.status}" — the user must approve the change first.`
      );
    }
  }

  isWriteTool(toolName: string): boolean {
    return WRITE_TOOLS.has(toolName);
  }

  isReadOnlyTool(toolName: string): boolean {
    return READ_ONLY_TOOLS.has(toolName) || READ_ONLY_TOOLS_EXTRA.has(toolName);
  }
}
