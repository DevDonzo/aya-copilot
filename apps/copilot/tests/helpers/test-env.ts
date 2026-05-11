import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function createTestEnvironment(
  overrides: Record<string, string> = {},
) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aya-copilot-test-"));
  const dbPath = path.join(tempDir, "aya-copilot.sqlite");
  const snapshot = new Map<string, string | undefined>();

  const nextEnv: Record<string, string> = {
    AYA_DB_PATH: dbPath,
    BLUE_API_URL: "https://blue.test/graphql",
    BLUE_AUTH_TOKEN: "test-secret",
    BLUE_CLIENT_ID: "test-client",
    BLUE_COMPANY_ID: "test-company",
    BLUE_WORKSPACE_ID: "cmn524yr800e101mh7kn44mhf",
    NODE_ENV: "test",
    PORT: "0",
    LOG_LEVEL: "silent",
    ...overrides,
  };

  for (const [key, value] of Object.entries(nextEnv)) {
    snapshot.set(key, process.env[key]);
    process.env[key] = value;
  }

  return {
    dbPath,
    tempDir,
    cleanup() {
      for (const [key, value] of snapshot.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }

      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

