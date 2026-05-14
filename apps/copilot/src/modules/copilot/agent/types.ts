import type {
  BlueRequestAuth,
  EmployeeIdentity,
  IntentName,
} from "../../../domain/types.js";

export interface AyaAgentContext {
  actor: EmployeeIdentity;
  transport: string;
  blueAuth: BlueRequestAuth | null;
  message: string;
  nowIso: string;
  hasActiveRecordContext: boolean;
  activeRecordContext?: {
    recordId: string;
    recordTitle: string;
    listTitle?: string | null;
  } | null;
}

export interface AyaAgentToolTrace {
  toolName: string;
  intent?: IntentName;
  input: unknown;
  outcome: "success" | "error";
  responseText?: string;
  errorMessage?: string;
  resultSummary?: unknown;
  resultData?: unknown;
}

export interface AyaAgentResult {
  matched: boolean;
  intent?: IntentName;
  responseText: string;
  data?: unknown;
  model: string;
  toolCalls: AyaAgentToolTrace[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}
