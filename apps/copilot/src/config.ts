import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

const appRoot = path.resolve(import.meta.dirname, "..");
const workspaceRoot = path.resolve(appRoot, "..", "..");
const safeBlueWorkspaceId = "cmhazc4rl1vkand1eonnmiyjy";
const defaultBlueWorkspaceId =
  process.env.BLUE_WORKSPACE_ID ?? safeBlueWorkspaceId;
const defaultBlueReadWorkspaceId =
  process.env.BLUE_READ_WORKSPACE_ID ??
  process.env.BLUE_WORKSPACE_ID ??
  safeBlueWorkspaceId;
const detectedNodeEnv = process.env.NODE_ENV ?? "development";

const blueConfigEnv = readSimpleEnvFile(
  path.join(os.homedir(), ".config", "blue", "config.env"),
);
const localBlueToken = readLocalBlueToken(
  path.join(workspaceRoot, ".local", "blue-api-token.json"),
);
const forbiddenBlueWorkspaceId = "cmn524yr800e101mh7kn44mhf";
const resolvedBlueWorkspaceId =
  process.env.BLUE_WORKSPACE_ID ??
  blueConfigEnv.BLUE_WORKSPACE_ID ??
  defaultBlueWorkspaceId;
const candidateBlueReadWorkspaceId =
  process.env.BLUE_READ_WORKSPACE_ID ??
  blueConfigEnv.BLUE_READ_WORKSPACE_ID ??
  defaultBlueReadWorkspaceId;
const resolvedBlueReadWorkspaceId =
  candidateBlueReadWorkspaceId === forbiddenBlueWorkspaceId &&
  !process.env.BLUE_READ_WORKSPACE_ID
    ? resolvedBlueWorkspaceId
    : candidateBlueReadWorkspaceId;
const defaultDemoReportFallbackIds = "";

const runtimeEnv = {
  ...blueConfigEnv,
  ...process.env,
  BLUE_WORKSPACE_ID: resolvedBlueWorkspaceId,
  BLUE_READ_WORKSPACE_ID: resolvedBlueReadWorkspaceId,
  BLUE_API_URL:
    process.env.BLUE_API_URL ?? process.env.API_URL ?? blueConfigEnv.API_URL,
  BLUE_AUTH_TOKEN:
    process.env.BLUE_AUTH_TOKEN ??
    process.env.AUTH_TOKEN ??
    blueConfigEnv.AUTH_TOKEN ??
    localBlueToken.secret,
  BLUE_CLIENT_ID:
    process.env.BLUE_CLIENT_ID ??
    process.env.CLIENT_ID ??
    blueConfigEnv.CLIENT_ID ??
    localBlueToken.tokenId,
  BLUE_COMPANY_ID:
    process.env.BLUE_COMPANY_ID ??
    process.env.COMPANY_ID ??
    blueConfigEnv.COMPANY_ID,
  ALLOW_SYSTEM_BLUE_WRITE_FALLBACK:
    process.env.ALLOW_SYSTEM_BLUE_WRITE_FALLBACK ??
    blueConfigEnv.ALLOW_SYSTEM_BLUE_WRITE_FALLBACK ??
    "false",
  BLUE_REPORT_FALLBACK_IDS:
    process.env.BLUE_REPORT_FALLBACK_IDS ?? defaultDemoReportFallbackIds,
  HOSTINGER_API_KEY: process.env.HOSTINGER_API_KEY,
  AYA_MCP_API_KEY: process.env.AYA_MCP_API_KEY,
  AYA_HOSTINGER_MCP_API_KEY: process.env.AYA_HOSTINGER_MCP_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  AYA_CHAT_RUNTIME: process.env.AYA_CHAT_RUNTIME,
  AYA_AGENT_MODEL: process.env.AYA_AGENT_MODEL,
  AYA_AGENT_MAX_STEPS: process.env.AYA_AGENT_MAX_STEPS,
  AYA_AGENT_TIMEOUT_MS: process.env.AYA_AGENT_TIMEOUT_MS,
  AYA_BLUE_AUTH_CACHE_TTL_MS: process.env.AYA_BLUE_AUTH_CACHE_TTL_MS,
  AYA_LLM_PLANNER_ENABLED: process.env.AYA_LLM_PLANNER_ENABLED,
  AYA_LLM_PLANNER_MODEL: process.env.AYA_LLM_PLANNER_MODEL,
  AYA_LLM_PLANNER_TIMEOUT_MS: process.env.AYA_LLM_PLANNER_TIMEOUT_MS,
  BLUE_GRAPHQL_TIMEOUT_MS: process.env.BLUE_GRAPHQL_TIMEOUT_MS,
  BLUE_DAILY_REPORT_ENABLED: process.env.BLUE_DAILY_REPORT_ENABLED,
  BLUE_DAILY_REPORT_TIME: process.env.BLUE_DAILY_REPORT_TIME,
  BLUE_DAILY_REPORT_TIMEZONE: process.env.BLUE_DAILY_REPORT_TIMEZONE,
  BLUE_DAILY_REPORT_RECIPIENTS: process.env.BLUE_DAILY_REPORT_RECIPIENTS,
  BLUE_DAILY_REPORT_CC: process.env.BLUE_DAILY_REPORT_CC,
  BLUE_DAILY_REPORT_FROM: process.env.BLUE_DAILY_REPORT_FROM,
  GOOGLE_GMAIL_CLIENT_ID: process.env.GOOGLE_GMAIL_CLIENT_ID,
  GOOGLE_GMAIL_CLIENT_SECRET: process.env.GOOGLE_GMAIL_CLIENT_SECRET,
  GOOGLE_GMAIL_REFRESH_TOKEN: process.env.GOOGLE_GMAIL_REFRESH_TOKEN,
};

const configSchema = z.object({
  BLUE_WORKSPACE_ID: z.string().default(safeBlueWorkspaceId),
  BLUE_READ_WORKSPACE_ID: z.string().default(safeBlueWorkspaceId),
  BLUE_API_URL: z.string().default("https://api.blue.cc/graphql"),
  BLUE_AUTH_TOKEN: z.string().default(""),
  BLUE_CLIENT_ID: z.string().default(""),
  BLUE_COMPANY_ID: z.string().default(""),
  HOSTINGER_API_KEY: z.string().optional(),
  ALLOW_SYSTEM_BLUE_WRITE_FALLBACK: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  BLUE_INGEST_INTERVAL_MS: z.coerce.number().default(3_600_000),
  BLUE_RECORD_SYNC_LIMIT_PER_LIST: z.coerce.number().default(500),
  BLUE_GRAPHQL_PAGE_SIZE: z.coerce.number().default(200),
  BLUE_GRAPHQL_MAX_CONCURRENCY: z.coerce.number().default(4),
  BLUE_GRAPHQL_RETRY_ATTEMPTS: z.coerce.number().default(5),
  BLUE_GRAPHQL_RETRY_BASE_MS: z.coerce.number().default(300),
  BLUE_GRAPHQL_TIMEOUT_MS: z.coerce.number().default(15_000),
  BLUE_REPORT_FALLBACK_IDS: z
    .string()
    .default(defaultDemoReportFallbackIds)
    .transform((value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  BLUE_WEBHOOK_PUBLIC_URL: z.string().optional(),
  BLUE_WEBHOOK_SECRET: z.string().optional(),
  BLUE_DAILY_REPORT_ENABLED: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  BLUE_DAILY_REPORT_TIME: z.string().default("12:00"),
  BLUE_DAILY_REPORT_TIMEZONE: z.string().default("America/Toronto"),
  BLUE_DAILY_REPORT_RECIPIENTS: z
    .string()
    .default("rsaeed@ayafinancial.com,skhan@ayafinancial.com")
    .transform(parseCsvList),
  BLUE_DAILY_REPORT_CC: z
    .string()
    .default("hamza@ayafinancial.com")
    .transform(parseCsvList),
  BLUE_DAILY_REPORT_FROM: z.string().default("hamza@ayafinancial.com"),
  GOOGLE_GMAIL_CLIENT_ID: z.string().optional(),
  GOOGLE_GMAIL_CLIENT_SECRET: z.string().optional(),
  GOOGLE_GMAIL_REFRESH_TOKEN: z.string().optional(),
  AYA_MCP_API_KEY: z.string().optional(),
  AYA_HOSTINGER_MCP_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  AYA_CHAT_RUNTIME: z
    .enum(["planner", "agent", "agent_with_planner_fallback"])
    .default("agent"),
  AYA_AGENT_MODEL: z.string().default("gpt-4o-mini"),
  AYA_AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(8).default(3),
  AYA_AGENT_TIMEOUT_MS: z.coerce.number().default(30_000),
  AYA_BLUE_AUTH_CACHE_TTL_MS: z.coerce.number().min(0).default(43_200_000),
  AYA_LLM_PLANNER_ENABLED: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() === "true"),
  AYA_LLM_PLANNER_MODEL: z.string().default("gpt-4o-mini"),
  AYA_LLM_PLANNER_TIMEOUT_MS: z.coerce.number().default(2_500),
  WORKSPACE_FULL_RECONCILE_HOURS: z.coerce.number().default(6),
  AUTH_SESSION_TTL_HOURS: z.coerce.number().default(12),
  AUTH_BOOTSTRAP_KEY: z.string().optional(),
  ALLOW_BOOTSTRAP_PROVISIONING: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  AYA_DATA_DIR: z.string().optional(),
  AYA_DB_PATH: z.string().optional(),
  AUDIT_STDOUT_MODE: z.enum(["metadata", "full"]).optional(),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  LIBRECHAT_MONGO_URI: z
    .string()
    .default("mongodb://127.0.0.1:27018/LibreChat"),
  LIBRECHAT_MONGO_DB_NAME: z.string().default("LibreChat"),
  ENABLE_BLUE_POLLING: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() === "true"),
  ALLOW_DEV_DEFAULT_ACTOR: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(3010),
});

export const config = assertConfigSafety(configSchema.parse(runtimeEnv));
export const resolvedAuditStdoutMode =
  config.AUDIT_STDOUT_MODE ??
  (config.NODE_ENV === "production" ? "metadata" : "full");

function readSimpleEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return {} as Record<string, string>;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const entries: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    entries[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }

  return entries;
}

function readLocalBlueToken(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return {} as { tokenId?: string; secret?: string };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      tokenId?: string;
      secret?: string;
    };
    return parsed;
  } catch {
    return {} as { tokenId?: string; secret?: string };
  }
}

function parseCsvList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function assertConfigSafety<T extends {
  BLUE_WORKSPACE_ID: string;
  BLUE_READ_WORKSPACE_ID: string;
  BLUE_AUTH_TOKEN?: string;
  BLUE_CLIENT_ID?: string;
  BLUE_COMPANY_ID?: string;
  NODE_ENV: string;
  AUDIT_STDOUT_MODE?: string;
  AUTH_BOOTSTRAP_KEY?: string;
  ALLOW_DEV_DEFAULT_ACTOR: boolean;
  ALLOW_SYSTEM_BLUE_WRITE_FALLBACK: boolean;
  ALLOW_BOOTSTRAP_PROVISIONING: boolean;
  AYA_MCP_API_KEY?: string;
  BLUE_WEBHOOK_PUBLIC_URL?: string;
  BLUE_DAILY_REPORT_ENABLED: boolean;
  BLUE_DAILY_REPORT_TIME: string;
  BLUE_DAILY_REPORT_RECIPIENTS: string[];
  BLUE_DAILY_REPORT_FROM: string;
  GOOGLE_GMAIL_CLIENT_ID?: string;
  GOOGLE_GMAIL_CLIENT_SECRET?: string;
  GOOGLE_GMAIL_REFRESH_TOKEN?: string;
}>(parsed: T) {
  if (parsed.BLUE_WORKSPACE_ID === forbiddenBlueWorkspaceId) {
    throw new Error(
      `Refusing to boot with forbidden BLUE_WORKSPACE_ID ${forbiddenBlueWorkspaceId}`,
    );
  }

  if (parsed.BLUE_READ_WORKSPACE_ID === forbiddenBlueWorkspaceId) {
    throw new Error(
      `Refusing to boot with forbidden BLUE_READ_WORKSPACE_ID ${forbiddenBlueWorkspaceId}`,
    );
  }

  if (parsed.ALLOW_BOOTSTRAP_PROVISIONING && !parsed.AUTH_BOOTSTRAP_KEY) {
    throw new Error(
      "ALLOW_BOOTSTRAP_PROVISIONING requires AUTH_BOOTSTRAP_KEY to be set",
    );
  }

  if (parsed.NODE_ENV === "production" && !parsed.AYA_MCP_API_KEY) {
    throw new Error("AYA_MCP_API_KEY must be set in production");
  }

  if (parsed.NODE_ENV === "production") {
    if (!parsed.BLUE_COMPANY_ID || !parsed.BLUE_CLIENT_ID || !parsed.BLUE_AUTH_TOKEN) {
      throw new Error(
        "BLUE_COMPANY_ID, BLUE_CLIENT_ID, and BLUE_AUTH_TOKEN must be set in production",
      );
    }

    if (!parsed.BLUE_WEBHOOK_PUBLIC_URL) {
      throw new Error("BLUE_WEBHOOK_PUBLIC_URL must be set in production");
    }

    if (parsed.ALLOW_SYSTEM_BLUE_WRITE_FALLBACK) {
      throw new Error(
        "ALLOW_SYSTEM_BLUE_WRITE_FALLBACK must be false in production",
      );
    }

    if (parsed.ALLOW_DEV_DEFAULT_ACTOR) {
      throw new Error("ALLOW_DEV_DEFAULT_ACTOR must be false in production");
    }

    if (parsed.ALLOW_BOOTSTRAP_PROVISIONING) {
      throw new Error("ALLOW_BOOTSTRAP_PROVISIONING must be false in production");
    }

    if (parsed.AUDIT_STDOUT_MODE === "full") {
      throw new Error("AUDIT_STDOUT_MODE=full is not allowed in production");
    }
  }

  const [reportHour, reportMinute] = parsed.BLUE_DAILY_REPORT_TIME
    .split(":")
    .map(Number);
  if (
    !/^\d{2}:\d{2}$/.test(parsed.BLUE_DAILY_REPORT_TIME) ||
    reportHour == null ||
    reportMinute == null ||
    reportHour < 0 ||
    reportHour > 23 ||
    reportMinute < 0 ||
    reportMinute > 59
  ) {
    throw new Error("BLUE_DAILY_REPORT_TIME must use HH:mm format");
  }

  if (parsed.BLUE_DAILY_REPORT_ENABLED) {
    if (parsed.BLUE_WORKSPACE_ID !== safeBlueWorkspaceId) {
      throw new Error(
        `BLUE_DAILY_REPORT_ENABLED requires BLUE_WORKSPACE_ID ${safeBlueWorkspaceId}`,
      );
    }

    if (parsed.BLUE_READ_WORKSPACE_ID !== safeBlueWorkspaceId) {
      throw new Error(
        `BLUE_DAILY_REPORT_ENABLED requires BLUE_READ_WORKSPACE_ID ${safeBlueWorkspaceId}`,
      );
    }

    if (parsed.BLUE_DAILY_REPORT_RECIPIENTS.length === 0) {
      throw new Error("BLUE_DAILY_REPORT_RECIPIENTS must include at least one address");
    }

    if (
      !parsed.GOOGLE_GMAIL_CLIENT_ID ||
      !parsed.GOOGLE_GMAIL_CLIENT_SECRET ||
      !parsed.GOOGLE_GMAIL_REFRESH_TOKEN
    ) {
      throw new Error(
        "BLUE_DAILY_REPORT_ENABLED requires GOOGLE_GMAIL_CLIENT_ID, GOOGLE_GMAIL_CLIENT_SECRET, and GOOGLE_GMAIL_REFRESH_TOKEN",
      );
    }
  }

  return parsed;
}
