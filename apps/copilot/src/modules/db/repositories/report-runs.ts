import { db } from "../kysely.js";

export type ReportSendStatus =
  | "dry_run"
  | "generated"
  | "sent"
  | "failed"
  | "skipped_duplicate";

export async function hasSentReportRun(input: {
  reportType: string;
  reportDate: string;
}) {
  const row = await db
    .selectFrom("report_runs")
    .select("id")
    .where("report_type", "=", input.reportType)
    .where("report_date", "=", input.reportDate)
    .where("send_status", "=", "sent")
    .executeTakeFirst();

  return Boolean(row);
}

export async function insertReportRun(input: {
  id: string;
  reportType: string;
  reportDate: string;
  sendStatus: ReportSendStatus;
  recipients: string[];
  generatedFilename?: string | null;
  rowCounts?: Record<string, number>;
  sentAt?: string | null;
  errorMessage?: string | null;
}) {
  await db
    .insertInto("report_runs")
    .values({
      id: input.id,
      report_type: input.reportType,
      report_date: input.reportDate,
      send_status: input.sendStatus,
      recipients: JSON.stringify(input.recipients),
      generated_filename: input.generatedFilename ?? null,
      row_counts_json: JSON.stringify(input.rowCounts ?? {}),
      sent_at: input.sentAt ?? null,
      error_message: input.errorMessage ?? null,
      updated_at: new Date().toISOString(),
    })
    .execute();
}

export async function listReportRuns(input: {
  reportType?: string;
  reportDate?: string;
  limit?: number;
}) {
  let query = db
    .selectFrom("report_runs")
    .selectAll()
    .$if(Boolean(input.reportType), (qb) =>
      qb.where("report_type", "=", input.reportType!),
    )
    .$if(Boolean(input.reportDate), (qb) =>
      qb.where("report_date", "=", input.reportDate!),
    );

  return await query
    .orderBy("created_at", "desc")
    .limit(input.limit ?? 50)
    .execute();
}
