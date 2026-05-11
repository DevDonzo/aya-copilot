import {
  deletePendingRecordChoice,
  getPendingRecordChoice,
  upsertPendingRecordChoice,
} from "../../db.js";
import type { EmployeeIdentity } from "../../domain/types.js";
import { normalizeCacheQuery } from "../db/repositories/helpers.js";

const PENDING_RECORD_CHOICE_TTL_MS = 15 * 60 * 1000;

export interface PendingRecordCandidate {
  id: string;
  title: string;
  listTitle?: string;
}

export interface PendingRecordChoiceContext {
  transport: string;
  continuationAction: string;
  originalQuery?: string | null;
  pendingParameters: Record<string, unknown>;
  candidates: PendingRecordCandidate[];
}

export async function rememberPendingRecordChoice(input: {
  actor: EmployeeIdentity;
  transport: string;
  continuationAction: string;
  originalQuery?: string | null;
  pendingParameters?: Record<string, unknown>;
  candidates: PendingRecordCandidate[];
}) {
  if (!input.actor.employeeId || input.candidates.length === 0) {
    return;
  }

  await upsertPendingRecordChoice({
    employeeId: input.actor.employeeId,
    transport: input.transport,
    continuationAction: input.continuationAction,
    originalQuery: input.originalQuery ?? null,
    pendingParametersJson: JSON.stringify(input.pendingParameters ?? {}),
    candidatesJson: JSON.stringify(input.candidates),
    expiresAt: new Date(Date.now() + PENDING_RECORD_CHOICE_TTL_MS).toISOString(),
  });
}

export async function clearPendingRecordChoiceForActor(
  actor: EmployeeIdentity,
  transport?: string,
) {
  if (!actor.employeeId) {
    return;
  }

  await deletePendingRecordChoice(actor.employeeId, transport);
}

export async function getPendingRecordChoiceForActor(
  actor: EmployeeIdentity,
  transport?: string,
): Promise<PendingRecordChoiceContext | null> {
  if (!actor.employeeId) {
    return null;
  }

  const row = await getPendingRecordChoice(actor.employeeId, transport);
  if (!row) {
    return null;
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await deletePendingRecordChoice(actor.employeeId);
    return null;
  }

  try {
    if (transport && row.transport !== transport) {
      return null;
    }

    return {
      transport: row.transport,
      continuationAction: row.continuation_action,
      originalQuery: row.original_query,
      pendingParameters: row.pending_parameters_json
        ? (JSON.parse(row.pending_parameters_json) as Record<string, unknown>)
        : {},
      candidates: JSON.parse(row.candidates_json) as PendingRecordCandidate[],
    };
  } catch {
    await deletePendingRecordChoice(actor.employeeId);
    return null;
  }
}

export async function resolvePendingRecordChoice(input: {
  actor: EmployeeIdentity;
  transport?: string;
  message: string;
}) {
  const context = await getPendingRecordChoiceForActor(input.actor, input.transport);
  if (!context || context.candidates.length === 0) {
    return null;
  }

  const selection = selectCandidateFromMessage(
    input.message,
    context.candidates,
    context.originalQuery ?? undefined,
  );
  if (!selection) {
    return null;
  }

  return {
    context,
    candidate: selection,
  };
}

export function selectCandidateFromMessage(
  message: string,
  candidates: PendingRecordCandidate[],
  originalQuery?: string,
) {
  const normalizedMessage = normalizeCacheQuery(message);
  const normalizedOriginalQuery = originalQuery
    ? normalizeCacheQuery(originalQuery)
    : "";
  const ordinalIndex = parseOrdinalSelection(normalizedMessage);
  if (ordinalIndex != null) {
    const resolvedIndex =
      ordinalIndex >= 0 ? ordinalIndex : candidates.length + ordinalIndex;
    if (candidates[resolvedIndex]) {
      return candidates[resolvedIndex];
    }
  }

  if (isGenericPointer(normalizedMessage)) {
    return null;
  }

  const tokens = normalizedMessage
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !FILLER_WORDS.has(token));

  if (tokens.length === 0) {
    return null;
  }

  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(
        candidate,
        normalizedMessage,
        tokens,
        normalizedOriginalQuery,
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) {
    return null;
  }

  if (scored.length > 1 && scored[0].score === scored[1].score) {
    return null;
  }

  return scored[0].candidate;
}

function parseOrdinalSelection(normalizedMessage: string) {
  const numericMatch = normalizedMessage.match(
    /^(?:option |number |#)?(\d{1,2})(?:[.)])?$/,
  );
  if (numericMatch) {
    return Math.max(0, Number(numericMatch[1]) - 1);
  }

  if (normalizedMessage === "last" || normalizedMessage === "last one") {
    return -1;
  }

  if (normalizedMessage === "final" || normalizedMessage === "final one") {
    return -1;
  }

  const ordinalMap: Array<[string, number]> = [
    ["first", 0],
    ["1st", 0],
    ["one", 0],
    ["second", 1],
    ["2nd", 1],
    ["two", 1],
    ["third", 2],
    ["3rd", 2],
    ["three", 2],
    ["fourth", 3],
    ["4th", 3],
    ["four", 3],
    ["fifth", 4],
    ["5th", 4],
    ["five", 4],
  ];

  for (const [phrase, index] of ordinalMap) {
    if (
      normalizedMessage === phrase ||
      normalizedMessage === `the ${phrase}` ||
      normalizedMessage === `${phrase} one` ||
      normalizedMessage === `the ${phrase} one` ||
      normalizedMessage === `option ${phrase}`
    ) {
      return index;
    }
  }

  return null;
}

function isGenericPointer(normalizedMessage: string) {
  return GENERIC_POINTERS.has(normalizedMessage);
}

function scoreCandidate(
  candidate: PendingRecordCandidate,
  normalizedMessage: string,
  tokens: string[],
  normalizedOriginalQuery: string,
) {
  const normalizedTitle = normalizeCacheQuery(candidate.title);
  const display = normalizeCacheQuery(
    candidate.listTitle
      ? `${candidate.title} ${candidate.listTitle}`
      : candidate.title,
  );
  const displayTokens = new Set(display.split(" ").filter(Boolean));
  const matchCount = tokens.filter((token) => display.includes(token)).length;
  const densityBonus =
    matchCount > 0 ? matchCount / Math.max(displayTokens.size, 1) : 0;
  const originalQueryBonus = normalizedOriginalQuery
    ? scoreOriginalQueryAnchor(normalizedTitle, normalizedOriginalQuery)
    : 0;

  if (display === normalizedMessage) {
    return 100;
  }

  if (tokens.every((token) => display.includes(token))) {
    return 80 + tokens.length + densityBonus + originalQueryBonus;
  }

  return 0;
}

function scoreOriginalQueryAnchor(
  normalizedTitle: string,
  normalizedOriginalQuery: string,
) {
  if (!normalizedOriginalQuery) {
    return 0;
  }

  if (normalizedTitle === normalizedOriginalQuery) {
    return 5;
  }

  if (normalizedTitle.startsWith(normalizedOriginalQuery)) {
    return 4;
  }

  const index = normalizedTitle.indexOf(normalizedOriginalQuery);
  if (index >= 0) {
    return Math.max(1, 3 - index / 50);
  }

  return 0;
}

const FILLER_WORDS = new Set([
  "the",
  "that",
  "this",
  "one",
  "client",
  "record",
  "file",
  "lead",
  "deal",
  "details",
  "detail",
  "comments",
  "comment",
  "show",
  "get",
  "give",
  "me",
  "on",
  "for",
  "please",
  "update",
]);

const GENERIC_POINTERS = new Set([
  "that",
  "that one",
  "this",
  "this one",
  "the one",
  "that client",
  "this client",
  "that record",
  "this record",
  "that file",
  "this file",
]);
