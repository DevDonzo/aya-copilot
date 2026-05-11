export interface BlueUser {
  id: string;
  uid?: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  timezone?: string | null;
  updatedAt?: string;
}

export interface BlueTodoList {
  id: string;
  uid?: string;
  title: string;
  position: number;
  createdAt?: string;
  updatedAt: string;
}

export interface BlueTag {
  id: string;
  title: string;
  color?: string | null;
}

export interface BlueComment {
  id: string;
  uid?: string;
  text: string;
  html?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  user?: BlueUser | null;
}

export interface BlueTodoCustomField {
  id: string;
  name?: string;
  type?: string;
  value: unknown;
}

export interface BlueCustomFieldDefinition {
  id: string;
  uid?: string;
  name: string;
  type: string;
  position?: number;
}

export interface BlueRecord {
  id: string;
  uid?: string;
  title: string;
  text?: string;
  html?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  duedAt?: string | null;
  archived: boolean;
  done: boolean;
  commentCount?: number;
  todoList: BlueTodoList;
  users?: BlueUser[];
  tags?: BlueTag[];
  customFields?: BlueTodoCustomField[];
  checklists?: Array<{
    id: string;
    title: string;
    items: Array<{
      id: string;
      uid?: string;
      title: string;
      done: boolean;
      users?: BlueUser[];
    }>;
  }>;
}

export interface BlueChecklistItem {
  id: string;
  uid?: string;
  title: string;
  done: boolean;
  duedAt?: string | null;
  updatedAt: string;
  users?: BlueUser[];
  checklist: {
    id?: string;
    title: string;
    todo: {
      id: string;
      title: string;
      todoList: BlueTodoList;
    };
  };
}

export interface BlueActivityEvent {
  id: string;
  uid?: string;
  category: string;
  html?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: BlueUser | null;
  affectedBy?: BlueUser | null;
  project?: {
    id: string;
    name: string;
    slug?: string | null;
  } | null;
  todo?: {
    id: string;
    title: string;
  } | null;
  comment?: BlueComment | null;
}

export interface BlueWebhook {
  id: string;
  name?: string | null;
  url: string;
  events: BlueWebhookEventType[];
  projectIds?: string[] | null;
  enabled: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
  secret?: string | null;
}

export interface BlueActorSummary {
  id: string;
  email?: string | null;
  fullName?: string | null;
}

export interface BlueDashboardUser {
  id: string;
  role: "VIEWER" | "EDITOR" | string;
  user: BlueActorSummary;
}

export interface BlueDashboard {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  createdBy: BlueActorSummary;
  dashboardUsers?: BlueDashboardUser[] | null;
}

export interface BlueReportUser {
  id: string;
  role: "VIEWER" | "EDITOR" | string;
  user: BlueActorSummary;
}

export interface BlueReportDataSource {
  id: string;
  name?: string | null;
  sourceType: string;
  projectIds?: string[] | null;
  order: number;
}

export interface BlueReport {
  id: string;
  title: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
  lastGeneratedAt?: string | null;
  projectIds?: string[] | null;
  createdBy: BlueActorSummary;
  reportUsers: BlueReportUser[];
  dataSources: BlueReportDataSource[];
}

export interface BlueCompanyPlan {
  planId?: string | null;
  planName?: string | null;
  status?: string | null;
  isPaid?: boolean | null;
  currentPeriodEnd?: string | null;
  trialEnd?: string | null;
}

export interface BlueReportingCapability {
  configured: boolean;
  companyId: string | null;
  companyName: string | null;
  companySlug: string | null;
  subscriptionStatus: string | null;
  subscriptionActive: boolean | null;
  subscriptionTrialing: boolean | null;
  isEnterprise: boolean;
  supportsDashboards: boolean;
  supportsReports: boolean;
  plan: BlueCompanyPlan | null;
}

export interface BluePageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string | null;
  endCursor?: string | null;
  totalItems?: number | null;
  totalPages?: number | null;
  page?: number | null;
  perPage?: number | null;
}

export type BlueWebhookEventType =
  | "TODO_CREATED"
  | "TODO_DELETED"
  | "TODO_MOVED"
  | "TODO_NAME_CHANGED"
  | "TODO_DONE_STATUS_UPDATED"
  | "TODO_DUE_DATE_ADDED"
  | "TODO_DUE_DATE_UPDATED"
  | "TODO_DUE_DATE_REMOVED"
  | "TODO_ASSIGNEE_ADDED"
  | "TODO_ASSIGNEE_REMOVED"
  | "TODO_TAG_ADDED"
  | "TODO_TAG_REMOVED"
  | "TODO_CUSTOM_FIELD_UPDATED"
  | "TODO_CHECKLIST_ITEM_CREATED"
  | "TODO_CHECKLIST_ITEM_DELETED"
  | "TODO_CHECKLIST_ITEM_DUE_DATE_ADDED"
  | "TODO_CHECKLIST_ITEM_DUE_DATE_UPDATED"
  | "TODO_CHECKLIST_ITEM_DUE_DATE_REMOVED"
  | "TODO_CHECKLIST_ITEM_ASSIGNEE_ADDED"
  | "TODO_CHECKLIST_ITEM_ASSIGNEE_REMOVED"
  | "TODO_CHECKLIST_ITEM_DONE_STATUS_UPDATED"
  | "COMMENT_CREATED"
  | "COMMENT_UPDATED"
  | "COMMENT_DELETED";

export interface IndexedBlueRecord {
  id: string;
  workspaceId: string;
  listId: string;
  listTitle: string;
  title: string;
  normalizedTitle: string;
  status?: string | null;
  dueAt?: string | null;
  updatedAt?: string | null;
  archived: boolean;
  done: boolean;
  rawJson?: string | null;
}

export interface NormalizedActivityEvent {
  id: string;
  employeeId?: string;
  source: string;
  sourceEventId?: string;
  actionType: string;
  entityType?: string;
  entityId?: string;
  entityTitle?: string;
  occurredAt: string;
  summary: string;
  rawPayload: unknown;
}

export interface ResolvedEmployeeIdentity {
  employeeId: string;
  displayName: string;
  roleName: "employee" | "admin";
  blueUserId: string;
  email?: string;
}
