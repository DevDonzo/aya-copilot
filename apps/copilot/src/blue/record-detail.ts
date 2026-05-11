import { config } from "../config.js";
import { fetchRecordDetail } from "../modules/blue/graphql/client.js";

interface DetailField {
  label: string;
  type: string;
  id: string;
  value: string;
}

export interface BlueRecordDetail {
  id: string;
  title: string;
  list: string;
  status: string;
  description: string;
  startedAt: string | null;
  dueAt: string | null;
  commentsCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  customFields: DetailField[];
  contact: {
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    uniqueId: string;
  };
  assignees: Array<{
    id: string;
    name: string;
    email: string;
  }>;
  tags: string[];
  recentActivity: Array<{
    id: string;
    category: string;
    occurredAt: string;
    actor: string;
    commentText: string | null;
    summary: string;
  }>;
}

export async function getBlueRecordDetail(recordId: string) {
  const { record, comments } = await fetchRecordDetail(
    config.BLUE_WORKSPACE_ID,
    recordId,
  );

  if (!record) {
    throw new Error(`Blue record ${recordId} not found`);
  }

  const customFields = (record.customFields ?? []).map((field) => ({
    id: String((field as { id?: string }).id ?? ""),
    label: String((field as { name?: string }).name ?? ""),
    type: String((field as { type?: string }).type ?? ""),
    value: normalizeFieldValue((field as { value?: unknown }).value),
  })) satisfies DetailField[];

  const recentActivity = comments.slice(0, 12).map((comment) => ({
    id: comment.id,
    category: "COMMENT_CREATED",
    occurredAt: comment.updatedAt ?? comment.createdAt,
    actor: formatActor(comment.user),
    commentText: comment.text ?? null,
    summary: comment.text ?? "Comment updated",
  }));

  const contact = pickContactFields(customFields);
  const assignees = (record.users ?? []).map((user) => ({
    id: user.id,
    name: formatActor(user),
    email: user.email ?? "",
  }));
  const tags = (record.tags ?? []).map((tag) => tag.title).filter(Boolean);

  return {
    id: record.id,
    title: record.title,
    list: record.todoList.title,
    status: record.archived ? "Archived" : record.done ? "Completed" : "Active",
    description: record.text ?? "",
    startedAt: record.startedAt ?? null,
    dueAt: record.duedAt ?? null,
    commentsCount: record.commentCount ?? comments.length,
    createdAt: record.createdAt ?? null,
    updatedAt: record.updatedAt ?? null,
    customFields,
    contact,
    assignees,
    tags,
    recentActivity,
  } satisfies BlueRecordDetail;
}

function pickContactFields(fields: DetailField[]) {
  const contact = {
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    uniqueId: "",
  };

  for (const field of fields) {
    const label = field.label.toLowerCase();
    if (label === "first name") {
      contact.firstName = field.value;
    } else if (label === "last name") {
      contact.lastName = field.value;
    } else if (label === "phone") {
      contact.phone = field.value;
    } else if (label === "email") {
      contact.email = field.value;
    } else if (label === "unique id") {
      contact.uniqueId = field.value;
    }
  }

  return contact;
}

function normalizeFieldValue(value: unknown) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value === "(empty)" ? "" : value;
  }
  return JSON.stringify(value);
}

function formatActor(
  actor:
    | {
        fullName?: string;
        firstName?: string;
        lastName?: string;
        email?: string;
      }
    | null
    | undefined,
) {
  if (!actor) {
    return "Unknown";
  }

  return (
    actor.fullName ||
    [actor.firstName, actor.lastName].filter(Boolean).join(" ").trim() ||
    actor.email ||
    "Unknown"
  );
}
