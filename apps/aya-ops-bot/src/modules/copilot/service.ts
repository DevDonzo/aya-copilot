import { createId } from "../../db.js";
import type {
  BlueRequestAuth,
  EmployeeIdentity,
  IntentName,
  IntentPlan,
} from "../../domain/types.js";
import {
  normalizeBlueRequestAuth,
} from "../blue/request-auth.js";
import {
  getActiveRecordContextForActor,
} from "../disambiguation/active-record-context.js";
import {
  clearPendingRecordChoiceForActor,
  resolvePendingRecordChoice,
} from "../disambiguation/record-choices.js";
import { resolveActorIdentity } from "../identity/service.js";
import {
  addCommentToClient,
  answerReportingQuestion,
  assignRecord,
  assignTask,
  completeRecordAssignment,
  completeTaskAssignment,
  createClientRecord,
  getEmployeeDailyBrief,
  getClientComments,
  getClientDetail,
  getEmployeeAssignmentReport,
  getEmployeeActivityReport,
  getEmployeeDaySummary,
  getEmployeeFollowUpQueue,
  getEmployeeNotificationFeed,
  getEmployeeWorkload,
  getUserMentionsReport,
  getUserActivityHistory,
  getRecordActivityReport,
  getWorkspaceExceptionReport,
  getReportingOverview,
  getTeamDaySummary,
  getWorkspaceActivityReport,
  moveClientToStage,
  setRecordDueDate,
  setTaskDueDate,
  searchClients,
} from "./actions.js";
import { planEmployeeIntent } from "./planner.js";
import { insertBotAuditLog } from "../../store/audit-store.js";
import { PermissionError } from "../../app/errors.js";

export interface InboundMessagePayload {
  transport?: string;
  senderId?: string;
  senderLabel?: string;
  actorEmployeeId?: string;
  actorEmployeeEmail?: string;
  actorEmployeeName?: string;
  actorBlueTokenId?: string;
  actorBlueTokenSecret?: string;
  message: string;
}

export interface MessageResponse {
  matched: boolean;
  intent?: string;
  actor: EmployeeIdentity;
  responseText: string;
  clarificationRequired?: boolean;
  plan?: IntentPlan;
  data?: unknown;
}

interface PendingExecutionResult {
  intent: IntentName;
  responseText: string;
  data?: unknown;
}

export function resolvePayloadBlueAuth(
  payload: InboundMessagePayload,
): BlueRequestAuth | null {
  return normalizeBlueRequestAuth({
    tokenId: payload.actorBlueTokenId,
    tokenSecret: payload.actorBlueTokenSecret,
  });
}

export function redactPayloadForAudit(payload: InboundMessagePayload) {
  return {
    ...payload,
    actorBlueTokenId: payload.actorBlueTokenId ? "[redacted]" : undefined,
    actorBlueTokenSecret: payload.actorBlueTokenSecret
      ? "[redacted]"
      : undefined,
  };
}

export async function resolveActorFromPayload(
  payload: InboundMessagePayload,
): Promise<EmployeeIdentity> {
  const actor = await resolveActorIdentity({
    employeeId: payload.actorEmployeeId,
    employeeEmail: payload.actorEmployeeEmail,
    employeeName: payload.actorEmployeeName,
    transport: payload.transport,
    senderId: payload.senderId,
    autoLinkByEmail: true,
  });

  return {
    ...actor,
    email: actor.email ?? payload.actorEmployeeEmail ?? undefined,
  };
}

export async function planInboundMessage(payload: InboundMessagePayload) {
  const actor = await resolveActorFromPayload(payload);
  const transport = payload.transport ?? "http";
  const activeRecordContext = await getActiveRecordContextForActor(
    actor,
    transport,
  );

  const plan = planEmployeeIntent({
    actor,
    message: payload.message,
    nowIso: new Date().toISOString(),
    hasActiveRecordContext: Boolean(activeRecordContext),
  });

  return {
    actor,
    transport,
    hasActiveRecordContext: Boolean(activeRecordContext),
    activeRecordContext,
    plan,
  };
}

export async function handleInboundMessage(
  payload: InboundMessagePayload,
): Promise<MessageResponse> {
  const actor = await resolveActorFromPayload(payload);
  const transport = payload.transport ?? "http";
  const blueAuth = resolvePayloadBlueAuth(payload);
  const auditPayload = redactPayloadForAudit(payload);
  const activeRecordContext = await getActiveRecordContextForActor(
    actor,
    transport,
  );

  const plan = planEmployeeIntent({
    actor,
    message: payload.message,
    nowIso: new Date().toISOString(),
    hasActiveRecordContext: Boolean(activeRecordContext),
  });

  if (!plan) {
    const pending = await continuePendingRecordChoice(
      actor,
      transport,
      payload.message,
      blueAuth,
    );
    if (pending) {
      const syntheticPlan: IntentPlan = {
        intent: pending.intent,
        confidence: 1,
        parameters: {
          selection: payload.message.trim(),
        },
        requiresClarification: false,
        matchedSignals: ["pending-choice"],
      };
      await recordAudit({
        actor,
        transport,
        inboundText: payload.message,
        detectedIntent: pending.intent,
        adapter: "pending-record-choice",
        commandName: getAuditCommandName(pending.intent),
        commandArgs: JSON.stringify({ selection: payload.message.trim() }),
        outcome: "success",
        responseText: pending.responseText,
        requestJson: {
          payload: auditPayload,
          plan: syntheticPlan,
        },
        responseJson: {
          plan: syntheticPlan,
          data: pending.data,
        },
      });

      return {
        matched: true,
        intent: pending.intent,
        actor,
        responseText: pending.responseText,
        plan: syntheticPlan,
        data: pending.data,
      };
    }

    const responseText =
      "I could not map that request to a supported Aya action yet.";
    await recordAudit({
      actor,
      transport,
      inboundText: payload.message,
      adapter: "planner",
      outcome: "unmatched",
      responseText,
      requestJson: {
        payload: auditPayload,
        plan: null,
      },
      responseJson: {
        matched: false,
      },
    });

    return {
      matched: false,
      actor,
      responseText,
    };
  }

  if (plan.requiresClarification) {
    const responseText =
      plan.clarificationQuestion ?? "I need one quick clarification first.";
    await recordAudit({
      actor,
      transport,
      inboundText: payload.message,
      detectedIntent: plan.intent,
      adapter: "planner",
      commandName: getAuditCommandName(plan.intent),
      commandArgs: JSON.stringify(plan.parameters),
      outcome: "needs_clarification",
      responseText,
      requestJson: {
        payload: auditPayload,
        plan,
      },
      responseJson: {
        clarificationRequired: true,
      },
    });

    return {
      matched: true,
      intent: plan.intent,
      actor,
      responseText,
      clarificationRequired: true,
      plan,
    };
  }

  enforceIntentPermissions(actor, plan);
  const execution = await executePlan({
    actor,
    transport,
    blueAuth,
    payload,
    plan,
  });

  await recordAudit({
    actor,
    transport,
    inboundText: payload.message,
    detectedIntent: plan.intent,
    adapter: getAuditAdapter(plan.intent),
    commandName: getAuditCommandName(plan.intent),
    commandArgs: JSON.stringify(plan.parameters),
    outcome: "success",
    responseText: execution.responseText,
    requestJson: {
      payload: auditPayload,
      plan,
    },
    responseJson: {
      plan,
      data: execution.data,
    },
  });

  return {
    matched: true,
    intent: plan.intent,
    actor,
    responseText: execution.responseText,
    plan,
    data: execution.data,
  };
}

function enforceIntentPermissions(actor: EmployeeIdentity, plan: IntentPlan) {
  const role = actor.roleName ?? "employee";

  if (role === "admin") {
    return;
  }

  if (
    plan.intent === "activity.employee_report" ||
    plan.intent === "activity.record_report" ||
    plan.intent === "activity.workspace_report" ||
    plan.intent === "records.exception_report" ||
    plan.intent === "summary.team_day" ||
    plan.intent === "summary.no_activity_day" ||
    plan.intent === "reporting.overview" ||
    plan.intent === "reporting.question" ||
    plan.intent === "activity.list"
  ) {
    throw new PermissionError();
  }

  if (
    plan.intent === "assignments.report" &&
    typeof plan.parameters.employeeName === "string" &&
    plan.parameters.employeeName.trim().toLowerCase() !==
      actor.displayName.trim().toLowerCase()
  ) {
    throw new PermissionError();
  }

  if (
    plan.intent === "notifications.feed" &&
    typeof plan.parameters.employeeName === "string" &&
    plan.parameters.employeeName.trim().toLowerCase() !==
      actor.displayName.trim().toLowerCase()
  ) {
    throw new PermissionError();
  }

  if (
    plan.intent === "records.list_assigned" &&
    typeof plan.parameters.employeeName === "string" &&
    plan.parameters.employeeName.trim().toLowerCase() !==
      actor.displayName.trim().toLowerCase()
  ) {
    throw new PermissionError();
  }

  if (
    plan.intent === "summary.employee_day" &&
    typeof plan.parameters.employeeName === "string" &&
    plan.parameters.employeeName.trim().toLowerCase() !==
      actor.displayName.trim().toLowerCase()
  ) {
    throw new PermissionError();
  }
}

async function executePlan(input: {
  actor: EmployeeIdentity;
  transport: string;
  blueAuth: BlueRequestAuth | null;
  payload: InboundMessagePayload;
  plan: IntentPlan;
}) {
  const { actor, transport, blueAuth, plan } = input;

  switch (plan.intent) {
    case "help.overview": {
      return {
        responseText: [
          "I can help with Aya/Blue work like daily briefs, notifications, client status, comments, assignments, follow-ups, activity, and reporting.",
          "Examples:",
          "- start my day",
          "- show my notifications",
          "- show my assignments",
          "- show my mentions",
          "- what needs my attention today?",
          "- mark task income docs done",
          "- set due date for John Smith to 2026-05-10",
          "- what assignments does Sarah have?",
          "- who moved clients today?",
          "- updates on Fatima Hammou",
          "- show comments for Fatima Hammou",
          "- which records are missing phone?",
          "- move Fatima Hammou to underwriting",
          "- assign Fatima Hammou to Hamza",
        ].join("\n"),
        data: {
          examples: [
            "start my day",
            "show my notifications",
            "show my assignments",
            "what assignments does Sarah have?",
            "who moved clients today?",
            "updates on Fatima Hammou",
          ],
        },
      };
    }

    case "activity.employee_report": {
      const focus =
        plan.parameters.activityFocus === "comments" ||
        plan.parameters.activityFocus === "moves" ||
        plan.parameters.activityFocus === "creates" ||
        plan.parameters.activityFocus === "timeline"
          ? plan.parameters.activityFocus
          : "all";
      const result = await getEmployeeActivityReport({
        employeeId:
          typeof plan.parameters.employeeId === "string"
            ? plan.parameters.employeeId
            : undefined,
        employeeEmail:
          typeof plan.parameters.employeeEmail === "string"
            ? plan.parameters.employeeEmail
            : undefined,
        employeeName:
          typeof plan.parameters.employeeName === "string"
            ? plan.parameters.employeeName
            : undefined,
        date:
          typeof plan.parameters.date === "string"
            ? plan.parameters.date
            : undefined,
        dateStart:
          typeof plan.parameters.dateStart === "string"
            ? plan.parameters.dateStart
            : undefined,
        dateEnd:
          typeof plan.parameters.dateEnd === "string"
            ? plan.parameters.dateEnd
            : undefined,
        dateLabel:
          typeof plan.parameters.dateLabel === "string"
            ? plan.parameters.dateLabel
            : undefined,
        focus,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "activity.record_report": {
      const focus =
        plan.parameters.activityFocus === "comments" ||
        plan.parameters.activityFocus === "moves" ||
        plan.parameters.activityFocus === "timeline"
          ? plan.parameters.activityFocus
          : "all";
      const result = await getRecordActivityReport({
        recordId:
          typeof plan.parameters.recordId === "string"
            ? plan.parameters.recordId
            : undefined,
        recordQuery:
          typeof plan.parameters.recordQuery === "string"
            ? plan.parameters.recordQuery
            : undefined,
        useActiveRecordContext: plan.parameters.useActiveRecordContext === true,
        date:
          typeof plan.parameters.date === "string"
            ? plan.parameters.date
            : undefined,
        dateStart:
          typeof plan.parameters.dateStart === "string"
            ? plan.parameters.dateStart
            : undefined,
        dateEnd:
          typeof plan.parameters.dateEnd === "string"
            ? plan.parameters.dateEnd
            : undefined,
        dateLabel:
          typeof plan.parameters.dateLabel === "string"
            ? plan.parameters.dateLabel
            : undefined,
        focus,
        actor,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "activity.workspace_report": {
      const focus =
        plan.parameters.activityFocus === "comments" ||
        plan.parameters.activityFocus === "moves" ||
        plan.parameters.activityFocus === "creates" ||
        plan.parameters.activityFocus === "timeline"
          ? plan.parameters.activityFocus
          : "all";
      const result = await getWorkspaceActivityReport({
        date:
          typeof plan.parameters.date === "string"
            ? plan.parameters.date
            : undefined,
        dateStart:
          typeof plan.parameters.dateStart === "string"
            ? plan.parameters.dateStart
            : undefined,
        dateEnd:
          typeof plan.parameters.dateEnd === "string"
            ? plan.parameters.dateEnd
            : undefined,
        dateLabel:
          typeof plan.parameters.dateLabel === "string"
            ? plan.parameters.dateLabel
            : undefined,
        focus,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "records.exception_report": {
      const focus =
        plan.parameters.exceptionFocus === "finance_amount" ||
        plan.parameters.exceptionFocus === "due_date" ||
        plan.parameters.exceptionFocus === "closing_date" ||
        plan.parameters.exceptionFocus === "assignee" ||
        plan.parameters.exceptionFocus === "client_name" ||
        plan.parameters.exceptionFocus === "email" ||
        plan.parameters.exceptionFocus === "phone" ||
        plan.parameters.exceptionFocus === "assignment"
          ? plan.parameters.exceptionFocus
          : "all";
      const result = await getWorkspaceExceptionReport({
        focus,
        employeeName:
          typeof plan.parameters.employeeName === "string"
            ? plan.parameters.employeeName
            : undefined,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "identity.self": {
      const data = {
        employeeId: actor.employeeId,
        displayName: actor.displayName,
        email: actor.email ?? null,
        roleName: actor.roleName ?? null,
      };
      return {
        responseText: [
          `You are signed in as ${actor.displayName}.`,
          actor.email ? `Email: ${actor.email}` : null,
          actor.roleName ? `Role: ${actor.roleName}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
        data,
      };
    }

    case "brief.daily": {
      const result = await getEmployeeDailyBrief({
        employeeId:
          typeof plan.parameters.employeeId === "string"
            ? plan.parameters.employeeId
            : undefined,
        employeeEmail:
          typeof plan.parameters.employeeEmail === "string"
            ? plan.parameters.employeeEmail
            : undefined,
        employeeName:
          typeof plan.parameters.employeeName === "string"
            ? plan.parameters.employeeName
            : actor.displayName,
        date:
          typeof plan.parameters.date === "string"
            ? plan.parameters.date
            : undefined,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "notifications.feed": {
      const result = await getEmployeeNotificationFeed({
        employeeId:
          typeof plan.parameters.employeeId === "string"
            ? plan.parameters.employeeId
            : undefined,
        employeeEmail:
          typeof plan.parameters.employeeEmail === "string"
            ? plan.parameters.employeeEmail
            : undefined,
        employeeName:
          typeof plan.parameters.employeeName === "string"
            ? plan.parameters.employeeName
            : actor.displayName,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "activity.mentions": {
      const result = await getUserMentionsReport({
        employeeName:
          typeof plan.parameters.employeeName === "string"
            ? plan.parameters.employeeName
            : undefined,
        dateStart:
          typeof plan.parameters.dateStart === "string"
            ? plan.parameters.dateStart
            : undefined,
        dateEnd:
          typeof plan.parameters.dateEnd === "string"
            ? plan.parameters.dateEnd
            : undefined,
        actor,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "activity.user_history": {
      const result = await getUserActivityHistory({
        employeeName:
          typeof plan.parameters.employeeName === "string"
            ? plan.parameters.employeeName
            : undefined,
        dateStart:
          typeof plan.parameters.dateStart === "string"
            ? plan.parameters.dateStart
            : undefined,
        dateEnd:
          typeof plan.parameters.dateEnd === "string"
            ? plan.parameters.dateEnd
            : undefined,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "summary.employee_day": {
      const result = await getEmployeeDaySummary({
        employeeId:
          typeof plan.parameters.employeeId === "string"
            ? plan.parameters.employeeId
            : undefined,
        employeeName:
          typeof plan.parameters.employeeName === "string"
            ? plan.parameters.employeeName
            : actor.displayName,
        transport,
      });
      return {
        responseText: result.summaryText,
        data: result,
      };
    }

    case "summary.team_day": {
      const result = await getTeamDaySummary({});
      return {
        responseText: result.summaryText,
        data: result,
      };
    }

    case "summary.no_activity_day": {
      const result = await getTeamDaySummary({ inactiveOnly: true });
      return {
        responseText: result.summaryText,
        data: result,
      };
    }

    case "records.search": {
      const query = String(plan.parameters.query ?? "").trim();
      const result = await searchClients({
        query,
        limit: 5,
        actor,
        transport,
      });
      const responseText =
        result.items.length === 0
          ? `No cached Blue records matched "${query}".`
          : result.items
              .map(
                (item, index) =>
                  `${index + 1}. ${item.title} (${item.listTitle})`,
              )
              .join("\n");
      return {
        responseText,
        data: result,
      };
    }

    case "records.detail": {
      const result = await getClientDetail({
        recordQuery:
          typeof plan.parameters.recordQuery === "string"
            ? plan.parameters.recordQuery
            : undefined,
        useActiveRecordContext: plan.parameters.useActiveRecordContext === true,
        detailMode:
          plan.parameters.detailMode === "call_prep"
            ? "call_prep"
            : plan.parameters.detailMode === "briefing"
              ? "briefing"
              : "default",
        briefingFocus:
          plan.parameters.briefingFocus === "handoff" ||
          plan.parameters.briefingFocus === "blockers" ||
          plan.parameters.briefingFocus === "missing_docs" ||
          plan.parameters.briefingFocus === "general"
            ? plan.parameters.briefingFocus
            : undefined,
        actor,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "records.list_assigned": {
      const result = await getEmployeeWorkload({
        employeeId:
          typeof plan.parameters.assigneeId === "string"
            ? plan.parameters.assigneeId
            : undefined,
        employeeName:
          typeof plan.parameters.employeeName === "string"
            ? plan.parameters.employeeName
            : actor.displayName,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "assignments.report": {
      const status =
        plan.parameters.assignmentStatus === "completed" ||
        plan.parameters.assignmentStatus === "all"
          ? plan.parameters.assignmentStatus
          : "open";
      const result = await getEmployeeAssignmentReport({
        employeeId:
          typeof plan.parameters.assigneeId === "string"
            ? plan.parameters.assigneeId
            : undefined,
        employeeName:
          typeof plan.parameters.employeeName === "string"
            ? plan.parameters.employeeName
            : actor.displayName,
        status,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "records.follow_up": {
      const result = await getEmployeeFollowUpQueue({
        employeeId:
          typeof plan.parameters.assigneeId === "string"
            ? plan.parameters.assigneeId
            : undefined,
        employeeName:
          typeof plan.parameters.employeeName === "string"
            ? plan.parameters.employeeName
            : actor.displayName,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "records.complete": {
      const result = await completeRecordAssignment({
        entityQuery:
          typeof plan.parameters.entityQuery === "string"
            ? plan.parameters.entityQuery
            : undefined,
        useActiveRecordContext: plan.parameters.useActiveRecordContext === true,
        actor,
        blueAuth,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "tasks.complete": {
      const result = await completeTaskAssignment({
        recordQuery:
          typeof plan.parameters.recordQuery === "string"
            ? plan.parameters.recordQuery
            : undefined,
        taskQuery: String(plan.parameters.taskQuery ?? ""),
        useActiveRecordContext: plan.parameters.useActiveRecordContext === true,
        actor,
        blueAuth,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "records.set_due_date": {
      const result = await setRecordDueDate({
        entityQuery:
          typeof plan.parameters.entityQuery === "string"
            ? plan.parameters.entityQuery
            : undefined,
        dueDate: String(plan.parameters.dueDate ?? ""),
        useActiveRecordContext: plan.parameters.useActiveRecordContext === true,
        actor,
        blueAuth,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "tasks.set_due_date": {
      const result = await setTaskDueDate({
        recordQuery:
          typeof plan.parameters.recordQuery === "string"
            ? plan.parameters.recordQuery
            : undefined,
        taskQuery: String(plan.parameters.taskQuery ?? ""),
        dueDate: String(plan.parameters.dueDate ?? ""),
        useActiveRecordContext: plan.parameters.useActiveRecordContext === true,
        actor,
        blueAuth,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "reporting.overview": {
      const result = await getReportingOverview({ auth: blueAuth });
      return {
        responseText: result.summaryText,
        data: result,
      };
    }

    case "reporting.question": {
      const question = String(plan.parameters.question ?? "").trim();
      const result = await answerReportingQuestion({
        question,
        auth: blueAuth,
      });
      return {
        responseText: result.answerText,
        data: result,
      };
    }

    case "comments.list_recent": {
      const result = await getClientComments({
        recordQuery:
          typeof plan.parameters.recordQuery === "string"
            ? plan.parameters.recordQuery
            : undefined,
        useActiveRecordContext: plan.parameters.useActiveRecordContext === true,
        actor,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "comments.create": {
      const result = await addCommentToClient({
        recordQuery:
          typeof plan.parameters.recordQuery === "string"
            ? plan.parameters.recordQuery
            : undefined,
        useActiveRecordContext: plan.parameters.useActiveRecordContext === true,
        text: String(plan.parameters.text ?? ""),
        actor,
        blueAuth,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "records.move": {
      const result = await moveClientToStage({
        recordQuery:
          typeof plan.parameters.recordQuery === "string"
            ? plan.parameters.recordQuery
            : undefined,
        targetListQuery: String(plan.parameters.targetListQuery ?? ""),
        useActiveRecordContext: plan.parameters.useActiveRecordContext === true,
        actor,
        blueAuth,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "records.assign": {
      const result = await assignRecord({
        entityQuery:
          typeof plan.parameters.entityQuery === "string"
            ? plan.parameters.entityQuery
            : undefined,
        assigneeName: String(plan.parameters.assigneeName ?? ""),
        useActiveRecordContext: plan.parameters.useActiveRecordContext === true,
        actor,
        blueAuth,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "tasks.assign": {
      const result = await assignTask({
        entityQuery:
          typeof plan.parameters.entityQuery === "string"
            ? plan.parameters.entityQuery
            : undefined,
        assigneeName: String(plan.parameters.assigneeName ?? ""),
        useActiveRecordContext: plan.parameters.useActiveRecordContext === true,
        actor,
        blueAuth,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "records.create": {
      const financeAmountRaw =
        typeof plan.parameters.financeAmount === "string"
          ? plan.parameters.financeAmount
          : undefined;
      const financeAmount = financeAmountRaw ? Number(financeAmountRaw) : undefined;
      const result = await createClientRecord({
        fullName:
          typeof plan.parameters.fullName === "string"
            ? plan.parameters.fullName
            : undefined,
        firstName:
          typeof plan.parameters.firstName === "string"
            ? plan.parameters.firstName
            : undefined,
        lastName:
          typeof plan.parameters.lastName === "string"
            ? plan.parameters.lastName
            : undefined,
        email:
          typeof plan.parameters.email === "string"
            ? plan.parameters.email
            : undefined,
        phone:
          typeof plan.parameters.phone === "string"
            ? plan.parameters.phone
            : undefined,
        financeAmount,
        notes:
          typeof plan.parameters.notes === "string"
            ? plan.parameters.notes
            : undefined,
        targetListQuery:
          typeof plan.parameters.targetListQuery === "string"
            ? plan.parameters.targetListQuery
            : undefined,
        actor,
        blueAuth,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "activity.list":
      return {
        responseText:
          "Aya has not enabled a standalone activity feed here yet. Ask for what changed today or what someone did today.",
        data: null,
      };
  }
}

async function continuePendingRecordChoice(
  actor: EmployeeIdentity,
  transport: string,
  message: string,
  blueAuth: BlueRequestAuth | null,
): Promise<PendingExecutionResult | null> {
  const pendingSelection = await resolvePendingRecordChoice({
    actor,
    transport,
    message,
  });
  if (!pendingSelection) {
    return null;
  }

  await clearPendingRecordChoiceForActor(actor);

  switch (pendingSelection.context.continuationAction) {
    case "get_client_detail":
    case "records.detail": {
      const result = await getClientDetail({
        recordId: pendingSelection.candidate.id,
        detailMode:
          pendingSelection.context.pendingParameters.detailMode === "call_prep"
            ? "call_prep"
            : pendingSelection.context.pendingParameters.detailMode === "briefing"
              ? "briefing"
              : "default",
        briefingFocus:
          pendingSelection.context.pendingParameters.briefingFocus ===
            "handoff" ||
          pendingSelection.context.pendingParameters.briefingFocus ===
            "blockers" ||
          pendingSelection.context.pendingParameters.briefingFocus ===
            "missing_docs" ||
          pendingSelection.context.pendingParameters.briefingFocus === "general"
            ? pendingSelection.context.pendingParameters.briefingFocus
            : undefined,
        actor,
        transport,
      });
      return {
        intent: "records.detail",
        responseText: result.responseText,
        data: result,
      };
    }

    case "comments.list_recent": {
      const result = await getClientComments({
        recordId: pendingSelection.candidate.id,
        actor,
        transport,
      });
      return {
        intent: "comments.list_recent",
        responseText: result.responseText,
        data: result,
      };
    }

    case "comments.create": {
      const text =
        typeof pendingSelection.context.pendingParameters.text === "string"
          ? pendingSelection.context.pendingParameters.text
          : "";
      const result = await addCommentToClient({
        recordId: pendingSelection.candidate.id,
        text,
        actor,
        blueAuth,
        transport,
      });
      return {
        intent: "comments.create",
        responseText: result.responseText,
        data: result,
      };
    }

    case "records.move": {
      const targetListQuery =
        typeof pendingSelection.context.pendingParameters.targetListQuery ===
        "string"
          ? pendingSelection.context.pendingParameters.targetListQuery
          : "";
      const result = await moveClientToStage({
        recordId: pendingSelection.candidate.id,
        targetListQuery,
        actor,
        blueAuth,
        transport,
      });
      return {
        intent: "records.move",
        responseText: result.responseText,
        data: result,
      };
    }

    default:
      return null;
  }
}

async function recordAudit(input: {
  actor: EmployeeIdentity;
  transport: string;
  inboundText: string;
  detectedIntent?: string;
  adapter: string;
  outcome: string;
  responseText: string;
  commandName?: string;
  commandArgs?: string;
  requestJson?: unknown;
  responseJson?: unknown;
}) {
  await insertBotAuditLog({
    id: createId("audit"),
    employeeId: input.actor.blueUserId,
    transport: input.transport,
    inboundText: input.inboundText,
    detectedIntent: input.detectedIntent,
    adapter: input.adapter,
    commandName: input.commandName,
    commandArgs: input.commandArgs,
    outcome: input.outcome,
    responseText: input.responseText,
    requestJson: input.requestJson,
    responseJson: input.responseJson,
  });
}

function getAuditAdapter(intent: IntentName) {
  switch (intent) {
    case "help.overview":
    case "identity.self":
    case "brief.daily":
    case "notifications.feed":
    case "summary.employee_day":
    case "assignments.report":
    case "records.complete":
    case "tasks.complete":
    case "records.set_due_date":
    case "tasks.set_due_date":
    case "activity.employee_report":
    case "activity.record_report":
    case "activity.workspace_report":
    case "records.exception_report":
    case "summary.team_day":
    case "summary.no_activity_day":
      return "local";
    case "records.search":
      return "local-cache";
    case "reporting.overview":
    case "reporting.question":
      return "blue-reporting";
    default:
      return "aya-service";
  }
}

function getAuditCommandName(intent: IntentName) {
  switch (intent) {
    case "help.overview":
      return "helpOverview";
    case "brief.daily":
      return "dailyBrief";
    case "records.move":
      return "moveTodo";
    case "records.create":
      return "createTodo";
    case "comments.create":
      return "createComment";
    case "comments.list_recent":
    case "records.detail":
      return "getBlueRecordDetail";
    case "records.list_assigned":
    case "records.follow_up":
      return "todoQueries.todos";
    case "records.complete":
      return "updateTodos";
    case "assignments.report":
      return "checklistItems";
    case "tasks.complete":
      return "editChecklistItem";
    case "records.set_due_date":
      return "updateTodos";
    case "tasks.set_due_date":
      return "updateChecklistItemDueDate";
    case "reporting.overview":
      return "getReportingOverview";
    case "reporting.question":
      return "answerReportingQuestion";
    case "activity.employee_report":
      return "employeeActivityReport";
    case "activity.record_report":
      return "recordActivityReport";
    case "activity.workspace_report":
      return "workspaceActivityReport";
    case "records.exception_report":
      return "workspaceExceptionReport";
    default:
      return intent;
  }
}
