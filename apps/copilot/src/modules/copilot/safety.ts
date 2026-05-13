export interface SafetyBlock {
  code: "BULK_DESTRUCTIVE_ACTION";
  responseText: string;
}

const bulkTargetPattern =
  /\b(?:all|every|each)\s+(?:record|records|client|clients|file|files|lead|leads|todo|todos|task|tasks|assignment|assignments)\b/;
const workspaceWidePattern = /\b(?:all|entire|whole)\s+workspace\b/;
const bulkOperationPattern =
  /\b(?:bulk|mass)\s+(?:move|delete|remove|archive|complete|finish|close|assign|reassign|update|change|set)\b/;
const destructiveVerbPattern =
  /\b(?:move|delete|remove|archive|complete|finish|close|mark|assign|reassign|update|change|set)\b/;

const BULK_DESTRUCTIVE_RESPONSE =
  "I cannot perform bulk destructive actions like moving, deleting, completing, assigning, or updating every record at once. Pick one specific client/file or a clearly bounded QA record in the allowed workspace.";

export function getPreAuthSafetyBlock(message: string): SafetyBlock | null {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  const hasBulkTarget =
    bulkTargetPattern.test(normalized) ||
    workspaceWidePattern.test(normalized) ||
    bulkOperationPattern.test(normalized);
  const hasDestructiveVerb = destructiveVerbPattern.test(normalized);

  if (!hasBulkTarget || !hasDestructiveVerb) {
    return null;
  }

  return {
    code: "BULK_DESTRUCTIVE_ACTION",
    responseText: BULK_DESTRUCTIVE_RESPONSE,
  };
}
