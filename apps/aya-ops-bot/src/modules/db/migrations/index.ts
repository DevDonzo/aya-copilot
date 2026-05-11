import { sqlite } from "../kysely.js";

export async function runMigrations() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      email TEXT,
      role_name TEXT,
      timezone TEXT DEFAULT 'America/Toronto',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS identity_links (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      external_label TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source, external_id),
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS employee_credentials (
      employee_id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      must_reset INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      session_token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS blue_lists_cache (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      normalized_title TEXT NOT NULL,
      stage_key TEXT,
      stage_label TEXT,
      task_count INTEGER,
      position REAL,
      updated_at TEXT,
      deleted_at TEXT,
      synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS blue_records_cache (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      list_id TEXT NOT NULL,
      list_title TEXT NOT NULL,
      title TEXT NOT NULL,
      normalized_title TEXT NOT NULL,
      contact_email TEXT,
      normalized_contact_email TEXT,
      contact_phone TEXT,
      normalized_contact_phone TEXT,
      status TEXT,
      due_at TEXT,
      updated_at TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT,
      deleted_at TEXT,
      synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS activity_events (
      id TEXT PRIMARY KEY,
      employee_id TEXT,
      workspace_id TEXT,
      project_name TEXT,
      source TEXT NOT NULL,
      source_event_id TEXT,
      action_type TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      entity_title TEXT,
      occurred_at TEXT NOT NULL,
      summary TEXT NOT NULL,
      raw_payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source, source_event_id),
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS bot_audit_logs (
      id TEXT PRIMARY KEY,
      employee_id TEXT,
      transport TEXT NOT NULL,
      inbound_text TEXT NOT NULL,
      detected_intent TEXT,
      adapter TEXT NOT NULL,
      command_name TEXT,
      command_args TEXT,
      outcome TEXT NOT NULL,
      response_text TEXT,
      request_json TEXT,
      response_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS daily_summaries (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      summary_date TEXT NOT NULL,
      source_counts TEXT NOT NULL,
      action_counts TEXT NOT NULL,
      summary_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(employee_id, summary_date),
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS blue_sync_state (
      workspace_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      last_cursor TEXT,
      last_full_sync_at TEXT,
      last_incremental_sync_at TEXT,
      last_seen_updated_at TEXT,
      last_webhook_event_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, entity_type)
    );

    CREATE TABLE IF NOT EXISTS blue_webhook_subscriptions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      blue_webhook_id TEXT NOT NULL UNIQUE,
      url TEXT NOT NULL,
      events_json TEXT NOT NULL,
      status TEXT,
      secret_ref TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pending_record_choices (
      employee_id TEXT PRIMARY KEY,
      transport TEXT NOT NULL,
      continuation_action TEXT NOT NULL,
      original_query TEXT,
      pending_parameters_json TEXT,
      candidates_json TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS active_record_context (
      employee_id TEXT PRIMARY KEY,
      transport TEXT NOT NULL,
      record_id TEXT NOT NULL,
      record_title TEXT NOT NULL,
      list_title TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS copilot_memory (
      employee_id TEXT PRIMARY KEY,
      transport TEXT NOT NULL,
      conversation_key TEXT,
      current_record_id TEXT,
      current_record_title TEXT,
      current_list_title TEXT,
      recent_records_json TEXT NOT NULL DEFAULT '[]',
      last_intent TEXT,
      last_message_text TEXT,
      last_response_text TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS employee_notification_state (
      employee_id TEXT PRIMARY KEY,
      mentions_seen_through TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    );

    CREATE INDEX IF NOT EXISTS idx_blue_lists_cache_workspace
      ON blue_lists_cache(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_blue_lists_cache_normalized
      ON blue_lists_cache(workspace_id, normalized_title);
    CREATE INDEX IF NOT EXISTS idx_blue_records_cache_workspace
      ON blue_records_cache(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_blue_records_cache_list
      ON blue_records_cache(workspace_id, list_id);
    CREATE INDEX IF NOT EXISTS idx_blue_records_cache_normalized
      ON blue_records_cache(workspace_id, normalized_title);
    CREATE INDEX IF NOT EXISTS idx_activity_events_employee_day
      ON activity_events(employee_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_bot_audit_logs_employee_day
      ON bot_audit_logs(employee_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_pending_record_choices_expires_at
      ON pending_record_choices(expires_at);
    CREATE INDEX IF NOT EXISTS idx_active_record_context_expires_at
      ON active_record_context(expires_at);
    CREATE INDEX IF NOT EXISTS idx_copilot_memory_expires_at
      ON copilot_memory(expires_at);
  `);

  ensureColumn("employees", "email", "TEXT");
  ensureColumn("blue_lists_cache", "updated_at", "TEXT");
  ensureColumn("blue_lists_cache", "deleted_at", "TEXT");
  ensureColumn("blue_records_cache", "updated_at", "TEXT");
  ensureColumn("blue_records_cache", "contact_email", "TEXT");
  ensureColumn("blue_records_cache", "normalized_contact_email", "TEXT");
  ensureColumn("blue_records_cache", "contact_phone", "TEXT");
  ensureColumn("blue_records_cache", "normalized_contact_phone", "TEXT");
  ensureColumn("blue_records_cache", "archived", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("blue_records_cache", "done", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("blue_records_cache", "raw_json", "TEXT");
  ensureColumn("blue_records_cache", "deleted_at", "TEXT");
  ensureColumn("bot_audit_logs", "request_json", "TEXT");
  ensureColumn("bot_audit_logs", "response_json", "TEXT");
  ensureColumn("activity_events", "workspace_id", "TEXT");
  ensureColumn("activity_events", "project_name", "TEXT");

  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_blue_records_cache_contact_email
      ON blue_records_cache(workspace_id, normalized_contact_email);
    CREATE INDEX IF NOT EXISTS idx_blue_records_cache_contact_phone
      ON blue_records_cache(workspace_id, normalized_contact_phone);
  `);
}

function ensureColumn(
  tableName: string,
  columnName: string,
  definition: string,
) {
  const rows = sqlite
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === columnName)) {
    return;
  }

  sqlite.exec(
    `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`,
  );
}
