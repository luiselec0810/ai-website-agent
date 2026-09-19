/**
 * Types compartidos entre frontend y orchestrator.
 */

export interface Site {
  id: string;
  name: string;
  url: string;
  status: string;
  wordpress_version?: string;
  elementor_version?: string;
  available_widgets?: string[];
  created_at?: string;
}

export interface Page {
  id: number;
  title: string;
  slug: string;
  status: string;
  url: string;
  builder: 'elementor' | 'classic';
  modified?: string;
  author?: number;
}

export interface ChangePlan {
  title: string;
  description: string;
  operations: Array<{
    tool: string;
    arguments: Record<string, unknown>;
  }>;
}

export interface Change {
  id: string;
  site_id: string;
  page_id?: number;
  title: string;
  description?: string;
  status: 'draft' | 'planned' | 'awaiting_approval' | 'approved' | 'executing' | 'completed' | 'failed' | 'rolled_back';
  created_at: string;
  approved_at?: string;
  completed_at?: string;
  operations?: Array<{
    id: string;
    tool_name: string;
    arguments: Record<string, unknown>;
    status: string;
    result?: unknown;
    error_code?: string;
    error_message?: string;
  }>;
}

export interface ToolResult {
  tool: string;
  status: 'success' | 'failed' | 'skipped';
  result?: unknown;
  error?: { code: string; message: string };
  retries: number;
}

export interface ChatResponse {
  conversation_id: string;
  type: 'answer' | 'plan' | 'clarification';
  text?: string;
  plan?: ChangePlan;
  change_id?: string;
  tool_results?: ToolResult[];
}

export interface Conversation {
  id: string;
  site_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  preview: string | null;
}

export interface ChatMessageRecord {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: unknown;
  tool_results?: unknown;
  created_at: string;
}

export interface ConversationChangeRecord {
  id: string;
  title: string;
  description: string | null;
  operations: string; // JSON string
  status: string;
  created_at: string;
}
