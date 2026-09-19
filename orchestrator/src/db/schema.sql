-- ─────────────────────────────────────────────────────────────────
-- AI Orchestrator - SQLite schema
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  wordpress_version TEXT,
  elementor_version TEXT,
  last_health_check DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,  -- 'user' | 'assistant' | 'system' | 'tool'
  content TEXT NOT NULL DEFAULT '',
  tool_calls TEXT,  -- JSON
  tool_results TEXT,  -- JSON
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

-- Changes: Change Plans con su estado (SRS §21)
CREATE TABLE IF NOT EXISTS changes (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  page_id INTEGER,
  conversation_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  operations TEXT NOT NULL DEFAULT '[]',  -- JSON array
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | planned | awaiting_approval | approved | executing | completed | failed | rolled_back
  error_code TEXT,
  error_message TEXT,
  before_state TEXT,  -- JSON snapshot
  after_state TEXT,   -- JSON snapshot
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at DATETIME,
  completed_at DATETIME,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_changes_site ON changes(site_id, created_at);
CREATE INDEX IF NOT EXISTS idx_changes_status ON changes(status);

-- Change operations: cada tool ejecutada dentro de un change
CREATE TABLE IF NOT EXISTS change_operations (
  id TEXT PRIMARY KEY,
  change_id TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,  -- para idempotencia
  tool_name TEXT NOT NULL,
  arguments TEXT NOT NULL,  -- JSON
  result TEXT,  -- JSON
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | executing | success | failed | skipped
  error_code TEXT,
  error_message TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  executed_at DATETIME,
  FOREIGN KEY (change_id) REFERENCES changes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_change_ops_change ON change_operations(change_id);
CREATE INDEX IF NOT EXISTS idx_change_ops_opid ON change_operations(operation_id);
