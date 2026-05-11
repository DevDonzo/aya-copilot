import type { Generated } from "kysely";

export interface EmployeesTable {
  id: string;
  display_name: string;
  email: string | null;
  role_name: string | null;
  timezone: string | null;
  active: Generated<number>;
  created_at: Generated<string>;
}

export interface IdentityLinksTable {
  id: string;
  employee_id: string;
  source: string;
  external_id: string;
  external_label: string | null;
  created_at: Generated<string>;
}

export interface EmployeeCredentialsTable {
  employee_id: string;
  password_hash: string;
  password_salt: string;
  must_reset: Generated<number>;
  updated_at: Generated<string>;
}

export interface AuthSessionsTable {
  id: string;
  employee_id: string;
  session_token: string;
  expires_at: string;
  created_at: Generated<string>;
}

export interface BlueListsCacheTable {
  id: string;
  workspace_id: string;
  title: string;
  normalized_title: string;
  stage_key: string | null;
  stage_label: string | null;
  task_count: number | null;
  position: number | null;
  updated_at: string | null;
  deleted_at: string | null;
  synced_at: Generated<string>;
}

export interface BlueRecordsCacheTable {
  id: string;
  workspace_id: string;
  list_id: string;
  list_title: string;
  title: string;
  normalized_title: string;
  contact_email: string | null;
  normalized_contact_email: string | null;
  contact_phone: string | null;
  normalized_contact_phone: string | null;
  status: string | null;
  due_at: string | null;
  updated_at: string | null;
  archived: Generated<number>;
  done: Generated<number>;
  raw_json: string | null;
  deleted_at: string | null;
  synced_at: Generated<string>;
}

export interface ActivityEventsTable {
  id: string;
  employee_id: string | null;
  workspace_id: string | null;
  project_name: string | null;
  source: string;
  source_event_id: string | null;
  action_type: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_title: string | null;
  occurred_at: string;
  summary: string;
  raw_payload: string;
  created_at: Generated<string>;
}

export interface BotAuditLogsTable {
  id: string;
  employee_id: string | null;
  transport: string;
  inbound_text: string;
  detected_intent: string | null;
  adapter: string;
  command_name: string | null;
  command_args: string | null;
  outcome: string;
  response_text: string | null;
  request_json: string | null;
  response_json: string | null;
  created_at: Generated<string>;
}

export interface DailySummariesTable {
  id: string;
  employee_id: string;
  summary_date: string;
  source_counts: string;
  action_counts: string;
  summary_text: string;
  created_at: Generated<string>;
}

export interface BlueSyncStateTable {
  workspace_id: string;
  entity_type: string;
  last_cursor: string | null;
  last_full_sync_at: string | null;
  last_incremental_sync_at: string | null;
  last_seen_updated_at: string | null;
  last_webhook_event_at: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface BlueWebhookSubscriptionsTable {
  id: string;
  workspace_id: string;
  blue_webhook_id: string;
  url: string;
  events_json: string;
  status: string | null;
  secret_ref: string | null;
  enabled: Generated<number>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface PendingRecordChoicesTable {
  employee_id: string;
  transport: string;
  continuation_action: string;
  original_query: string | null;
  pending_parameters_json: string | null;
  candidates_json: string;
  expires_at: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface ActiveRecordContextTable {
  employee_id: string;
  transport: string;
  record_id: string;
  record_title: string;
  list_title: string | null;
  expires_at: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface CopilotMemoryTable {
  employee_id: string;
  transport: string;
  conversation_key: string | null;
  current_record_id: string | null;
  current_record_title: string | null;
  current_list_title: string | null;
  recent_records_json: string;
  last_intent: string | null;
  last_message_text: string | null;
  last_response_text: string | null;
  expires_at: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface EmployeeNotificationStateTable {
  employee_id: string;
  mentions_seen_through: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface AyaDatabase {
  employees: EmployeesTable;
  identity_links: IdentityLinksTable;
  employee_credentials: EmployeeCredentialsTable;
  auth_sessions: AuthSessionsTable;
  blue_lists_cache: BlueListsCacheTable;
  blue_records_cache: BlueRecordsCacheTable;
  activity_events: ActivityEventsTable;
  bot_audit_logs: BotAuditLogsTable;
  daily_summaries: DailySummariesTable;
  blue_sync_state: BlueSyncStateTable;
  blue_webhook_subscriptions: BlueWebhookSubscriptionsTable;
  pending_record_choices: PendingRecordChoicesTable;
  active_record_context: ActiveRecordContextTable;
  copilot_memory: CopilotMemoryTable;
  employee_notification_state: EmployeeNotificationStateTable;
}
