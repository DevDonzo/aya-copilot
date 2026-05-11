import type { BlueRecordDetail } from "../../blue/record-detail.js";

export type ClientDetailMode = "default" | "briefing" | "call_prep";
export type ClientBriefingFocus =
  | "general"
  | "handoff"
  | "blockers"
  | "missing_docs";

interface ClientBriefingInsights {
  ownerText: string | null;
  bestContactText: string | null;
  dueDate: string | null;
  lastUpdatedDate: string | null;
  latestNoteText: string | null;
  recentNotes: string[];
  blockers: string[];
  pendingDocs: string[];
  nextAction: string | null;
}

const DOC_LABEL_PATTERNS = [
  /\bdoc\b/i,
  /\bdocument\b/i,
  /\bbank\b/i,
  /\bstatement\b/i,
  /\bemployment\b/i,
  /\bletter\b/i,
  /\bpay\s?stub\b/i,
  /\bpayslip\b/i,
  /\bt4\b/i,
  /\bnoa\b/i,
  /\bnotice of assessment\b/i,
  /\bid\b/i,
  /\bidentification\b/i,
  /\blicen[cs]e\b/i,
  /\bcommitment\b/i,
  /\bvoid cheque\b/i,
  /\bincome\b/i,
  /\bdown payment\b/i,
  /\bsource of funds\b/i,
  /\btax\b/i,
];

const BLOCKER_PATTERNS = [
  /\bwaiting on\b/i,
  /\bawaiting\b/i,
  /\bmissing\b/i,
  /\bstill need\b/i,
  /\bneed(?:s|ed)?\b/i,
  /\bpending\b/i,
  /\bblocked by\b/i,
  /\bhold up\b/i,
  /\bno answer\b/i,
  /\bno response\b/i,
  /\bfollow up\b/i,
  /\bcan't proceed\b/i,
  /\bcannot proceed\b/i,
  /\bstale\b/i,
];

export function buildClientDetailResponseText(
  recordTitle: string,
  detail: BlueRecordDetail,
  mode: ClientDetailMode,
  focus: ClientBriefingFocus = "general",
) {
  const insights = buildClientBriefingInsights(detail);

  switch (mode) {
    case "call_prep":
      return buildCallPrepResponseText(recordTitle, detail, insights);
    case "briefing":
      return buildBriefingResponseText(recordTitle, detail, insights, focus);
    case "default":
    default:
      return buildDefaultResponseText(recordTitle, detail, insights);
  }
}

export function buildClientBriefingInsights(
  detail: BlueRecordDetail,
): ClientBriefingInsights {
  const recentNotes = detail.recentActivity
    .filter((item) => item.commentText && item.commentText.trim())
    .slice(0, 4)
    .map(
      (item, index) =>
        `${index + 1}. ${item.actor} (${formatDate(item.occurredAt)}): ${item.commentText}`,
    );

  const latestNoteText = recentNotes[0]?.replace(/^\d+\.\s*/, "") ?? null;
  const ownerText =
    detail.assignees.length > 0
      ? detail.assignees.map((assignee) => assignee.name).join(", ")
      : null;
  const bestContactText = [
    detail.contact.phone ? `Phone: ${detail.contact.phone}` : null,
    detail.contact.email ? `Email: ${detail.contact.email}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  const signalTexts = [
    detail.description,
    ...detail.recentActivity.map((item) => item.commentText ?? item.summary ?? ""),
  ];
  const blockers = dedupeStrings(extractBlockers(signalTexts)).slice(0, 4);
  const pendingDocs = dedupeStrings([
    ...extractPendingDocsFromFields(detail.customFields),
    ...extractPendingDocsFromText(signalTexts),
  ]).slice(0, 5);

  return {
    ownerText,
    bestContactText: bestContactText || null,
    dueDate: formatDate(detail.dueAt),
    lastUpdatedDate: formatDate(detail.updatedAt),
    latestNoteText,
    recentNotes,
    blockers,
    pendingDocs,
    nextAction: buildNextAction(detail, blockers, pendingDocs),
  };
}

function buildDefaultResponseText(
  recordTitle: string,
  detail: BlueRecordDetail,
  insights: ClientBriefingInsights,
) {
  return [
    `${recordTitle} is in ${detail.list}. Status: ${detail.status}.`,
    insights.ownerText ? `Owner: ${insights.ownerText}` : null,
    insights.dueDate ? `Due: ${insights.dueDate}` : null,
    insights.bestContactText,
    insights.recentNotes.length > 0
      ? ["Latest context:", ...insights.recentNotes.slice(0, 3)].join("\n")
      : "No recent comments recorded.",
    insights.blockers[0] ? `Current blocker: ${insights.blockers[0]}` : null,
    insights.pendingDocs.length > 0
      ? `Still needed: ${insights.pendingDocs.slice(0, 2).join("; ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildCallPrepResponseText(
  recordTitle: string,
  detail: BlueRecordDetail,
  insights: ClientBriefingInsights,
) {
  return [
    `Call prep for ${recordTitle}`,
    buildStageLine(detail, insights),
    insights.ownerText ? `Owner: ${insights.ownerText}` : null,
    insights.bestContactText ? `Best contact: ${insights.bestContactText}` : null,
    formatListSection(
      "Current blockers",
      insights.blockers,
      "No explicit blocker is recorded right now.",
    ),
    formatListSection(
      "Still needed from client",
      insights.pendingDocs,
      "No missing documents are explicitly recorded.",
    ),
    insights.latestNoteText
      ? `Latest note: ${insights.latestNoteText}`
      : "Latest note: none recorded yet.",
    insights.recentNotes.length > 1
      ? ["Recent thread:", ...insights.recentNotes.slice(0, 3)].join("\n")
      : null,
    insights.nextAction ? `Next best action: ${insights.nextAction}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildBriefingResponseText(
  recordTitle: string,
  detail: BlueRecordDetail,
  insights: ClientBriefingInsights,
  focus: ClientBriefingFocus,
) {
  const title =
    focus === "handoff"
      ? `Handoff summary for ${recordTitle}`
      : focus === "blockers"
        ? `Blockers for ${recordTitle}`
        : focus === "missing_docs"
          ? `Missing items for ${recordTitle}`
          : `Briefing for ${recordTitle}`;

  const sections = [
    title,
    buildStageLine(detail, insights),
    insights.ownerText ? `Owner: ${insights.ownerText}` : null,
    insights.bestContactText ? `Best contact: ${insights.bestContactText}` : null,
    focus === "missing_docs"
      ? formatListSection(
          "Still needed from client",
          insights.pendingDocs,
          "No missing documents are explicitly recorded.",
        )
      : null,
    focus !== "missing_docs"
      ? formatListSection(
          "Current blockers",
          insights.blockers,
          "No explicit blocker is recorded right now.",
        )
      : null,
    focus !== "blockers"
      ? formatListSection(
          "Still needed from client",
          insights.pendingDocs,
          "No missing documents are explicitly recorded.",
        )
      : null,
    insights.recentNotes.length > 0
      ? ["Recent thread:", ...insights.recentNotes.slice(0, 3)].join("\n")
      : "Recent thread: none recorded yet.",
    insights.nextAction ? `Next best action: ${insights.nextAction}` : null,
  ];

  return sections.filter(Boolean).join("\n");
}

function buildStageLine(
  detail: BlueRecordDetail,
  insights: ClientBriefingInsights,
) {
  return [
    `Stage: ${detail.list}`,
    `Status: ${detail.status}`,
    insights.dueDate ? `Due: ${insights.dueDate}` : null,
    insights.lastUpdatedDate ? `Updated: ${insights.lastUpdatedDate}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

function formatListSection(
  title: string,
  items: string[],
  emptyLine: string,
) {
  return items.length > 0 ? [title + ":", ...items.map((item) => `- ${item}`)].join("\n") : `${title}: ${emptyLine}`;
}

function extractPendingDocsFromFields(fields: BlueRecordDetail["customFields"]) {
  return fields.flatMap((field) => {
    if (!DOC_LABEL_PATTERNS.some((pattern) => pattern.test(field.label))) {
      return [];
    }

    const state = classifyFieldValue(field.value);
    if (state === "complete") {
      return [];
    }

    return [normalizePhrase(field.label)];
  });
}

function extractPendingDocsFromText(texts: string[]) {
  const docs: string[] = [];

  for (const text of texts) {
    for (const sentence of splitSentences(text)) {
      const normalizedSentence = sentence.toLowerCase();
      if (
        DOC_LABEL_PATTERNS.some((pattern) => pattern.test(sentence)) &&
        BLOCKER_PATTERNS.some((pattern) => pattern.test(normalizedSentence))
      ) {
        docs.push(cleanSentence(sentence));
      }
    }
  }

  return docs;
}

function extractBlockers(texts: string[]) {
  const blockers: string[] = [];

  for (const text of texts) {
    for (const sentence of splitSentences(text)) {
      if (BLOCKER_PATTERNS.some((pattern) => pattern.test(sentence))) {
        blockers.push(cleanSentence(sentence));
      }
    }
  }

  return blockers;
}

function buildNextAction(
  detail: BlueRecordDetail,
  blockers: string[],
  pendingDocs: string[],
) {
  if (pendingDocs.length > 0) {
    return `Request ${pendingDocs[0]} and update the file once it is received.`;
  }

  if (blockers.length > 0) {
    return `Clear the main blocker: ${lowercaseFirst(blockers[0])}`;
  }

  if (detail.dueAt) {
    return `Review the file today and decide whether it is ready to move out of ${detail.list}.`;
  }

  return "Review the latest note and confirm the next operational move.";
}

function classifyFieldValue(value: string) {
  const normalized = normalizeValue(value);
  if (!normalized) {
    return "pending";
  }

  if (
    /^(yes|true|complete|completed|received|uploaded|done|verified|approved)$/i.test(
      normalized,
    )
  ) {
    return "complete";
  }

  if (
    /^(no|false|pending|missing|needed|awaiting|requested|not received|incomplete)$/i.test(
      normalized,
    )
  ) {
    return "pending";
  }

  return "other";
}

function splitSentences(value: string) {
  return value
    .split(/[\n.]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanSentence(value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

function normalizePhrase(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeValue(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function formatDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : null;
}

function dedupeStrings(items: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const item of items) {
    const normalized = item.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    output.push(item.trim());
  }

  return output;
}

function lowercaseFirst(value: string) {
  return value.length > 0 ? value[0].toLowerCase() + value.slice(1) : value;
}
