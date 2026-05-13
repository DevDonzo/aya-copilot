import type {
  IntentMatch,
  IntentPlan,
  IntentRequest,
  IntentName,
} from "../../domain/types.js";
import {
  OPTIONAL_ACTIVITY_DATE_SUFFIX_PATTERN,
  resolveActivityDateRangeFromMessage,
} from "./activity-date-range.js";

export interface IntentPlannerRequest extends IntentRequest {
  hasActiveRecordContext?: boolean;
}

interface IntentCandidate {
  intent: IntentName;
  score: number;
  confidence: number;
  parameters: Record<string, string | number | boolean | undefined>;
  matchedSignals: string[];
  requiresClarification?: boolean;
  clarificationQuestion?: string;
}

export function planEmployeeIntent(
  request: IntentPlannerRequest,
): IntentPlan | null {
  const preparedMessage = normalizeIntentMessage(request.message);
  const preparedRequest: IntentPlannerRequest = {
    ...request,
    message: preparedMessage,
    originalMessage: request.message.trim(),
  };

  const candidates = INTENT_RESOLVERS.map((resolver) => resolver(preparedRequest)).filter(
    (candidate): candidate is IntentCandidate => Boolean(candidate),
  );

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      right.confidence - left.confidence ||
      left.intent.localeCompare(right.intent),
  );

  const best = candidates[0];

  return {
    intent: best.intent,
    confidence: best.confidence,
    parameters: best.parameters,
    requiresClarification: Boolean(best.requiresClarification),
    clarificationQuestion: best.clarificationQuestion,
    matchedSignals: best.matchedSignals,
  };
}

export function detectIntent(request: IntentRequest): IntentMatch | null {
  const plan = planEmployeeIntent(request);
  if (!plan) {
    return null;
  }

  return {
    intent: plan.intent,
    confidence: plan.confidence,
    parameters: plan.parameters,
  };
}

const INTENT_RESOLVERS: Array<
  (request: IntentPlannerRequest) => IntentCandidate | null
> = [
  resolveHelpIntent,
  resolveIdentityIntent,
  resolveDailyBriefIntent,
  resolveNotificationsIntent,
  resolveMentionsIntent,
  resolveReportingOverviewIntent,
  resolveReportingQuestionIntent,
  resolveWorkspaceActivityIntent,
  resolveTeamSummaryIntent,
  resolveTeamFollowUpIntent,
  resolveNoActivityIntent,
  resolveEmployeeActivityIntent,
  resolveRecordActivityIntent,
  resolveEmployeeSummaryIntent,
  resolveAssignmentReportIntent,
  resolveExceptionReportIntent,
  resolveFollowUpIntent,
  resolveWorkloadIntent,
  resolveCompleteIntent,
  resolveSetDueDateIntent,
  resolveCommentCreateIntent,
  resolveCommentListIntent,
  resolveAssignIntent,
  resolveMoveIntent,
  resolveCreateIntent,
  resolveFocusedDetailIntent,
  resolveDetailIntent,
  resolveSearchIntent,
];

const OPTIONAL_ACTIVITY_MESSAGE_END_PATTERN =
  String.raw`${OPTIONAL_ACTIVITY_DATE_SUFFIX_PATTERN}[.?!]?$`;

function activityMatch(message: string, source: string) {
  return message.match(new RegExp(`${source}${OPTIONAL_ACTIVITY_MESSAGE_END_PATTERN}`, "i"));
}

function activityTest(message: string, source: string) {
  return new RegExp(`${source}${OPTIONAL_ACTIVITY_MESSAGE_END_PATTERN}`, "i").test(
    message,
  );
}

function resolveHelpIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const message = normalize(request.message);

  if (!HELP_MESSAGES.has(message)) {
    return null;
  }

  return candidate("help.overview", 100, 0.98, {}, ["help:overview"]);
}

function resolveIdentityIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const message = normalize(request.message);

  if (!SELF_IDENTITY_MESSAGES.has(message)) {
    return null;
  }

  return candidate("identity.self", 100, 0.99, {}, ["identity:self"]);
}

function resolveDailyBriefIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const rawMessage = request.message.trim();
  const message = normalize(rawMessage);

  if (
    /^(?:start|open)\s+my\s+day[.?!]?$/i.test(rawMessage) ||
    /^(?:show|give|open)(?: me)?\s+(?:my\s+)?(?:daily|day|workday)\s+brief[.?!]?$/i.test(
      rawMessage,
    ) ||
    /^(?:what do i need to know|what needs my attention)(?:\s+today)?[.?!]?$/i.test(
      rawMessage,
    )
  ) {
    return candidate("brief.daily", 97, 0.94, {}, ["brief:daily"]);
  }

  if (message === "my dashboard") {
    return candidate("brief.daily", 90, 0.83, {}, ["brief:dashboard:self"]);
  }

  return null;
}

function resolveNotificationsIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const rawMessage = request.message.trim();
  if (
    /^(?:show|check|get)(?: me)?\s+(?:my\s+)?notifications[.?!]?$/i.test(rawMessage) ||
    /^(?:show|check|get)(?: me)?\s+(?:my\s+)?alerts[.?!]?$/i.test(rawMessage)
  ) {
    return candidate("notifications.feed", 96, 0.91, {}, ["notifications:feed"]);
  }

  return null;
}

function resolveReportingOverviewIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const message = normalize(request.message);

  if (!REPORTING_OVERVIEW_MESSAGES.has(message)) {
    return null;
  }

  return candidate("reporting.overview", 95, 0.9, {}, ["reporting:overview"]);
}

function resolveReportingQuestionIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const message = normalize(request.message);
  const isReportingInventoryMessage =
    /(?:dashboard|dashboards|report|reports|reporting)/.test(message) &&
    /(?:how many|what|which|latest|recent|updated|enterprise|plan|enabled|available)/.test(
      message,
    );

  if (!isReportingInventoryMessage) {
    return null;
  }

  return candidate(
    "reporting.question",
    88,
    0.82,
    {
      question: (request.originalMessage ?? request.message).trim(),
    },
    ["reporting:question"],
  );
}

function resolveTeamSummaryIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const message = normalize(request.message);

  if (
    TEAM_SUMMARY_MESSAGES.has(message) ||
    /^who did what today\??$/.test(message) ||
    ((message.includes("what changed") || message.includes("what happened")) &&
      message.includes("today"))
  ) {
    return candidate("summary.team_day", 92, 0.87, {}, ["summary:team"]);
  }

  const employeeMatch = message.match(/^what did (.+) do today\??$/);
  const target = employeeMatch?.[1]?.trim();
  if (target && TEAM_TARGETS.has(target)) {
    return candidate("summary.team_day", 90, 0.86, {}, ["summary:team"]);
  }

  return null;
}

function resolveTeamFollowUpIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  if (request.actor.roleName !== "admin") {
    return null;
  }

  const rawMessage = request.message.trim();
  const message = normalize(rawMessage);
  const dateRange = resolveActivityDateRangeFromMessage(
    rawMessage,
    request.nowIso,
  );

  if (
    /^who (?:is|has|looks) overdue[.?!]?$/.test(message) ||
    /^who has overdue (?:files|records|work|assignments?)[.?!]?$/.test(message) ||
    /^which employees? (?:is|are|has|have) overdue\b/.test(message) ||
    /^show(?: me)? (?:the )?team follow[- ]?up(?: queue)?[.?!]?$/.test(message) ||
    /^what (?:files|records|work) need attention across the team[.?!]?$/.test(message)
  ) {
    return candidate(
      "records.team_follow_up",
      94,
      0.9,
      {
        date:
          typeof dateRange.dateStart === "string" &&
          dateRange.dateStart === dateRange.dateEnd
            ? dateRange.dateStart
            : undefined,
      },
      ["follow-up:team"],
    );
  }

  return null;
}

function resolveMentionsIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const rawMessage = request.message.trim();
  if (
    /who (?:mentioned|tagged) me/i.test(rawMessage) ||
    /show(?: me)? (?:my )?mentions/i.test(rawMessage)
  ) {
    return candidate(
      "activity.mentions",
      96,
      0.92,
      {
        ...resolveActivityDateRangeFromMessage(rawMessage, request.nowIso),
      },
      ["activity:mentions"],
    );
  }

  return null;
}

function resolveWorkspaceActivityIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  if (request.actor.roleName !== "admin") {
    return null;
  }

  const rawMessage = request.message.trim();
  const message = normalize(rawMessage);
  const dateRange = resolveActivityDateRangeFromMessage(
    rawMessage,
    request.nowIso,
  );

  if (
    activityTest(rawMessage, String.raw`^what (?:changed|happened)`) ||
    activityTest(rawMessage, String.raw`^(?:show(?: me)? )?workspace activity`) ||
    activityTest(rawMessage, String.raw`^(?:show(?: me)? )?all activity`) ||
    activityTest(rawMessage, String.raw`^(?:show(?: me)? )?everything that happened`)
  ) {
    return candidate(
      "activity.workspace_report",
      96,
      0.92,
      {
        activityFocus: "all",
        ...dateRange,
      },
      ["activity:workspace:all"],
    );
  }

  if (
    activityTest(rawMessage, String.raw`^who (?:made|added|left) comments`) ||
    activityTest(rawMessage, String.raw`^who commented`) ||
    activityTest(rawMessage, String.raw`^show(?: me)? who commented`)
  ) {
    return candidate(
      "activity.workspace_report",
      96,
      0.92,
      {
        activityFocus: "comments",
        ...dateRange,
      },
      ["activity:workspace:comments"],
    );
  }

  if (
    activityTest(rawMessage, String.raw`^who moved (?:clients|files|records|people)`) ||
    activityTest(
      rawMessage,
      String.raw`^show(?: me)? who moved (?:clients|files|records|people)`,
    )
  ) {
    return candidate(
      "activity.workspace_report",
      96,
      0.92,
      {
        activityFocus: "moves",
        ...dateRange,
      },
      ["activity:workspace:moves"],
    );
  }

  if (
    activityTest(rawMessage, String.raw`^who created leads`) ||
    activityTest(rawMessage, String.raw`^show(?: me)? who created leads`)
  ) {
    return candidate(
      "activity.workspace_report",
      96,
      0.92,
      {
        activityFocus: "creates",
        ...dateRange,
      },
      ["activity:workspace:creates"],
    );
  }

  const historyMatch =
    activityMatch(rawMessage, String.raw`^(?:what is the )?(?:work )?history for\s+(.+?)`) ||
    activityMatch(rawMessage, String.raw`^(?:show(?: me)? )?(?:the )?audit trail for\s+(.+?)`) ||
    activityMatch(rawMessage, String.raw`^(?:what has|what did)\s+(.+?)\s+been working on`);

  if (historyMatch) {
    const employeeName = historyMatch[1]?.trim();
    if (employeeName && !TEAM_TARGETS.has(normalize(employeeName))) {
      return candidate(
        "activity.user_history",
        96,
        0.92,
        {
          employeeName: normalizeEmployeeTarget(employeeName, request),
          ...dateRange,
        },
        ["activity:user:history"],
      );
    }
  }

  if (
    activityTest(rawMessage, String.raw`^show(?: me)? the activity timeline for`) ||
    /^show(?: me)? (?:today's|yesterday's|this week's|last week's|this month's|last month's) activity timeline[.?!]?$/i.test(
      rawMessage,
    )
  ) {
    return candidate(
      "activity.workspace_report",
      95,
      0.9,
      {
        activityFocus: "timeline",
        ...dateRange,
      },
      ["activity:workspace:timeline"],
    );
  }

  return null;
}

function resolveNoActivityIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const message = normalize(request.message);

  if (
    message.includes("no activity") ||
    message.includes("did nothing today") ||
    message.includes("inactive today")
  ) {
    return candidate(
      "summary.no_activity_day",
      89,
      0.84,
      {},
      ["summary:no-activity"],
    );
  }

  return null;
}

function resolveEmployeeActivityIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  if (request.actor.roleName !== "admin") {
    return null;
  }

  const rawMessage = request.message.trim();
  const dateRange = resolveActivityDateRangeFromMessage(
    rawMessage,
    request.nowIso,
  );
  const timelineTarget =
    activityMatch(
      rawMessage,
      String.raw`^(?:show(?: me)?|give me)\s+(?:the )?activity timeline for\s+(.+?)`,
    )?.[1]?.trim() ??
    activityMatch(
      rawMessage,
      String.raw`^(?:show(?: me)?|give me)\s+(.+?)'?s activity timeline`,
    )?.[1]?.trim();

  if (timelineTarget && !TEAM_TARGETS.has(normalize(timelineTarget))) {
    return candidate(
      "activity.employee_report",
      95,
      0.91,
      {
        employeeName: normalizeEmployeeTarget(timelineTarget, request),
        activityFocus: "timeline",
        ...dateRange,
      },
      ["activity:employee:timeline"],
    );
  }

  const generalTarget =
    activityMatch(
      rawMessage,
      String.raw`^(?:show(?: me)?|tell me|give me)\s+(?:everything|all activity|the full activity)\s+(.+?)\s+did`,
    )?.[1]?.trim() ??
    activityMatch(
      rawMessage,
      String.raw`^(?:show(?: me)?|tell me|give me)\s+(.+?)\s+activity`,
    )?.[1]?.trim() ??
    activityMatch(
      rawMessage,
      String.raw`^(?:show(?: me)?|tell me|give me)\s+(.+?)'?s activity`,
    )?.[1]?.trim() ??
    activityMatch(rawMessage, String.raw`^what exactly did (.+) do`)?.[1]?.trim() ??
    activityMatch(rawMessage, String.raw`^what did (.+) do`)?.[1]?.trim();

  if (generalTarget && !TEAM_TARGETS.has(normalize(generalTarget))) {
    return candidate(
      "activity.employee_report",
      94,
      0.9,
      {
        employeeName: normalizeEmployeeTarget(generalTarget, request),
        activityFocus: "all",
        ...dateRange,
      },
      ["activity:employee:all"],
    );
  }

  const commentsTarget =
    activityMatch(rawMessage, String.raw`^what comments did (.+) make`)?.[1]?.trim() ??
    activityMatch(rawMessage, String.raw`^(?:show(?: me)?|list)\s+(.+?)'?s comments`)?.[1]?.trim() ??
    activityMatch(rawMessage, String.raw`^how many comments did (.+) make`)?.[1]?.trim();

  if (commentsTarget && !TEAM_TARGETS.has(normalize(commentsTarget))) {
    return candidate(
      "activity.employee_report",
      95,
      0.91,
      {
        employeeName: normalizeEmployeeTarget(commentsTarget, request),
        activityFocus: "comments",
        ...dateRange,
      },
      ["activity:employee:comments"],
    );
  }

  const movesTarget =
    activityMatch(
      rawMessage,
      String.raw`^how many (?:clients|files|records|people) did (.+) move`,
    )?.[1]?.trim() ??
    activityMatch(rawMessage, String.raw`^what moves did (.+) make`)?.[1]?.trim() ??
    activityMatch(rawMessage, String.raw`^(?:show(?: me)?|list)\s+(.+?)'?s moves`)?.[1]?.trim();

  if (movesTarget && !TEAM_TARGETS.has(normalize(movesTarget))) {
    return candidate(
      "activity.employee_report",
      95,
      0.91,
      {
        employeeName: normalizeEmployeeTarget(movesTarget, request),
        activityFocus: "moves",
        ...dateRange,
      },
      ["activity:employee:moves"],
    );
  }

  const createsTarget =
    activityMatch(rawMessage, String.raw`^what leads did (.+) create`)?.[1]?.trim() ??
    activityMatch(
      rawMessage,
      String.raw`^(?:show(?: me)?|list)\s+(.+?)'?s created leads`,
    )?.[1]?.trim() ??
    activityMatch(rawMessage, String.raw`^how many leads did (.+) create`)?.[1]?.trim();

  if (createsTarget && !TEAM_TARGETS.has(normalize(createsTarget))) {
    return candidate(
      "activity.employee_report",
      95,
      0.91,
      {
        employeeName: normalizeEmployeeTarget(createsTarget, request),
        activityFocus: "creates",
        ...dateRange,
      },
      ["activity:employee:creates"],
    );
  }

  return null;
}

function resolveRecordActivityIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  if (request.actor.roleName !== "admin") {
    return null;
  }

  const rawMessage = request.message.trim();
  const dateRange = resolveActivityDateRangeFromMessage(
    rawMessage,
    request.nowIso,
  );

  const contextualMoveQuery =
    activityMatch(
      rawMessage,
      String.raw`^where was (this (?:client|file|lead|record)) moved`,
    )?.[1]?.trim();

  if (contextualMoveQuery) {
    return buildRecordActivityCandidate(
      contextualMoveQuery,
      request,
      "moves",
      94,
      0.89,
      "Which client should I check moves for?",
      "activity:record:moves",
      dateRange,
    );
  }

  const timelineQuery =
    activityMatch(
      rawMessage,
      String.raw`^(?:show(?: me)?|give me)\s+(?:the )?(?:activity )?timeline (?:for|on)\s+(.+?)`,
    )?.[1]?.trim();

  if (timelineQuery) {
    return buildRecordActivityCandidate(
      timelineQuery,
      request,
      "timeline",
      94,
      0.9,
      "Which client should I check the timeline for?",
      "activity:record:timeline",
      dateRange,
    );
  }

  const generalQuery =
    activityMatch(
      rawMessage,
      String.raw`^(?:who (?:worked on|touched)|who has touched|show(?: me)? activity on|what happened on|what changed on)\s+(.+?)`,
    )?.[1]?.trim() ??
    activityMatch(
      rawMessage,
      String.raw`^(?:what happened with|what happened to|what happened for|where was)\s+(.+?)`,
    )?.[1]?.trim() ??
    activityMatch(
      rawMessage,
      String.raw`^(?:show(?: me)?|give me) (?:the )?activity (?:for|on)\s+(.+?)`,
    )?.[1]?.trim();

  if (generalQuery) {
    return buildRecordActivityCandidate(
      generalQuery,
      request,
      "all",
      93,
      0.89,
      "Which client should I check activity for?",
      "activity:record:all",
      dateRange,
    );
  }

  const commentsQuery =
    activityMatch(
      rawMessage,
      String.raw`^(?:who commented on|who left comments on|show(?: me)? comments on)\s+(.+?)`,
    )?.[1]?.trim();

  if (commentsQuery) {
    return buildRecordActivityCandidate(
      commentsQuery,
      request,
      "comments",
      94,
      0.9,
      "Which client should I check comments for?",
      "activity:record:comments",
      dateRange,
    );
  }

  const movesQuery =
    activityMatch(
      rawMessage,
      String.raw`^who moved (this (?:client|file|lead|record))`,
    )?.[1]?.trim() ??
    activityMatch(
      rawMessage,
      String.raw`^where was (this (?:client|file|lead|record)) moved`,
    )?.[1]?.trim() ??
    activityMatch(rawMessage, String.raw`^who moved\s+(.+?)`)?.[1]?.trim();

  if (movesQuery && !/^(?:clients|files|records|people)$/i.test(movesQuery)) {
    return buildRecordActivityCandidate(
      movesQuery,
      request,
      "moves",
      92,
      0.87,
      "Which client should I check moves for?",
      "activity:record:moves",
      dateRange,
    );
  }

  return null;
}

function resolveEmployeeSummaryIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const message = normalize(request.message);
  const directMatch = message.match(/^what did (.+) do today\??$/);

  if (directMatch) {
    const target = directMatch[1].trim();
    if (TEAM_TARGETS.has(target)) {
      return null;
    }

    return candidate(
      "summary.employee_day",
      85,
      0.8,
      {
        employeeName:
          target === "i" || target === "me"
            ? request.actor.displayName
            : directMatch[1].trim(),
      },
      ["summary:employee"],
    );
  }

  if (message.includes("what did") && message.includes("today")) {
    return candidate(
      "summary.employee_day",
      72,
      0.72,
      {
        employeeName: request.actor.displayName,
      },
      ["summary:employee:fallback"],
    );
  }

  return null;
}

function resolveExceptionReportIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  if (request.actor.roleName !== "admin") {
    return null;
  }

  const rawMessage = request.message.trim();
  const message = normalize(rawMessage);
  const isClientMissingDocsQuestion =
    /\bdocs?\b.*\bmissing\b.*\b(?:for|from|on)\b/.test(message);
  const isExceptionMessage =
    !isClientMissingDocsQuestion &&
    (/\b(exception|exceptions|incomplete|missing|required fields?|empty fields?|blank fields?|problems?)\b/.test(
      message,
    ) ||
      /^list unassigned (?:records|files|clients|leads)\b/.test(message) ||
      /^show(?: me)? unassigned (?:records|files|clients|leads)\b/.test(message) ||
      /^which files have no\b/.test(message) ||
      /^which files are missing\b/.test(message) ||
      /^show me files missing\b/.test(message) ||
      /^which records have no\b/.test(message) ||
      /^which records are missing\b/.test(message) ||
      /^show me records missing\b/.test(message));

  if (!isExceptionMessage) {
    return null;
  }

  const employeeTarget =
    rawMessage.match(/\bassigned to\s+(.+?)(?:\s+(?:with|that|who)\b|[.?!]?$)/i)?.[1]?.trim() ??
    rawMessage.match(/\bfor\s+(.+?)(?:\s+(?:with|that|who)\b|[.?!]?$)/i)?.[1]?.trim();

  const exceptionFocus = resolveExceptionFocus(message);

  return candidate(
    "records.exception_report",
    93,
    0.9,
    {
      exceptionFocus,
      employeeName:
        employeeTarget && !TEAM_TARGETS.has(normalize(employeeTarget))
          ? normalizeEmployeeTarget(employeeTarget, request)
          : undefined,
    },
    [
      "records:exceptions",
      `records:exceptions:${exceptionFocus}`,
      ...(employeeTarget ? ["records:exceptions:employee"] : []),
    ],
  );
}

function resolveAssignmentReportIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const rawMessage = request.message.trim();
  const message = normalize(rawMessage);
  const referencesAssignments =
    /\b(assignments?|checklist items?|checklist tasks?|tasks assigned|assigned tasks?|tasks?)\b/.test(
      message,
    ) ||
    /^what did .+ complete\??$/.test(message) ||
    /^what did .+ finish\??$/.test(message);
  const asksForAssignmentReport =
    /\b(what|show|which|list|who|tell|about|have|has|did|completed?|done|finished?|open|pending|todo|to do|see|view)\b/.test(
      message,
    );
  const asksAboutAssignmentTooling =
    /\b(assignments?\s+tab|assignments?\s+tool|checklist\s+tab|checklist\s+tool)\b/.test(
      message,
    );

  if (
    !referencesAssignments ||
    (!asksForAssignmentReport && !asksAboutAssignmentTooling)
  ) {
    return null;
  }

  const employeeTarget = resolveAssignmentEmployeeTarget(rawMessage, request);
  const status = resolveAssignmentStatus(message);

  return candidate(
    "assignments.report",
    94,
    0.9,
    {
      assignmentStatus: status,
      employeeName: employeeTarget,
    },
    [
      "assignments:report",
      `assignments:report:${status}`,
      employeeTarget ? "assignments:report:employee" : "assignments:report:self",
    ],
  );
}

function resolveWorkloadIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const rawMessage = request.message.trim();
  const message = normalize(request.message);

  const namedWorkloadTarget =
    rawMessage.match(/^(?:show|list|view|see)(?: me)?\s+([a-z][a-z .-]*?)(?:'s|s)?\s+(?:workload|open files|assigned files|files)[.?!]?$/i)?.[1]?.trim() ??
    rawMessage.match(/^(?:show|list|view|see)(?: me)?\s+(?:the\s+)?(?:workload|open files|assigned files|files)\s+(?:for|of)\s+([a-z][a-z .-]*?)[.?!]?$/i)?.[1]?.trim() ??
    rawMessage.match(/^what(?: is|'s)\s+([a-z][a-z .-]*?)\s+working on[.?!]?$/i)?.[1]?.trim() ??
    rawMessage.match(/^what\s+(?:open files|files|workload)\s+(?:does|do)\s+([a-z][a-z .-]*?)\s+(?:have|has)[.?!]?$/i)?.[1]?.trim();

  if (namedWorkloadTarget && !TEAM_TARGETS.has(normalize(namedWorkloadTarget))) {
    return candidate(
      "records.list_assigned",
      91,
      0.88,
      {
        employeeName: normalizeEmployeeTarget(namedWorkloadTarget, request),
      },
      ["workload:employee"],
    );
  }

  if (
    message.includes("what am i working on") ||
    message.includes("my open files")
  ) {
    return candidate(
      "records.list_assigned",
      92,
      0.88,
      {
        employeeName: request.actor.displayName,
      },
      ["workload:self"],
    );
  }

  const workingOnMatch = message.match(/^what is (.+) working on\??$/);
  if (workingOnMatch) {
    const target = workingOnMatch[1].trim();
    return candidate(
      "records.list_assigned",
      87,
      0.84,
      {
        employeeName:
          target === "i" || target === "me"
            ? request.actor.displayName
            : workingOnMatch[1].trim(),
      },
      ["workload:employee"],
    );
  }

  const openFilesMatch = message.match(
    /^(?:show|list)(?: me)?\s+(.+?)'?s open files[.?!]?$/,
  );
  if (openFilesMatch) {
    return candidate(
      "records.list_assigned",
      84,
      0.81,
      {
        employeeName: openFilesMatch[1].trim(),
      },
      ["workload:open-files"],
    );
  }

  const workloadMatch = message.match(/^(?:show|list)(?: me)?\s+(.+?)\s+workload[.?!]?$/);
  if (workloadMatch) {
    return candidate(
      "records.list_assigned",
      84,
      0.81,
      {
        employeeName: normalizeEmployeeTarget(workloadMatch[1].trim(), request),
      },
      ["workload:employee"],
    );
  }

  return null;
}

function resolveFollowUpIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const rawMessage = request.message.trim();
  const message = normalize(request.message);
  const namedFollowUpTarget =
    rawMessage.match(/^(?:show|list|view|see)(?: me)?\s+([a-z][a-z .-]*?)(?:'s|s)?\s+(?:follow[- ]?ups?|follow[- ]?up queue|stale files|overdue files)[.?!]?$/i)?.[1]?.trim() ??
    rawMessage.match(/^(?:show|list|view|see)(?: me)?\s+(?:the\s+)?(?:follow[- ]?ups?|follow[- ]?up queue|stale files|overdue files)\s+(?:for|of)\s+([a-z][a-z .-]*?)[.?!]?$/i)?.[1]?.trim() ??
    rawMessage.match(/^what does (.+?) need to follow up on\??$/i)?.[1]?.trim() ??
    rawMessage.match(/^which of (.+?)'?s files are stale\??$/i)?.[1]?.trim();

  if (namedFollowUpTarget && !TEAM_TARGETS.has(normalize(namedFollowUpTarget))) {
    return candidate(
      "records.follow_up",
      91,
      0.87,
      {
        employeeName: normalizeEmployeeTarget(namedFollowUpTarget, request),
      },
      ["follow-up:employee"],
    );
  }

  const selfSignals = [
    "what needs follow up today",
    "what do i need to follow up on",
    "which of my files need follow up",
    "which files need follow up today",
    "which of my files are stale",
    "what in my pipeline is stale",
    "which files are overdue",
    "which records are stale",
  ];

  if (selfSignals.some((signal) => message.includes(signal))) {
    return candidate(
      "records.follow_up",
      94,
      0.9,
      {
        employeeName: request.actor.displayName,
      },
      ["follow-up:self"],
    );
  }

  const targetMatch = message.match(
    /^what does (.+?) need to follow up on\??$/,
  );
  if (targetMatch) {
    return candidate(
      "records.follow_up",
      88,
      0.84,
      {
        employeeName: targetMatch[1].trim(),
      },
      ["follow-up:employee"],
    );
  }

  const staleTargetMatch = message.match(
    /^which of (.+?)'?s files are stale\??$/,
  );
  if (staleTargetMatch) {
    return candidate(
      "records.follow_up",
      86,
      0.82,
      {
        employeeName: staleTargetMatch[1].trim(),
      },
      ["follow-up:employee:stale"],
    );
  }

  return null;
}

function resolveCommentCreateIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const rawMessage = request.message.trim();
  const message = normalize(rawMessage);

  if (
    !message.startsWith("add note") &&
    !message.startsWith("add comment") &&
    !message.startsWith("add follow up note") &&
    !message.startsWith("add follow-up note")
  ) {
    return null;
  }

  const rawCommentMatch = rawMessage.match(
    /^add\s+(?:note|comment|follow up note|follow-up note)\s+to\s+(.+?)\s*:\s*(.+)$/i,
  );
  const recordQuery = rawCommentMatch?.[1]?.trim();
  const text = rawCommentMatch?.[2]?.trim();
  const useActiveRecordContext = isContextPointer(recordQuery);

  if (!text) {
    return candidate(
      "comments.create",
      80,
      0.74,
      {
        ...(useActiveRecordContext ? { useActiveRecordContext: true } : {}),
        recordQuery: useActiveRecordContext ? undefined : recordQuery,
      },
      ["comments:create"],
      "What comment should I add?",
    );
  }

  if (!recordQuery) {
    return candidate(
      "comments.create",
      78,
      0.7,
      {
        text,
      },
      ["comments:create"],
      "Which client should I add that comment to?",
    );
  }

  if (useActiveRecordContext && !request.hasActiveRecordContext) {
    return candidate(
      "comments.create",
      82,
      0.76,
      {
        text,
        useActiveRecordContext: true,
      },
      ["comments:create:context"],
      "Which client should I add that comment to?",
    );
  }

  return candidate(
    "comments.create",
    84,
    0.77,
    {
      text,
      ...(useActiveRecordContext
        ? { useActiveRecordContext: true }
        : { recordQuery }),
    },
    [
      useActiveRecordContext ? "comments:create:context" : "comments:create",
    ],
  );
}

function resolveCommentListIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const rawMessage = request.message.trim();
  const message = normalize(rawMessage);
  const rawQuery =
    rawMessage
      .match(
        /^(?:show|list|get)\s+(?:recent\s+)?comments?\s+(?:for|on)\s+(.+?)[.?!]?$/i,
      )?.[1]
      ?.trim() ??
    rawMessage.match(/^comments?\s+(?:for|on)\s+(.+?)[.?!]?$/i)?.[1]?.trim() ??
    rawMessage
      .match(
        /^(?:what(?:'s| is)\s+in|what are)\s+the\s+comments?\s+(?:for|on)\s+(.+?)[.?!]?$/i,
      )?.[1]
      ?.trim() ??
    rawMessage
      .match(
        /^(?:show|list|get)\s+(?:me\s+)?the\s+comments?\s+(?:for|on)\s+(.+?)[.?!]?$/i,
      )?.[1]
      ?.trim();

  if (!rawQuery) {
    if (!message.includes("comment")) {
      return null;
    }

    if (!request.hasActiveRecordContext) {
      return candidate(
        "comments.list_recent",
        72,
        0.66,
        {},
        ["comments:list"],
        "Which client do you want comments for?",
      );
    }

    return candidate(
      "comments.list_recent",
      78,
      0.72,
      {
        useActiveRecordContext: true,
      },
      ["comments:list:context"],
    );
  }

  const useActiveRecordContext = isContextPointer(rawQuery);
  if (useActiveRecordContext && !request.hasActiveRecordContext) {
    return candidate(
      "comments.list_recent",
      80,
      0.72,
      {
        useActiveRecordContext: true,
      },
      ["comments:list:context"],
      "Which client do you want comments for?",
    );
  }

  return candidate(
    "comments.list_recent",
    82,
    0.75,
    useActiveRecordContext
      ? {
          useActiveRecordContext: true,
        }
      : {
          recordQuery: rawQuery,
        },
    [useActiveRecordContext ? "comments:list:context" : "comments:list"],
  );
}

function resolveMoveIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const rawMessage = request.message.trim();
  const moveMatch = rawMessage.match(
    /^(?:move|put|send)\s+(.+?)\s+(?:to|into|in)\s+(.+?)[.?!]?$/i,
  );

  if (!moveMatch) {
    return null;
  }

  const recordQuery = moveMatch[1]?.trim();
  const targetListQuery = moveMatch[2]?.trim();
  const useActiveRecordContext = isContextPointer(recordQuery);

  if (!targetListQuery) {
    return candidate(
      "records.move",
      83,
      0.75,
      {
        ...(useActiveRecordContext ? { useActiveRecordContext: true } : {}),
        recordQuery: useActiveRecordContext ? undefined : recordQuery,
      },
      ["records:move"],
      "Which stage should I move it to?",
    );
  }

  if ((!recordQuery || useActiveRecordContext) && !request.hasActiveRecordContext) {
    return candidate(
      "records.move",
      85,
      0.76,
      {
        targetListQuery,
        ...(useActiveRecordContext ? { useActiveRecordContext: true } : {}),
      },
      ["records:move:context"],
      "Which client should I move?",
    );
  }

  return candidate(
    "records.move",
    86,
    0.78,
    {
      targetListQuery,
      ...(useActiveRecordContext
        ? { useActiveRecordContext: true }
        : { recordQuery }),
    },
    [useActiveRecordContext ? "records:move:context" : "records:move"],
  );
}

function resolveAssignIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const rawMessage = request.message.trim();

  // "assign (task) X to Y"
  const assignMatch = rawMessage.match(
    /^(?:assign|give|reassign)\s+(task\s+)?(.+?)\s+to\s+(.+?)[.?!]?$/i,
  );

  if (!assignMatch) {
    return null;
  }

  const isTask = Boolean(assignMatch[1]);
  const rawEntityQuery = assignMatch[2]?.trim();
  const entityQuery = normalizeAssignmentEntityQuery(rawEntityQuery, isTask);
  const assigneeName = assignMatch[3]?.trim();
  const useActiveRecordContext = isContextPointer(rawEntityQuery);

  const intent = isTask ? "tasks.assign" : "records.assign";

  if (!assigneeName) {
    return candidate(
      intent,
      83,
      0.75,
      {
        ...(useActiveRecordContext ? { useActiveRecordContext: true } : {}),
        entityQuery: useActiveRecordContext ? undefined : entityQuery,
      },
      [`${intent}:no_assignee`],
      "Who should I assign this to?",
    );
  }

  if ((!entityQuery || useActiveRecordContext) && !request.hasActiveRecordContext) {
    return candidate(
      intent,
      85,
      0.76,
      {
        assigneeName,
        ...(useActiveRecordContext ? { useActiveRecordContext: true } : {}),
      },
      [`${intent}:no_record`],
      `Which ${isTask ? "task" : "client"} should I assign to ${assigneeName}?`,
    );
  }

  return candidate(
    intent,
    86,
    0.78,
    {
      assigneeName,
      ...(useActiveRecordContext
        ? { useActiveRecordContext: true }
        : { entityQuery }),
    },
    [useActiveRecordContext ? `${intent}:context` : intent],
  );
}

function resolveCompleteIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const rawMessage = request.message.trim();

  const taskMatch = rawMessage.match(
    /^(?:mark|set|complete|finish)\s+(?:task\s+)?(.+?)\s+(?:as\s+)?done[.?!]?$/i,
  );
  if (taskMatch && /\btask\b/i.test(rawMessage)) {
    return candidate(
      "tasks.complete",
      89,
      0.84,
      {
        taskQuery: taskMatch[1]?.trim(),
      },
      ["tasks:complete"],
    );
  }

  const recordMatch = rawMessage.match(
    /^(?:mark|set|complete|finish)\s+(.+?)\s+(?:as\s+)?done[.?!]?$/i,
  );
  if (recordMatch) {
    const recordQuery = recordMatch[1]?.trim();
    const useActiveRecordContext = isContextPointer(recordQuery);
    return candidate(
      "records.complete",
      88,
      0.82,
      useActiveRecordContext ? { useActiveRecordContext: true } : { entityQuery: recordQuery },
      [useActiveRecordContext ? "records:complete:context" : "records:complete"],
    );
  }

  return null;
}

function resolveSetDueDateIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const rawMessage = request.message.trim();
  const taskMatch = rawMessage.match(
    /^(?:set|change|update)\s+(?:the\s+)?due date\s+for\s+(?:task\s+)?(.+?)\s+to\s+(.+?)[.?!]?$/i,
  );
  if (taskMatch && /\btask\b/i.test(rawMessage)) {
    return candidate(
      "tasks.set_due_date",
      89,
      0.84,
      {
        taskQuery: taskMatch[1]?.trim(),
        dueDate: taskMatch[2]?.trim(),
      },
      ["tasks:set-due-date"],
    );
  }

  const recordMatch = rawMessage.match(
    /^(?:set|change|update)\s+(?:the\s+)?due date\s+for\s+(.+?)\s+to\s+(.+?)[.?!]?$/i,
  );
  if (recordMatch) {
    const recordQuery = recordMatch[1]?.trim();
    const useActiveRecordContext = isContextPointer(recordQuery);
    return candidate(
      "records.set_due_date",
      88,
      0.82,
      useActiveRecordContext
        ? { useActiveRecordContext: true, dueDate: recordMatch[2]?.trim() }
        : { entityQuery: recordQuery, dueDate: recordMatch[2]?.trim() },
      [useActiveRecordContext ? "records:set-due-date:context" : "records:set-due-date"],
    );
  }

  return null;
}

function normalizeAssignmentEntityQuery(
  value: string | undefined,
  isTask: boolean,
) {
  if (!value) {
    return value;
  }

  let normalized = value.trim();
  if (isTask) {
    normalized = normalized
      .replace(/^(?:the\s+)?task\s+/i, "")
      .replace(/\s+task$/i, "")
      .trim();
  } else {
    normalized = normalized
      .replace(/^(?:the\s+)?(?:client|record|file|lead)\s+/i, "")
      .replace(/\s+(?:client|record|file|lead)$/i, "")
      .trim();
  }

  return normalized || value.trim();
}

function resolveCreateIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const parameters = extractCreateLeadParameters(request.message);

  if (!parameters) {
    return null;
  }

  const hasName =
    Boolean(parameters.fullName) ||
    Boolean(parameters.firstName && parameters.lastName);

  if (!hasName) {
    return candidate(
      "records.create",
      80,
      0.72,
      parameters,
      ["records:create"],
      "What is the client's full name?",
    );
  }

  return candidate("records.create", 82, 0.74, parameters, ["records:create"]);
}

function resolveFocusedDetailIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const rawMessage = request.message.trim();
  const blockerQuery =
    rawMessage
      .match(
        /^(?:what(?:'s| is)\s+blocking|what(?:'s| is)\s+holding up)\s+(.+?)[.?!]?$/i,
      )?.[1]
      ?.trim() ??
    rawMessage
      .match(/^(?:what blockers? (?:are|is) (?:on|for))\s+(.+?)[.?!]?$/i)?.[1]
      ?.trim() ??
    rawMessage
      .match(/^(?:show|give me)\s+(?:the )?blockers?\s+(?:for|on)\s+(.+?)[.?!]?$/i)?.[1]
      ?.trim();

  if (blockerQuery) {
    return buildBriefingCandidate(
      blockerQuery,
      request,
      "blockers",
      91,
      0.87,
      "Which client should I check for blockers?",
      "records:detail:blockers",
    );
  }

  const missingDocsQuery =
    rawMessage
      .match(
        /^(?:what docs(?: are)?(?: still)? missing (?:from|for)|what(?: do)? we still need from|what is still needed from)\s+(.+?)[.?!]?$/i,
      )?.[1]
      ?.trim() ??
    rawMessage
      .match(/^(?:show|list)\s+(?:the )?missing docs\s+(?:for|on)\s+(.+?)[.?!]?$/i)?.[1]
      ?.trim();

  if (missingDocsQuery) {
    return buildBriefingCandidate(
      missingDocsQuery,
      request,
      "missing_docs",
      92,
      0.88,
      "Which client should I check for missing items?",
      "records:detail:missing-docs",
    );
  }

  const handoffQuery =
    rawMessage
      .match(
        /^(?:give me )?(?:a )?handoff summary\s+(?:for|on)\s+(.+?)[.?!]?$/i,
      )?.[1]
      ?.trim() ??
    rawMessage
      .match(/^(?:handoff|hand off)\s+(?:for|on)\s+(.+?)[.?!]?$/i)?.[1]
      ?.trim();

  if (!handoffQuery) {
    return null;
  }

  return buildBriefingCandidate(
    handoffQuery,
    request,
    "handoff",
    90,
    0.85,
    "Which client should I prepare a handoff for?",
    "records:detail:handoff",
  );
}

function resolveDetailIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const rawMessage = request.message.trim();
  const message = normalize(rawMessage);
  const callPrepQuery =
    rawMessage
      .match(
        /^(?:prep me for a call with|prepare me for a call with|call prep for|brief me on|give me context before (?:a )?call with)\s+(.+?)[.?!]?$/i,
      )?.[1]
      ?.trim() ??
    rawMessage
      .match(
        /^(?:prep me for (this call|this client)|brief me on (this client))[.?!]?$/i,
      )?.[1]
      ?.trim() ??
    rawMessage
      .match(
        /^(?:prep me for (this call|this client)|brief me on (this client))[.?!]?$/i,
      )?.[2]
      ?.trim();

  if (callPrepQuery) {
    const useActiveRecordContext = isContextPointer(callPrepQuery);
    if (useActiveRecordContext && !request.hasActiveRecordContext) {
      return candidate(
        "records.detail",
        90,
        0.82,
        {
          useActiveRecordContext: true,
          detailMode: "call_prep",
        },
        ["records:detail:call-prep:context"],
        "Which client should I prep you for?",
      );
    }

    return candidate(
      "records.detail",
      92,
      0.88,
      useActiveRecordContext
        ? {
            useActiveRecordContext: true,
            detailMode: "call_prep",
          }
        : {
            recordQuery: callPrepQuery,
            detailMode: "call_prep",
          },
      [useActiveRecordContext ? "records:detail:call-prep:context" : "records:detail:call-prep"],
    );
  }

  const briefingQuery =
    rawMessage
      .match(
        /^(?:what(?:'s| is)\s+(?:going on|up)\s+with|status of|what(?:'s| is) the status of|updates? on|tell me about)\s+(.+?)[.?!]?$/i,
      )?.[1]
      ?.trim() ??
    rawMessage.match(/^(?:summarize|summary of)\s+(.+?)[.?!]?$/i)?.[1]?.trim() ??
    rawMessage
      .match(
        /^(?:give me )?(?:a )?(?:summary|context)\s+(?:for|on)\s+(.+?)[.?!]?$/i,
      )?.[1]
      ?.trim();

  if (briefingQuery) {
    return buildBriefingCandidate(
      briefingQuery,
      request,
      "general",
      88,
      0.83,
      "Which client do you want me to brief you on?",
      "records:detail:briefing",
    );
  }

  const detailQuery = rawMessage
    .match(/^(?:show|open|pull up)(?: me)?\s+(.+?)[.?!]?$/i)?.[1]
    ?.trim();

  if (!detailQuery) {
    return null;
  }

  if (isRoutingExclusion(detailQuery) || detailQuery.toLowerCase().includes("open files")) {
    return null;
  }

  const useActiveRecordContext = isContextPointer(detailQuery);
  if (useActiveRecordContext && !request.hasActiveRecordContext) {
    return candidate(
      "records.detail",
      79,
      0.73,
      {
        useActiveRecordContext: true,
      },
      ["records:detail:context"],
      "Which client do you want me to pull up?",
    );
  }

  if (!useActiveRecordContext && isAdminSelfNameReference(detailQuery, request)) {
    return candidate(
      "records.detail",
      84,
      0.78,
      { recordQuery: detailQuery, detailMode: "default" },
      ["records:detail:self-name:ambiguous"],
      `Do you want your workload or the client ${detailQuery}?`,
    );
  }

  return candidate(
    "records.detail",
    message.startsWith("show ") || message.startsWith("show me ") ? 78 : 88,
    message.startsWith("show ") || message.startsWith("show me ") ? 0.72 : 0.83,
    useActiveRecordContext
      ? { useActiveRecordContext: true, detailMode: "default" }
      : { recordQuery: detailQuery, detailMode: "default" },
    [useActiveRecordContext ? "records:detail:context" : "records:detail"],
  );
}

function buildBriefingCandidate(
  recordQuery: string,
  request: IntentPlannerRequest,
  focus: "general" | "handoff" | "blockers" | "missing_docs",
  score: number,
  confidence: number,
  clarificationQuestion: string,
  signal: string,
) {
  const useActiveRecordContext = isContextPointer(recordQuery);

  if (useActiveRecordContext && !request.hasActiveRecordContext) {
    return candidate(
      "records.detail",
      score - 5,
      Math.max(0.72, confidence - 0.08),
      {
        useActiveRecordContext: true,
        detailMode: "briefing",
        briefingFocus: focus,
      },
      [`${signal}:context`],
      clarificationQuestion,
    );
  }

  return candidate(
    "records.detail",
    score,
    confidence,
    useActiveRecordContext
      ? {
          useActiveRecordContext: true,
          detailMode: "briefing",
          briefingFocus: focus,
        }
      : {
          recordQuery,
          detailMode: "briefing",
          briefingFocus: focus,
        },
    [useActiveRecordContext ? `${signal}:context` : signal],
  );
}

function resolveSearchIntent(
  request: IntentPlannerRequest,
): IntentCandidate | null {
  const rawMessage = request.message.trim();
  const searchMatch = rawMessage.match(
    /^(?:find|search|look up)(?: me)?\s+(.+?)[.?!]?$/i,
  );

  if (!searchMatch) {
    return null;
  }

  return candidate(
    "records.search",
    70,
    0.62,
    {
      query: searchMatch[1]?.trim(),
    },
    ["records:search"],
  );
}

function candidate(
  intent: IntentName,
  score: number,
  confidence: number,
  parameters: Record<string, string | number | boolean | undefined>,
  matchedSignals: string[],
  clarificationQuestion?: string,
): IntentCandidate {
  return {
    intent,
    score,
    confidence,
    parameters,
    matchedSignals,
    requiresClarification: Boolean(clarificationQuestion),
    clarificationQuestion,
  };
}

function extractCreateLeadParameters(message: string) {
  const startsCreateLead =
    /^(?:create|add)\s+(?:a\s+)?(?:new\s+)?(?:lead|client|record)\b/i.test(
      message,
    ) || /^new\s+(?:lead|client|record)\b/i.test(message);

  if (!startsCreateLead) {
    return null;
  }

  const firstName =
    message.match(/first name\s*[:\-]\s*([a-z][a-z' -]+)/i)?.[1]?.trim() ??
    undefined;
  const lastName =
    message.match(/last name\s*[:\-]\s*([a-z][a-z' -]+)/i)?.[1]?.trim() ??
    undefined;
  const fullName =
    message
      .match(
        /(?:full name|name)\s*[:\-]\s*(.+?)(?=,|\n|\s+phone\s+|\s+email\s+|\s+amount\s+|\s+notes?\s*[:\-]|$)/i,
      )?.[1]
      ?.trim() ??
    message
      .match(
        /named\s+(.+?)(?=,|\n|\s+with\s+|\s+phone\s+|\s+email\s+|\s+amount\s+|\s+(?:in|to)\s+(?:list|stage)\s+|\s+notes?\s*[:\-]|$)/i,
      )?.[1]
      ?.trim() ??
    message
      .match(
        /^(?:create|add)\s+(?:a\s+)?(?:new\s+)?(?:lead|client|record)\s+(.+?)(?=,|\n|\s+with\s+|\s+phone\s+|\s+email\s+|\s+amount\s+|\s+(?:in|to)\s+(?:list|stage)\s+|\s+notes?\s*[:\-]|$)/i,
      )?.[1]
      ?.trim() ??
    message
      .match(
        /^new\s+(?:lead|client|record)\s+(.+?)(?=,|\n|\s+with\s+|\s+phone\s+|\s+email\s+|\s+amount\s+|\s+(?:in|to)\s+(?:list|stage)\s+|\s+notes?\s*[:\-]|$)/i,
      )?.[1]
      ?.trim() ??
    undefined;
  const email =
    message.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0] ?? undefined;
  const phone =
    message
      .match(/(?:phone|number|mobile)\s+(?:is\s+)?([+]?\d[\d\s().-]{6,})/i)?.[1]
      ?.trim() ?? undefined;
  const amountMatch = message.match(
    /(?:amount|finance amount|loan amount|mortgage amount)\s+(?:is\s+)?\$?([\d,.]+(?:\.\d+)?[kKmM]?)/i,
  )?.[1];
  const notes =
    message.match(/(?:notes?|note)\s*[:\-]\s*(.+)$/i)?.[1]?.trim() ?? undefined;
  const targetListQuery =
    message
      .match(
        /(?:in|to)\s+(?:list|stage)\s+(.+?)(?=,|\n|\s+phone\s+|\s+email\s+|\s+amount\s+|\s+notes?\s*[:\-]|$)/i,
      )?.[1]
      ?.trim() ?? undefined;

  return {
    fullName,
    firstName,
    lastName,
    email,
    phone,
    financeAmount: normalizeAmountShorthand(amountMatch),
    notes,
    targetListQuery,
  };
}

function normalizeAmountShorthand(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const normalized = value.replaceAll(",", "").trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const multiplier = normalized.endsWith("m")
    ? 1_000_000
    : normalized.endsWith("k")
      ? 1_000
      : 1;
  const numeric = Number(normalized.replace(/[km]$/i, ""));
  if (Number.isNaN(numeric)) {
    return undefined;
  }

  return String(Math.round(numeric * multiplier));
}

function isContextPointer(value: string | undefined) {
  if (!value) {
    return false;
  }

  return CONTEXT_POINTERS.has(normalize(value));
}

function isRoutingExclusion(value: string) {
  return ROUTING_EXCLUSIONS.has(normalize(value));
}

function normalizeEmployeeTarget(
  value: string,
  request: IntentPlannerRequest,
) {
  const cleaned = value
    .trim()
    .replace(/^(?:the\s+)?employee\s+/i, "")
    .replace(/\s+(?:please|pls)$/i, "")
    .trim();
  const normalized = normalize(cleaned);
  return isSelfEmployeeTarget(normalized)
    ? request.actor.displayName
    : cleaned;
}

function isSelfEmployeeTarget(value: string) {
  const normalized = normalize(value).replace(/'s$/i, "");
  return SELF_EMPLOYEE_TARGETS.has(normalized);
}

function resolveExceptionFocus(message: string) {
  if (/\bassignment|unassigned\b|assigned employee\b/.test(message)) {
    return "assignment";
  }

  if (/\bfinance amount\b/.test(message)) {
    return "finance_amount";
  }

  if (/\bdue date\b|\bno due date\b/.test(message)) {
    return "due_date";
  }

  if (/\bclosing date\b/.test(message)) {
    return "closing_date";
  }

  if (/\bphone\b/.test(message)) {
    return "phone";
  }

  if (/\bemail\b/.test(message)) {
    return "email";
  }

  if (/\bcontact\b|\bname\b/.test(message)) {
    return "client_name";
  }

  if (/\bassignee\b|assigned employee/.test(message)) {
    return "assignee";
  }

  return "all";
}

function resolveAssignmentStatus(message: string) {
  if (/\b(completed?|done|finished?|finish|did)\b/.test(message)) {
    return "completed";
  }

  if (/\b(all|everything)\b/.test(message)) {
    return "all";
  }

  return "open";
}

function resolveAssignmentEmployeeTarget(
  rawMessage: string,
  request: IntentPlannerRequest,
) {
  const message = normalize(rawMessage);

  const match =
    rawMessage.match(/^what did\s+(.+?)\s+(?:complete|finish|do)[.?!]?$/i)
      ?.[1]
      ?.trim() ??
    rawMessage.match(/\bwho\s+is\s+(.+?)\s+and\s+what\s+(?:are|is)\s+(?:their|her|his)\s+(?:assignments?|tasks?|checklist items?)/i)
      ?.[1]
      ?.trim() ??
    rawMessage.match(/\b(?:show|list|view|see|tell)(?: me)?(?: about)?\s+([a-z][a-z .-]*?)(?:'s|s)\s+(?:assignments?|tasks?|checklist items?)[.?!]?$/i)
      ?.[1]
      ?.trim() ??
    rawMessage.match(/\b(?:show|list|view|see)(?: me)?\s+(?:the\s+)?(?:assignments?|tasks?|checklist items?)\s+(?:for|of)\s+([a-z][a-z .-]*?)[.?!]?$/i)
      ?.[1]
      ?.trim() ??
    rawMessage.match(/\bwhat\s+(?:are|is)\s+(.+?)'s\s+(?:assignments?|tasks?|checklist items?)(?:\b|[.?!]?$)/i)
      ?.[1]
      ?.trim() ??
    rawMessage.match(/\bwhat\s+(?:are|is)\s+(.+?)s\s+(?:assignments?|tasks?|checklist items?)(?:\b|[.?!]?$)/i)
      ?.[1]
      ?.trim() ??
    rawMessage.match(/\bwhat\s+(?:are|is)\s+(.+?)\s+(?:assignments?|tasks?|checklist items?)(?:\b|[.?!]?$)/i)
      ?.[1]
      ?.trim() ??
    rawMessage.match(/\b(?:assignments?|tasks?|checklist items?)\s+(?:for|of)\s+(.+?)(?:\b|[.?!]?$)/i)
      ?.[1]
      ?.trim() ??
    rawMessage.match(/\b(?:for|assigned to|does|did)\s+(.+?)(?:\s+(?:have|has|need|completed?|done|open|pending|to do|assignments?|tasks?)\b|[.?!]?$)/i)
      ?.[1]
      ?.trim() ??
    rawMessage.match(/^(.+?)'s\s+(?:assignments?|tasks?|checklist items?)/i)?.[1]?.trim() ??
    rawMessage.match(/\bwhat\s+(?:assignments?|tasks?)\s+(?:does|did)\s+(.+?)\s+(?:have|complete|do)/i)?.[1]?.trim();

  if (!match) {
    if (
      /\b(my|me|i have|i need|am i assigned)\b/.test(message) ||
      /^what tasks (?:did|do) i\b/.test(message)
    ) {
      return request.actor.displayName;
    }

    return request.actor.displayName;
  }

  const normalizedMatch = normalize(match);
  if (
    isSelfEmployeeTarget(normalizedMatch) ||
    TEAM_TARGETS.has(normalizedMatch)
  ) {
    return request.actor.displayName;
  }

  return normalizeEmployeeTarget(match, request);
}

function isAdminSelfNameReference(
  value: string,
  request: IntentPlannerRequest,
) {
  if (request.actor.roleName !== "admin") {
    return false;
  }

  const normalizedValue = normalize(value);
  if (!normalizedValue) {
    return false;
  }

  const actorDisplayName = normalize(request.actor.displayName);
  const actorNameParts = actorDisplayName
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  return (
    normalizedValue === actorDisplayName ||
    actorNameParts.includes(normalizedValue)
  );
}

function buildRecordActivityCandidate(
  value: string,
  request: IntentPlannerRequest,
  focus: "all" | "comments" | "moves" | "timeline",
  score: number,
  confidence: number,
  clarificationQuestion: string,
  signal: string,
  dateRange: { dateStart: string; dateEnd: string; dateLabel: string },
) {
  const recordQuery = value.replace(/\s+(?:recently|lately)$/i, "").trim();
  const useActiveRecordContext = isContextPointer(recordQuery);
  if (useActiveRecordContext && !request.hasActiveRecordContext) {
    return candidate(
      "activity.record_report",
      score,
      confidence - 0.05,
      {
        useActiveRecordContext: true,
        activityFocus: focus,
        ...dateRange,
      },
      [`${signal}:context`],
      clarificationQuestion,
    );
  }

  return candidate(
    "activity.record_report",
    score,
    confidence,
    useActiveRecordContext
      ? {
          useActiveRecordContext: true,
          activityFocus: focus,
          ...dateRange,
        }
      : {
          recordQuery,
          activityFocus: focus,
          ...dateRange,
        },
    [useActiveRecordContext ? `${signal}:context` : signal],
  );
}

function normalize(input: string) {
  return input.trim().toLowerCase();
}

function normalizeIntentMessage(input: string) {
  let message = input.trim();
  if (!message) {
    return message;
  }

  let previous = "";
  while (message && message !== previous) {
    previous = message;
    message = message
      .replace(/^(?:aya|hey aya|hi aya|hello aya)[\s,:-]*/i, "")
      .replace(/^(?:please\s+)?(?:can|could|would|will)\s+you\s+/i, "")
      .replace(/^please\s+/i, "")
      .replace(/^(?:help me(?:\s+to)?|i need you to|do me a favor and)\s+/i, "")
      .trim();
  }

  return message.replace(/\s+(?:please|pls)\s*([.?!])?$/i, "$1").trim();
}

const SELF_IDENTITY_MESSAGES = new Set([
  "who am i",
  "who am i?",
  "whoami",
  "who's signed in",
  "who is signed in",
  "what account am i using",
  "which account am i using",
  "what user am i signed in as",
  "which user am i signed in as",
]);

const TEAM_SUMMARY_MESSAGES = new Set([
  "what did everyone do today",
  "what did everyone do today?",
  "what did the team do today",
  "what did the team do today?",
  "what did we do today",
  "what did we do today?",
]);

const REPORTING_OVERVIEW_MESSAGES = new Set([
  "show reporting",
  "show reporting?",
  "show me reporting",
  "show me the reporting",
  "show reports",
  "show me reports",
  "show dashboards",
  "show me dashboards",
]);

const TEAM_TARGETS = new Set(["everyone", "the team", "team", "we"]);
const SELF_EMPLOYEE_TARGETS = new Set([
  "i",
  "me",
  "my",
  "mine",
  "myself",
  "me please",
]);

const CONTEXT_POINTERS = new Set([
  "this",
  "this client",
  "this call",
  "this file",
  "this lead",
  "this record",
  "it",
  "them",
  "that client",
  "that file",
  "that lead",
  "that record",
]);

const ROUTING_EXCLUSIONS = new Set([
  "reporting",
  "the reporting",
  "reports",
  "report",
  "dashboards",
  "dashboard",
  "everyone",
  "the team",
  "team",
  "we",
]);

const HELP_MESSAGES = new Set([
  "hello",
  "hi",
  "hey",
  "help",
  "what can you do",
  "what can you do?",
  "how can you help",
  "how can you help?",
]);
