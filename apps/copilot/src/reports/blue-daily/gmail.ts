import fs from "node:fs/promises";
import path from "node:path";

import { google } from "googleapis";

import { config } from "../../config.js";
import type { BlueDailyReportData } from "./types.js";

export interface GmailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface GmailMessageInput {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  html?: string;
  attachments: GmailAttachment[];
}

export async function sendBlueDailyReportEmail(input: {
  reportDate: string;
  workbookPath: string;
  data: BlueDailyReportData;
  recipients?: string[];
  cc?: string[];
}) {
  assertGmailConfig();
  const content = await fs.readFile(input.workbookPath);
  const raw = buildGmailRawMessage({
    from: config.BLUE_DAILY_REPORT_FROM,
    to: input.recipients ?? config.BLUE_DAILY_REPORT_RECIPIENTS,
    cc: input.cc ?? config.BLUE_DAILY_REPORT_CC,
    subject: `Blue Daily Operations Report - ${input.reportDate}`,
    text: "",
    attachments: [
      {
        filename: path.basename(input.workbookPath),
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        content,
      },
    ],
  });

  const oauth2Client = new google.auth.OAuth2(
    config.GOOGLE_GMAIL_CLIENT_ID,
    config.GOOGLE_GMAIL_CLIENT_SECRET,
  );
  oauth2Client.setCredentials({
    refresh_token: config.GOOGLE_GMAIL_REFRESH_TOKEN,
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
}

export function buildBlueDailyEmailBody(data: BlueDailyReportData) {
  void data;
  return "";
}

export function buildGmailRawMessage(input: GmailMessageInput) {
  const boundary = `aya-blue-daily-${Date.now().toString(36)}`;
  const alternativeBoundary = `${boundary}-alt`;
  const lines = [
    `From: ${input.from}`,
    `To: ${input.to.join(", ")}`,
    ...(input.cc?.length ? [`Cc: ${input.cc.join(", ")}`] : []),
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
  ];

  if (input.html) {
    lines.push(
      `--${boundary}`,
      `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
      "",
      `--${alternativeBoundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      input.text,
      "",
      `--${alternativeBoundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      chunkBase64(Buffer.from(input.html, "utf8").toString("base64")),
      "",
      `--${alternativeBoundary}--`,
      "",
    );
  } else {
    lines.push(
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      input.text,
      "",
    );
  }

  for (const attachment of input.attachments) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      "",
      chunkBase64(attachment.content.toString("base64")),
      "",
    );
  }

  lines.push(`--${boundary}--`, "");
  return Buffer.from(lines.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function assertGmailConfig() {
  if (
    !config.GOOGLE_GMAIL_CLIENT_ID ||
    !config.GOOGLE_GMAIL_CLIENT_SECRET ||
    !config.GOOGLE_GMAIL_REFRESH_TOKEN
  ) {
    throw new Error(
      "Gmail OAuth is not configured. Set GOOGLE_GMAIL_CLIENT_ID, GOOGLE_GMAIL_CLIENT_SECRET, and GOOGLE_GMAIL_REFRESH_TOKEN.",
    );
  }
}

function chunkBase64(value: string) {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}
