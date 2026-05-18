import { config } from "../../../config.js";
import { ExternalServiceError, ValidationError } from "../../../app/errors.js";
import { logger } from "../../../lib/logger.js";
import { buildBlueCommentContent } from "../comment-content.js";
import type {
  BlueActivityEvent,
  BlueDashboard,
  BlueComment,
  BlueChecklistItem,
  BlueCompanyPlan,
  BluePageInfo,
  BlueReportingCapability,
  BlueCustomFieldDefinition,
  BlueRecord,
  BlueReport,
  BlueTodoList,
  BlueUser,
  BlueWebhook,
  BlueWebhookEventType,
} from "../../../types/blue.js";
import type { BlueRequestAuth } from "../../../domain/types.js";

type GraphqlResponse<T> = {
  data?: T;
  errors?: Array<{
    message: string;
    extensions?: Record<string, unknown>;
  }>;
};

class RequestQueue {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly concurrency: number) {}

  async run<T>(task: () => Promise<T>) {
    if (this.active >= this.concurrency) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }

    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

const requestQueue = new RequestQueue(config.BLUE_GRAPHQL_MAX_CONCURRENCY);

export async function blueGraphqlRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
  options?: {
    projectId?: string;
    auth?: BlueRequestAuth | null;
  },
): Promise<T> {
  const credentials = resolveGraphqlCredentials(options?.auth);

  return await requestQueue.run(async () => {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= config.BLUE_GRAPHQL_RETRY_ATTEMPTS; attempt += 1) {
      const startedAt = Date.now();
      try {
        const response = await fetch(config.BLUE_API_URL, {
          method: "POST",
          signal: AbortSignal.timeout(config.BLUE_GRAPHQL_TIMEOUT_MS),
          headers: {
            "content-type": "application/json",
            "x-bloo-token-id": credentials.clientId,
            "x-bloo-token-secret": credentials.authToken,
            "x-bloo-company-id": credentials.companyId,
            ...(options?.projectId
              ? { "x-bloo-project-id": options.projectId }
              : {}),
          },
          body: JSON.stringify({ query, variables }),
        });
        const payload = (await response.json()) as GraphqlResponse<T>;

        if (response.status === 429 || response.status >= 500) {
          throw new ExternalServiceError(
            `Blue GraphQL request failed with status ${response.status}`,
            payload.errors,
          );
        }

        if (payload.errors?.length) {
          const first = payload.errors[0];
          const message = first?.message ?? "Blue GraphQL request failed";
          const code = String(first?.extensions?.code ?? "");
          if (isRetryableGraphqlError(code, message)) {
            throw new ExternalServiceError(message, first);
          }

          throw new ExternalServiceError(message, first);
        }

        if (!payload.data) {
          throw new ExternalServiceError("Blue GraphQL response had no data");
        }

        const elapsedMs = Date.now() - startedAt;
        logger.info(
          {
            blueGraphql: {
              elapsedMs,
              projectId: options?.projectId ?? null,
              operation: getOperationLabel(query),
            },
          },
          "blue graphql ok",
        );
        return payload.data;
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error("Unknown Blue GraphQL error");

        logger.warn(
          {
            err: lastError,
            blueGraphql: {
              attempt,
              projectId: options?.projectId ?? null,
              operation: getOperationLabel(query),
            },
          },
          "blue graphql request failed",
        );

        if (attempt >= config.BLUE_GRAPHQL_RETRY_ATTEMPTS) {
          break;
        }

        const retryAfterMs = getRetryAfterMs(lastError);
        const delayMs =
          retryAfterMs ??
          config.BLUE_GRAPHQL_RETRY_BASE_MS * 2 ** (attempt - 1) +
            Math.floor(Math.random() * 150);
        await sleep(delayMs);
      }
    }

    throw new ExternalServiceError(
      lastError?.message ?? "Blue GraphQL request failed",
    );
  });
}

export async function fetchWorkspaceUsers(workspaceId: string) {
  const items: BlueUser[] = [];
  let skip = 0;
  const pageSize = 100;

  while (true) {
    const data = await blueGraphqlRequest<{
      projectUserList: {
        users: BlueUser[];
        totalCount: number;
        pageInfo: {
          hasNextPage: boolean;
        };
      };
    }>(
      `
        query WorkspaceUsers($projectId: String!, $skip: Int!, $first: Int!) {
          projectUserList(projectId: $projectId, skip: $skip, first: $first, orderBy: firstName_ASC) {
            users {
              id
              uid
              email
              firstName
              lastName
              fullName
              timezone
              updatedAt
            }
            totalCount
            pageInfo {
              hasNextPage
            }
          }
        }
      `,
      {
        projectId: workspaceId,
        skip,
        first: pageSize,
      },
      { projectId: workspaceId },
    );

    const pageItems = data.projectUserList.users;
    items.push(...pageItems);
    if (!data.projectUserList.pageInfo.hasNextPage || pageItems.length < pageSize) {
      break;
    }
    skip += pageSize;
  }

  return items;
}

export async function fetchCompanyUsers(companyId: string) {
  const items: BlueUser[] = [];
  let skip = 0;
  const pageSize = 100;

  while (true) {
    const data = await blueGraphqlRequest<{
      companyUserList: {
        users: BlueUser[];
        totalCount: number;
        pageInfo: {
          hasNextPage: boolean;
        };
      };
    }>(
      `
        query CompanyUsers($companyId: String!, $skip: Int!, $first: Int!) {
          companyUserList(companyId: $companyId, skip: $skip, first: $first, orderBy: firstName_ASC) {
            users {
              id
              uid
              email
              firstName
              lastName
              fullName
              timezone
              updatedAt
            }
            totalCount
            pageInfo {
              hasNextPage
            }
          }
        }
      `,
      {
        companyId,
        skip,
        first: pageSize,
      },
    );

    const pageItems = data.companyUserList.users;
    items.push(...pageItems);
    if (!data.companyUserList.pageInfo.hasNextPage || pageItems.length < pageSize) {
      break;
    }
    skip += pageSize;
  }

  return items;
}

export async function fetchWorkspaceLists(input: {
  workspaceId: string;
  updatedAfter?: string | null;
  auth?: BlueRequestAuth | null;
}) {
  const data = await blueGraphqlRequest<{
    todoLists: Array<BlueTodoList & { todosCount: number }>;
  }>(
    `
      query WorkspaceLists($projectId: String!) {
        todoLists(projectId: $projectId) {
          id
          uid
          title
          position
          createdAt
          updatedAt
          todosCount
        }
      }
    `,
    {
      projectId: input.workspaceId,
    },
    { projectId: input.workspaceId, auth: input.auth },
  );

  return data.todoLists;
}

export async function fetchWorkspaceListRecords(input: {
  workspaceId: string;
  listId: string;
  updatedAfter?: string | null;
  auth?: BlueRequestAuth | null;
}) {
  const items: BlueRecord[] = [];
  let skip = 0;

  while (true) {
    const data = await blueGraphqlRequest<{
      todoList: {
        id: string;
        title: string;
        todos: BlueRecord[];
      } | null;
    }>(
      `
        query WorkspaceListRecords(
          $listId: String!,
          $skip: Int!,
          $first: Int!
        ) {
          todoList(id: $listId) {
            id
            title
            todos(orderBy: updatedAt_DESC, skip: $skip, first: $first) {
              id
              uid
              title
              text
              html
              startedAt
              duedAt
              commentCount
              archived
              done
              createdAt
              updatedAt
              users {
                id
                uid
                email
                firstName
                lastName
                fullName
                timezone
                updatedAt
              }
              tags {
                id
                title
                color
              }
              customFields {
                id
                name
                type
                value
              }
              todoList {
                id
                uid
                title
                position
                updatedAt
              }
            }
          }
        }
      `,
      {
        listId: input.listId,
        skip,
        first: config.BLUE_GRAPHQL_PAGE_SIZE,
      },
      { projectId: input.workspaceId, auth: input.auth },
    );

    const rawPageItems = data.todoList?.todos ?? [];
    const pageItems = rawPageItems.filter((item) =>
      input.updatedAfter ? item.updatedAt >= input.updatedAfter : true,
    );
    items.push(...pageItems);
    if (rawPageItems.length < config.BLUE_GRAPHQL_PAGE_SIZE) {
      break;
    }
    if (
      input.updatedAfter &&
      rawPageItems[rawPageItems.length - 1] &&
      rawPageItems[rawPageItems.length - 1]!.updatedAt < input.updatedAfter
    ) {
      break;
    }
    skip += config.BLUE_GRAPHQL_PAGE_SIZE;
  }

  return items;
}

export async function fetchRecordDetail(
  workspaceId: string,
  recordId: string,
  auth?: BlueRequestAuth | null,
) {
  const data = await blueGraphqlRequest<{
    todo: BlueRecord | null;
    commentList: {
      comments: BlueComment[];
    };
  }>(
    `
      query RecordDetail($recordId: String!) {
        todo(id: $recordId) {
          id
          uid
          title
          text
          html
          startedAt
          duedAt
          commentCount
          archived
          done
          createdAt
          updatedAt
          users {
            id
            uid
            email
            firstName
            lastName
            fullName
            timezone
            updatedAt
          }
          tags {
            id
            title
            color
          }
          customFields {
            id
            name
            type
            value
          }
          todoList {
            id
            uid
            title
            updatedAt
          }
          checklists {
            id
            title
            items: checklistItems {
              id
              uid
              title
              done
              users {
                id
                fullName
                email
              }
            }
          }
        }
        commentList(categoryId: $recordId, category: TODO, first: 12, orderBy: updatedAt_DESC) {
          comments {
            id
            uid
            text
            html
            createdAt
            updatedAt
            deletedAt
            user {
              id
              uid
              email
              firstName
              lastName
              fullName
              timezone
              updatedAt
            }
          }
        }
      }
    `,
    {
      recordId,
    },
    { projectId: workspaceId, auth },
  );

  return {
    record: data.todo ?? null,
    comments: data.commentList.comments,
  };
}

export async function fetchRecordLatestComment(input: {
  workspaceId: string;
  recordId: string;
  auth?: BlueRequestAuth | null;
}) {
  const data = await blueGraphqlRequest<{
    commentList: {
      comments: BlueComment[];
    };
  }>(
    `
      query RecordLatestComment($recordId: String!) {
        commentList(categoryId: $recordId, category: TODO, first: 12, orderBy: createdAt_DESC) {
          comments {
            id
            uid
            text
            html
            createdAt
            updatedAt
            deletedAt
            user {
              id
              uid
              email
              firstName
              lastName
              fullName
              timezone
              updatedAt
            }
          }
        }
      }
    `,
    {
      recordId: input.recordId,
    },
    { projectId: input.workspaceId, auth: input.auth },
  );

  return data.commentList.comments.find((comment) => !comment.deletedAt) ?? null;
}

export async function fetchWorkspaceActivity(input: {
  workspaceId?: string;
  limit: number;
  startDate?: string | null;
}) {
  const data = await blueGraphqlRequest<{
    activityList: {
      activities: BlueActivityEvent[];
      totalCount: number;
    };
  }>(
    `
      query ActivityList($projectId: String, $first: Int!, $startDate: DateTime) {
        activityList(projectId: $projectId, first: $first, startDate: $startDate, orderBy: createdAt_DESC) {
          activities {
            id
            uid
            category
            html
            createdAt
            updatedAt
            createdBy {
              id
              uid
              email
              firstName
              lastName
              fullName
              timezone
              updatedAt
            }
            affectedBy {
              id
              uid
              email
              firstName
              lastName
              fullName
              timezone
              updatedAt
            }
            project {
              id
              name
              slug
            }
            todo {
              id
              title
            }
            comment {
              id
              uid
              text
              html
              createdAt
              updatedAt
              deletedAt
            }
          }
          totalCount
        }
      }
    `,
    {
      projectId: input.workspaceId ?? null,
      first: input.limit,
      startDate: input.startDate ?? null,
    },
    input.workspaceId ? { projectId: input.workspaceId } : undefined,
  );

  return data.activityList.activities;
}

export async function fetchBlueReportingCapability(
  input?: {
    companyId?: string;
    auth?: BlueRequestAuth | null;
  },
) {
  const companyId = input?.companyId ?? config.BLUE_COMPANY_ID;
  if (!companyId) {
    return {
      configured: false,
      companyId: null,
      companyName: null,
      companySlug: null,
      subscriptionStatus: null,
      subscriptionActive: null,
      subscriptionTrialing: null,
      isEnterprise: false,
      supportsDashboards: false,
      supportsReports: false,
      plan: null,
    } satisfies BlueReportingCapability;
  }

  const data = await blueGraphqlRequest<{
    company: {
      id: string;
      name: string;
      slug: string;
      subscriptionStatus?: string | null;
      subscriptionActive?: boolean | null;
      subscriptionTrialing?: boolean | null;
      isEnterprise?: boolean | null;
      subscriptionPlan?: BlueCompanyPlan | null;
    } | null;
  }>(
    `
      query ReportingCapability($companyId: String!) {
        company(id: $companyId) {
          id
          name
          slug
          subscriptionStatus
          subscriptionActive
          subscriptionTrialing
          isEnterprise
          subscriptionPlan {
            planId
            planName
            status
            isPaid
            currentPeriodEnd
            trialEnd
          }
        }
      }
    `,
    { companyId },
    input?.auth ? { auth: input.auth } : undefined,
  );

  const company = data.company;
  const plan = company?.subscriptionPlan ?? null;
  const planLabel = `${plan?.planId ?? ""} ${plan?.planName ?? ""}`.trim();
  const isEnterprise = Boolean(
    company?.isEnterprise || /enterprise/i.test(planLabel),
  );

  return {
    configured: true,
    companyId: company?.id ?? companyId,
    companyName: company?.name ?? null,
    companySlug: company?.slug ?? null,
    subscriptionStatus: company?.subscriptionStatus ?? null,
    subscriptionActive: company?.subscriptionActive ?? null,
    subscriptionTrialing: company?.subscriptionTrialing ?? null,
    isEnterprise,
    supportsDashboards: true,
    supportsReports: isEnterprise,
    plan,
  } satisfies BlueReportingCapability;
}

export async function fetchBlueDashboards(input?: {
  companyId?: string;
  take?: number;
  auth?: BlueRequestAuth | null;
}) {
  const companyId = input?.companyId ?? config.BLUE_COMPANY_ID;
  const take = input?.take ?? 12;

  const data = await blueGraphqlRequest<{
    dashboards: {
      items: BlueDashboard[];
      pageInfo: BluePageInfo;
    };
  }>(
    `
      query ReportingDashboards($companyId: String!, $take: Int!) {
        dashboards(
          filter: { companyId: $companyId }
          sort: [updatedAt_DESC]
          skip: 0
          take: $take
        ) {
          items {
            id
            title
            createdAt
            updatedAt
            createdBy {
              id
              email
              fullName
            }
            dashboardUsers {
              id
              role
              user {
                id
                email
                fullName
              }
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
        }
      }
    `,
    { companyId, take },
    input?.auth ? { auth: input.auth } : undefined,
  );

  return data.dashboards;
}

export async function fetchBlueReports(input?: {
  companyId?: string;
  take?: number;
  auth?: BlueRequestAuth | null;
}) {
  const companyId = input?.companyId ?? config.BLUE_COMPANY_ID;
  const take = input?.take ?? 12;
  let listedReports: {
    items: BlueReport[];
    totalCount: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  } = {
    items: [],
    totalCount: 0,
    hasNextPage: false,
    hasPreviousPage: false,
  };
  let listError: Error | null = null;

  try {
    const data = await blueGraphqlRequest<{
      reports: {
        items: BlueReport[];
        totalCount: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
      };
    }>(
      `
        query ReportingReports($companyId: String!, $take: Int!) {
          reports(filter: { companyId: $companyId }, skip: 0, take: $take) {
            items {
              id
              title
              description
              createdAt
              updatedAt
              lastGeneratedAt
              projectIds
              createdBy {
                id
                email
                fullName
              }
              reportUsers {
                id
                role
                user {
                  id
                  email
                  fullName
                }
              }
              dataSources {
                id
                name
                sourceType
                projectIds
                order
              }
            }
            totalCount
            hasNextPage
            hasPreviousPage
          }
        }
    `,
    { companyId, take },
    input?.auth ? { auth: input.auth } : undefined,
  );

    listedReports = data.reports;
  } catch (error) {
    listError =
      error instanceof Error ? error : new Error("Failed to load Blue reports");
  }

  const fallbackItems = await fetchBlueReportsByIds(
    config.BLUE_REPORT_FALLBACK_IDS,
    input?.auth ?? null,
  );
  const dedupedItems = dedupeBlueReports(
    [...listedReports.items, ...fallbackItems].filter((item) =>
      isBlueReportInWorkspace(item, config.BLUE_WORKSPACE_ID),
    ),
  );
  const mergedItems = dedupedItems.slice(0, take);
  const mergedTotalCount = Math.max(listedReports.totalCount, dedupedItems.length);

  if (mergedItems.length > 0 || !listError) {
    return {
      items: mergedItems,
      totalCount: mergedTotalCount,
      hasNextPage: listedReports.hasNextPage || mergedTotalCount > mergedItems.length,
      hasPreviousPage: listedReports.hasPreviousPage,
    };
  }

  throw listError;
}

export async function fetchBlueReportById(
  reportId: string,
  auth?: BlueRequestAuth | null,
) {
  if (!reportId.trim()) {
    throw new ValidationError("Report id is required");
  }

  const data = await blueGraphqlRequest<{
    report: BlueReport | null;
  }>(
    `
      query ReportingReportById($id: String!) {
        report(id: $id) {
          id
          title
          description
          createdAt
          updatedAt
          lastGeneratedAt
          projectIds
          createdBy {
            id
            email
            fullName
          }
          reportUsers {
            id
            role
            user {
              id
              email
              fullName
            }
          }
          dataSources {
            id
            name
            sourceType
            projectIds
            order
          }
        }
      }
    `,
    { id: reportId.trim() },
    auth ? { auth } : undefined,
  );

  return data.report;
}

async function fetchBlueReportsByIds(
  reportIds: string[],
  auth?: BlueRequestAuth | null,
) {
  if (!reportIds.length) {
    return [];
  }

  const results = await Promise.all(
    reportIds.map(async (reportId) => {
      try {
        return await fetchBlueReportById(reportId, auth);
      } catch (error) {
        logger.warn(
          {
            err: error,
            reportId,
          },
          "blue report fallback lookup failed",
        );
        return null;
      }
    }),
  );

  return results.filter((item): item is BlueReport => Boolean(item));
}

function dedupeBlueReports(items: BlueReport[]) {
  const seen = new Set<string>();
  const deduped: BlueReport[] = [];

  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    deduped.push(item);
  }

  return deduped;
}

function isBlueReportInWorkspace(report: BlueReport, workspaceId: string) {
  const projectIds =
    report.projectIds?.length
      ? report.projectIds
      : report.dataSources.flatMap((source) => source.projectIds ?? []);

  if (projectIds.length === 0) {
    return true;
  }

  return projectIds.includes(workspaceId);
}

export async function createOrUpdateWebhook(input: {
  workspaceId: string;
  url: string;
  events: BlueWebhookEventType[];
  existingWebhookId?: string;
}) {
  if (input.existingWebhookId) {
    const data = await blueGraphqlRequest<{
      updateWebhook: BlueWebhook;
    }>(
      `
        mutation UpdateWebhook($input: UpdateWebhookInput!) {
          updateWebhook(input: $input) {
            id
            name
            url
            events
            projectIds
            enabled
            status
            createdAt
            updatedAt
          }
        }
      `,
      {
        input: {
          webhookId: input.existingWebhookId,
          url: input.url,
          events: input.events,
          projectIds: [input.workspaceId],
          enabled: true,
        },
      },
    );

    return { webhook: data.updateWebhook, secret: null };
  }

  const data = await blueGraphqlRequest<{
    createWebhook: BlueWebhook;
  }>(
    `
      mutation CreateWebhook($input: CreateWebhookInput!) {
        createWebhook(input: $input) {
          id
          name
          url
          events
          projectIds
          enabled
          status
          createdAt
          updatedAt
          secret
        }
      }
    `,
    {
      input: {
        name: "AyaFinancial FinOps Bot",
        url: input.url,
        events: input.events,
        projectIds: [input.workspaceId],
      },
    },
  );

  return {
    webhook: data.createWebhook,
    secret: data.createWebhook.secret ?? null,
  };
}

export async function deleteWebhook(webhookId: string) {
  const data = await blueGraphqlRequest<{
    deleteWebhook: { success: boolean };
  }>(
    `
      mutation DeleteWebhook($input: DeleteWebhookInput!) {
        deleteWebhook(input: $input) {
          success
        }
      }
    `,
    {
      input: {
        webhookId,
      },
    },
  );

  return data.deleteWebhook.success;
}

export async function fetchWorkspaceCustomFields(workspaceId: string) {
  const data = await blueGraphqlRequest<{
    customFields: {
      items: BlueCustomFieldDefinition[];
      pageInfo: {
        totalItems?: number | null;
        hasNextPage?: boolean | null;
      };
    };
  }>(
    `
      query WorkspaceCustomFields($projectId: String!, $take: Int!) {
        customFields(
          filter: { projectId: $projectId }
          sort: position_ASC
          take: $take
        ) {
          items {
            id
            uid
            name
            type
            position
          }
          pageInfo {
            totalItems
            hasNextPage
          }
        }
      }
    `,
    {
      projectId: workspaceId,
      take: 100,
    },
    { projectId: workspaceId },
  );

  return data.customFields.items;
}

export async function createRecord(input: {
  workspaceId: string;
  listId: string;
  title: string;
  description?: string;
  assigneeIds?: string[];
  auth?: BlueRequestAuth | null;
}) {
  const data = await blueGraphqlRequest<{
    createTodo: BlueRecord;
  }>(
    `
      mutation CreateTodo($input: CreateTodoInput!) {
        createTodo(input: $input) {
          id
          uid
          title
          text
          html
          startedAt
          duedAt
          commentCount
          archived
          done
          createdAt
          updatedAt
          todoList {
            id
            uid
            title
            position
            updatedAt
          }
          users {
            id
            uid
            email
            firstName
            lastName
            fullName
            timezone
            updatedAt
          }
          tags {
            id
            title
            color
          }
          customFields {
            id
            name
            type
            value
          }
        }
      }
    `,
    {
      input: {
        todoListId: input.listId,
        title: input.title.trim(),
        description: input.description?.trim() || undefined,
        assigneeIds: input.assigneeIds?.length ? input.assigneeIds : undefined,
      },
    },
    { projectId: input.workspaceId, auth: input.auth },
  );

  return data.createTodo;
}

export async function setTodoCustomField(input: {
  workspaceId: string;
  todoId: string;
  customFieldId: string;
  text?: string;
  number?: number;
  regionCode?: string;
  auth?: BlueRequestAuth | null;
}) {
  const data = await blueGraphqlRequest<{
    setTodoCustomField: boolean;
  }>(
    `
      mutation SetTodoCustomField($input: SetTodoCustomFieldInput!) {
        setTodoCustomField(input: $input)
      }
    `,
    {
      input: {
        todoId: input.todoId,
        customFieldId: input.customFieldId,
        text: input.text,
        number: input.number,
        regionCode: input.regionCode,
      },
    },
    { projectId: input.workspaceId, auth: input.auth },
  );

  return data.setTodoCustomField;
}

export async function setTodoAssignees(input: {
  workspaceId: string;
  todoId: string;
  assigneeIds: string[];
  auth?: BlueRequestAuth | null;
}) {
  const data = await blueGraphqlRequest<{
    setTodoAssignees: {
      success: boolean;
      operationId?: string | null;
    };
  }>(
    `
      mutation SetTodoAssignees($input: SetTodoAssigneesInput!) {
        setTodoAssignees(input: $input) {
          success
          operationId
        }
      }
    `,
    {
      input: {
        todoId: input.todoId,
        assigneeIds: input.assigneeIds,
      },
    },
    { projectId: input.workspaceId, auth: input.auth },
  );

  return data.setTodoAssignees.success;
}

export async function setChecklistItemAssignees(input: {
  workspaceId: string;
  todoChecklistItemId: string;
  assigneeIds: string[];
  auth?: BlueRequestAuth | null;
}) {
  const data = await blueGraphqlRequest<{
    setChecklistItemAssignees: boolean;
  }>(
    `
      mutation SetChecklistItemAssignees($input: SetChecklistItemAssigneesInput!) {
        setChecklistItemAssignees(input: $input)
      }
    `,
    {
      input: {
        todoChecklistItemId: input.todoChecklistItemId,
        assigneeIds: input.assigneeIds,
      },
    },
    { projectId: input.workspaceId, auth: input.auth },
  );

  return data.setChecklistItemAssignees;
}

export async function updateTodoFields(input: {
  workspaceId: string;
  todoIds: string[];
  done?: boolean;
  duedAt?: string | null;
  startedAt?: string | null;
  auth?: BlueRequestAuth | null;
}) {
  const data = await blueGraphqlRequest<{
    updateTodos: boolean;
  }>(
    `
      mutation UpdateTodos($input: UpdateTodosInput!) {
        updateTodos(input: $input)
      }
    `,
    {
      input: {
        done: input.done,
        duedAt: input.duedAt,
        startedAt: input.startedAt,
        filter: {
          todoIds: input.todoIds,
        },
      },
    },
    { projectId: input.workspaceId, auth: input.auth },
  );

  return data.updateTodos;
}

export async function editChecklistItem(input: {
  workspaceId: string;
  checklistItemId: string;
  done?: boolean;
  title?: string;
  position?: number;
  auth?: BlueRequestAuth | null;
}) {
  const data = await blueGraphqlRequest<{
    editChecklistItem: {
      id: string;
      title: string;
      done: boolean;
    };
  }>(
    `
      mutation EditChecklistItem($input: EditChecklistItemInput!) {
        editChecklistItem(input: $input) {
          id
          title
          done
        }
      }
    `,
    {
      input: {
        checklistItemId: input.checklistItemId,
        done: input.done,
        title: input.title,
        position: input.position,
      },
    },
    { projectId: input.workspaceId, auth: input.auth },
  );

  return data.editChecklistItem;
}

export async function updateChecklistItemDueDate(input: {
  workspaceId: string;
  checklistItemId: string;
  startedAt?: string | null;
  duedAt?: string | null;
  auth?: BlueRequestAuth | null;
}) {
  const data = await blueGraphqlRequest<{
    updateChecklistItemDueDate: {
      id: string;
      title: string;
      startedAt?: string | null;
      duedAt?: string | null;
    };
  }>(
    `
      mutation UpdateChecklistItemDueDate($input: UpdateChecklistItemDueDateInput!) {
        updateChecklistItemDueDate(input: $input) {
          id
          title
          startedAt
          duedAt
        }
      }
    `,
    {
      input: {
        checklistItemId: input.checklistItemId,
        startedAt: input.startedAt,
        duedAt: input.duedAt,
      },
    },
    { projectId: input.workspaceId, auth: input.auth },
  );

  return data.updateChecklistItemDueDate;
}

export async function createLeadRecord(input: {
  workspaceId: string;
  listId: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  financeAmount?: number;
  notes?: string;
  assigneeIds?: string[];
  auth?: BlueRequestAuth | null;
}) {
  const { fullName, firstName, lastName } = resolveLeadName(input);
  const description = [
    input.notes?.trim() ? `Notes: ${input.notes.trim()}` : null,
    input.phone?.trim() ? `Phone: ${input.phone.trim()}` : null,
    input.email?.trim() ? `Email: ${input.email.trim().toLowerCase()}` : null,
    typeof input.financeAmount === "number"
      ? `Finance amount: ${input.financeAmount}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const record = await createRecord({
    workspaceId: input.workspaceId,
    listId: input.listId,
    title: fullName,
    description,
    assigneeIds: input.assigneeIds,
    auth: input.auth,
  });

  const customFields = await fetchWorkspaceCustomFields(input.workspaceId);
  const fieldByName = new Map(
    customFields.map((field) => [field.name.trim().toLowerCase(), field]),
  );

  await setOptionalCustomField({
    workspaceId: input.workspaceId,
    todoId: record.id,
    field: fieldByName.get("contact name"),
    text: fullName,
    auth: input.auth,
  });
  await setOptionalCustomField({
    workspaceId: input.workspaceId,
    todoId: record.id,
    field: fieldByName.get("first name"),
    text: firstName,
    auth: input.auth,
  });
  await setOptionalCustomField({
    workspaceId: input.workspaceId,
    todoId: record.id,
    field: fieldByName.get("last name"),
    text: lastName,
    auth: input.auth,
  });
  await setOptionalCustomField({
    workspaceId: input.workspaceId,
    todoId: record.id,
    field: fieldByName.get("email"),
    text: input.email?.trim().toLowerCase(),
    auth: input.auth,
  });
  await setOptionalCustomField({
    workspaceId: input.workspaceId,
    todoId: record.id,
    field: fieldByName.get("phone"),
    text: input.phone?.trim(),
    regionCode: "CA",
    auth: input.auth,
  });
  await setOptionalCustomField({
    workspaceId: input.workspaceId,
    todoId: record.id,
    field: fieldByName.get("finance amount 1"),
    number: input.financeAmount,
    auth: input.auth,
  });

  return record;
}

function resolveLeadName(input: {
  fullName?: string;
  firstName?: string;
  lastName?: string;
}) {
  const normalizedFirstName = normalizeHumanName(input.firstName);
  const normalizedLastName = normalizeHumanName(input.lastName);

  if (normalizedFirstName || normalizedLastName) {
    const fullName = [normalizedFirstName, normalizedLastName]
      .filter(Boolean)
      .join(" ")
      .trim();

    if (!fullName) {
      throw new ValidationError("Lead creation requires a contact name");
    }

    return {
      fullName,
      firstName: normalizedFirstName || undefined,
      lastName: normalizedLastName || undefined,
    };
  }

  const normalizedFullName = normalizeHumanName(input.fullName);
  if (!normalizedFullName) {
    throw new ValidationError("Lead creation requires a contact name");
  }

  const [firstName, ...rest] = normalizedFullName.split(/\s+/);
  const lastName = rest.join(" ").trim();

  return {
    fullName: normalizedFullName,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
  };
}

function normalizeHumanName(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed
    .split(/\s+/)
    .map((part) => normalizeNamePart(part))
    .join(" ");
}

function normalizeNamePart(value: string) {
  return value
    .split(/([-'’])/)
    .map((segment) => {
      if (segment === "-" || segment === "'" || segment === "’") {
        return segment;
      }

      if (!segment) {
        return segment;
      }

      if (/^(ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(segment)) {
        return segment.toUpperCase();
      }

      if (/^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(segment)) {
        return segment;
      }

      const lower = segment.toLowerCase();
      return `${lower[0]?.toUpperCase() ?? ""}${lower.slice(1)}`;
    })
    .join("");
}

export async function moveRecord(input: {
  workspaceId: string;
  recordId: string;
  targetListId: string;
  auth?: BlueRequestAuth | null;
}) {
  const data = await blueGraphqlRequest<{
    moveTodo: boolean;
  }>(
    `
      mutation MoveTodo($input: MoveTodoInput!) {
        moveTodo(input: $input)
      }
    `,
    {
      input: {
        todoId: input.recordId,
        todoListId: input.targetListId,
      },
    },
    { projectId: input.workspaceId, auth: input.auth },
  );

  return {
    ok: data.moveTodo,
  };
}

export async function createComment(input: {
  workspaceId: string;
  recordId: string;
  text: string;
  auth?: BlueRequestAuth | null;
}) {
  const teammates = await fetchWorkspaceUsers(input.workspaceId);
  const { html, text } = await buildBlueCommentContent({
    text: input.text,
    employees: teammates.map((user) => ({
      id: user.id,
      displayName: user.fullName,
      email: user.email,
    })),
  });
  const data = await blueGraphqlRequest<{
    createComment: BlueComment;
  }>(
    `
      mutation CreateComment($input: CreateCommentInput!) {
        createComment(input: $input) {
          id
          uid
          text
          html
          createdAt
          updatedAt
          deletedAt
          user {
            id
            uid
            email
            firstName
            lastName
            fullName
            timezone
            updatedAt
          }
        }
      }
    `,
    {
      input: {
        html,
        text,
        category: "TODO",
        categoryId: input.recordId,
        tiptap: true,
      },
    },
    { projectId: input.workspaceId, auth: input.auth },
  );

  return data.createComment;
}

export async function listAssignedOpenRecords(input: {
  workspaceId?: string;
  companyId: string;
  assigneeId?: string;
  assigneeIds?: string[];
  limit?: number;
  skip?: number;
}) {
  const assigneeIds = input.assigneeIds?.length
    ? input.assigneeIds
    : input.assigneeId
      ? [input.assigneeId]
      : [];
  const data = await blueGraphqlRequest<{
    todoQueries: {
      todos: {
        items: BlueRecord[];
        pageInfo: {
          totalItems?: number | null;
          hasNextPage?: boolean | null;
          hasPreviousPage?: boolean | null;
          page?: number | null;
          perPage?: number | null;
        };
      };
    };
  }>(
    `
      query AssignedOpenRecords(
        $companyIds: [String!]!,
        $projectIds: [String!],
        $assigneeIds: [String!],
        $limit: Int,
        $skip: Int
      ) {
        todoQueries {
          todos(
            filter: {
              companyIds: $companyIds
              projectIds: $projectIds
              assigneeIds: $assigneeIds
              showCompleted: false
              excludeArchivedProjects: true
            }
            sort: [duedAt_ASC, todoListPosition_ASC, position_ASC]
            limit: $limit
            skip: $skip
          ) {
            items {
              id
              uid
              title
              text
              html
              startedAt
              duedAt
              commentCount
              archived
              done
              createdAt
              updatedAt
              users {
                id
                uid
                email
                firstName
                lastName
                fullName
                timezone
                updatedAt
              }
              tags {
                id
                title
                color
              }
              customFields {
                id
                name
                type
                value
              }
              todoList {
                id
                uid
                title
                position
                updatedAt
              }
            }
            pageInfo {
              totalItems
              hasNextPage
              hasPreviousPage
              page
              perPage
            }
          }
        }
      }
    `,
    {
      companyIds: [input.companyId],
      projectIds: input.workspaceId ? [input.workspaceId] : null,
      assigneeIds,
      limit: input.limit ?? 50,
      skip: input.skip ?? 0,
    },
    input.workspaceId ? { projectId: input.workspaceId } : undefined,
  );

  return data.todoQueries.todos;
}

export async function listAssignedChecklistItems(input: {
  workspaceId?: string;
  assigneeId?: string;
  assigneeIds?: string[];
  done?: boolean;
  todoDone?: boolean;
  limit?: number;
  skip?: number;
}) {
  const assigneeIds = input.assigneeIds?.length
    ? input.assigneeIds
    : input.assigneeId
      ? [input.assigneeId]
      : [];
  const filter: Record<string, unknown> = {
    assigneeIds,
    excludeArchivedProjects: true,
  };

  if (input.done != null) {
    filter.done = input.done;
  }
  if (input.todoDone != null) {
    filter.todoDone = input.todoDone;
  }

  const data = await blueGraphqlRequest<{
    checklistItems: {
      items: BlueChecklistItem[];
      pageInfo: {
        totalItems?: number | null;
        hasNextPage?: boolean | null;
        hasPreviousPage?: boolean | null;
        page?: number | null;
        perPage?: number | null;
      };
    };
  }>(
    `
      query AssignedChecklistItems(
        $filter: ChecklistItemFilterInput!,
        $take: Int,
        $skip: Int
      ) {
        checklistItems(filter: $filter, take: $take, skip: $skip) {
          items {
            id
            uid
            title
            done
            duedAt
            updatedAt
            users {
              id
              uid
              email
              firstName
              lastName
              fullName
              timezone
              updatedAt
            }
            checklist {
              id
              title
              todo {
                id
                uid
                title
                todoList {
                  id
                  uid
                  title
                  position
                  updatedAt
                }
              }
            }
          }
          pageInfo {
            totalItems
            hasNextPage
            hasPreviousPage
            page
            perPage
          }
        }
      }
    `,
    {
      filter,
      take: input.limit ?? 50,
      skip: input.skip ?? 0,
    },
    { projectId: input.workspaceId },
  );

  return data.checklistItems;
}

export async function checkBlueApiConnectivity(workspaceId: string) {
  const data = await blueGraphqlRequest<{
    projectUserList: {
      totalCount: number;
    };
  }>(
    `
      query BlueHealthCheck($projectId: String!) {
        projectUserList(projectId: $projectId, first: 1) {
          totalCount
        }
      }
    `,
    { projectId: workspaceId },
    { projectId: workspaceId },
  );

  return {
    ok: true,
    totalUsers: data.projectUserList.totalCount,
  };
}

export async function fetchCurrentBlueUser(auth: BlueRequestAuth) {
  const data = await blueGraphqlRequest<{
    currentUser: {
      id: string;
      uid?: string | null;
      email?: string | null;
      fullName?: string | null;
      projectUserRole?: {
        id?: string | null;
        name?: string | null;
        isRecordsEnabled?: boolean | null;
      } | null;
    };
  }>(
    `
      query AyaValidateBlueCredentials($projectId: String) {
        currentUser {
          id
          uid
          email
          fullName
          projectUserRole(projectId: $projectId) {
            id
            name
            isRecordsEnabled
          }
        }
      }
    `,
    { projectId: config.BLUE_WORKSPACE_ID },
    { projectId: config.BLUE_WORKSPACE_ID, auth },
  );

  return data.currentUser;
}

function resolveGraphqlCredentials(auth?: BlueRequestAuth | null) {
  if (!config.BLUE_COMPANY_ID) {
    throw new ExternalServiceError(
      "Blue GraphQL company configuration is missing. Set BLUE_COMPANY_ID.",
    );
  }

  const clientId = auth?.tokenId?.trim() || config.BLUE_CLIENT_ID;
  const authToken = auth?.tokenSecret?.trim() || config.BLUE_AUTH_TOKEN;

  if (!clientId || !authToken) {
    throw new ExternalServiceError(
      "Blue GraphQL credentials are missing. Set BLUE_AUTH_TOKEN and BLUE_CLIENT_ID or provide request-scoped Blue credentials.",
    );
  }

  return {
    clientId,
    authToken,
    companyId: config.BLUE_COMPANY_ID,
  };
}

function isRetryableGraphqlError(code: string, message: string) {
  if (code === "RATE_LIMITED" || code === "TOO_MANY_REQUESTS") {
    return true;
  }

  const normalized = message.toLowerCase();
  return (
    normalized.includes("rate limit") ||
    normalized.includes("temporarily unavailable") ||
    normalized.includes("timeout")
  );
}

function getOperationLabel(query: string) {
  const compact = query.replace(/\s+/g, " ").trim();
  const match = compact.match(/^(query|mutation)\s+([A-Za-z0-9_]+)/);
  return match?.[2] ?? "anonymous";
}

function getRetryAfterMs(error: Error) {
  const match = error.message.match(/retry-after[:=]\s*(\d+)/i);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 1000;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function setOptionalCustomField(input: {
  workspaceId: string;
  todoId: string;
  field: BlueCustomFieldDefinition | undefined;
  text?: string;
  number?: number;
  regionCode?: string;
  auth?: BlueRequestAuth | null;
}) {
  if (!input.field) {
    return;
  }

  if (typeof input.number !== "number" && !input.text?.trim()) {
    return;
  }

  await setTodoCustomField({
    workspaceId: input.workspaceId,
    todoId: input.todoId,
    customFieldId: input.field.id,
    text: input.text?.trim(),
    number: input.number,
    regionCode: input.regionCode,
    auth: input.auth,
  });
}
