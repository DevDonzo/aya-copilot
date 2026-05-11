import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";

import { config } from "../../config.js";
import type { AyaDatabase } from "../../types/db.js";
import { runMigrations } from "./migrations/index.js";

const appRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const dataDir = config.AYA_DATA_DIR
  ? path.resolve(config.AYA_DATA_DIR)
  : path.join(appRoot, "data");
const dbPath = config.AYA_DB_PATH
  ? path.resolve(config.AYA_DB_PATH)
  : resolveDefaultDbPath(dataDir);

fs.mkdirSync(dataDir, { recursive: true });

export const sqlite = new BetterSqlite3(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = new Kysely<AyaDatabase>({
  dialect: new SqliteDialect({
    database: sqlite as never,
  }),
});

let migrationsPromise: Promise<void> | null = null;

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function initializeDatabase() {
  if (!migrationsPromise) {
    migrationsPromise = runMigrations();
  }

  await migrationsPromise;
}

export { dbPath };

function resolveDefaultDbPath(baseDir: string): string {
  const currentPath = path.join(baseDir, "aya-copilot.sqlite");
  const legacyPath = path.join(baseDir, "aya-ops-bot.sqlite");

  if (fs.existsSync(legacyPath) && !fs.existsSync(currentPath)) {
    return legacyPath;
  }

  return currentPath;
}
