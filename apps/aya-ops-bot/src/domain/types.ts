export type ActivitySource =
  | "blue"
  | "blue_webhook"
  | "bot"
  | "web"
  | "whatsapp"
  | "email"
  | "calendar"
  | "phone"
  | "drive"
  | "slack";

export type IntentName =
  | "help.overview"
  | "identity.self"
  | "brief.daily"
  | "notifications.feed"
  | "activity.employee_report"
  | "activity.record_report"
  | "activity.workspace_report"
  | "assignments.report"
  | "records.exception_report"
  | "records.list_assigned"
  | "records.follow_up"
  | "records.team_follow_up"
  | "records.complete"
  | "records.search"
  | "records.detail"
  | "records.create"
  | "records.move"
  | "records.assign"
  | "records.set_due_date"
  | "tasks.assign"
  | "tasks.complete"
  | "tasks.set_due_date"
  | "comments.list_recent"
  | "comments.create"
  | "activity.list"
  | "activity.mentions"
  | "activity.user_history"
  | "summary.employee_day"
  | "summary.team_day"
  | "summary.no_activity_day"
  | "reporting.overview"
  | "reporting.question";

export interface EmployeeIdentity {
  employeeId: string;
  displayName: string;
  roleName?: string;
  blueUserId?: string;
  email?: string;
}

export interface BlueRequestAuth {
  tokenId: string;
  tokenSecret: string;
}

export interface IntentRequest {
  actor: EmployeeIdentity;
  message: string;
  originalMessage?: string;
  nowIso: string;
}

export interface IntentMatch {
  intent: IntentName;
  confidence: number;
  parameters: Record<string, string | number | boolean | undefined>;
}

export interface IntentPlan extends IntentMatch {
  requiresClarification: boolean;
  clarificationQuestion?: string;
  matchedSignals: string[];
}

export interface NormalizedActivityEvent {
  id: string;
  employeeId?: string;
  workspaceId?: string;
  projectName?: string;
  source: ActivitySource;
  sourceEventId?: string;
  actionType: string;
  entityType?: string;
  entityId?: string;
  entityTitle?: string;
  occurredAt: string;
  summary: string;
  rawPayload: unknown;
}
