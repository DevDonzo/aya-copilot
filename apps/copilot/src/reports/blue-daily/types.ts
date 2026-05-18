import type { BlueRecord, BlueUser } from "../../types/blue.js";

export const BLUE_DAILY_REPORT_TYPE = "blue_daily_operations";

export interface ReportWindow {
  reportDate: string;
  timezone: string;
  startUtc: string;
  endUtc: string;
}

export interface ReportActivity {
  id: string;
  actionType: string;
  recordId: string | null;
  recordTitle: string | null;
  commenterName: string;
  commenterEmployeeId: string | null;
  occurredAt: string;
  text: string;
}

export interface ReportRecord {
  id: string;
  title: string;
  listTitle: string;
  createdAt: string | null;
  updatedAt: string | null;
  dueAt: string | null;
  archived: boolean;
  done: boolean;
  commentCount: number;
  latestCommentAt: string | null;
  users: BlueUser[];
  tags: Array<{ id: string; title: string; color?: string | null }>;
  customFields: BlueRecord["customFields"];
  text: string;
  html: string;
}

export interface NewRecordRow {
  id: string;
  clientName: string;
  list: string;
  source: string;
  createdAt: string | null;
  assignedTo: string;
  dueAt: string | null;
}

export interface AttentionRecordRow {
  id: string;
  clientName: string;
  list: string;
  assignedTo: string;
  dueAt: string | null;
  lastCommentAt: string | null;
  daysSinceComment: number | null;
  commentCount: number;
}

export interface CommentRow {
  recordId: string | null;
  clientName: string;
  assignedTo: string;
  commenter: string;
  timestamp: string;
  update: string;
  actionType: string;
}

export interface StaffStatusRow {
  staffId: string;
  staffName: string;
  openAssignedRecords: number;
  commentsPlacedYesterday: number;
  untouchedRecords: number;
}

export interface BlueDailyReportData {
  window: ReportWindow;
  generatedAt: string;
  rowCounts: Record<string, number>;
  newRecords: NewRecordRow[];
  overdueNoRecentComments: AttentionRecordRow[];
  overdueWithRecentComments: AttentionRecordRow[];
  upcomingDue: AttentionRecordRow[];
  commentsLast24Hours: CommentRow[];
  staffStatus: StaffStatusRow[];
}
