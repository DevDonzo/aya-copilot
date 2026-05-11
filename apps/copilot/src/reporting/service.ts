import { config } from "../config.js";
import type { BlueRequestAuth } from "../domain/types.js";
import {
  fetchBlueDashboards,
  fetchBlueReportingCapability,
  fetchBlueReports,
} from "../modules/blue/graphql/client.js";

export async function getReportingOverview(input?: {
  auth?: BlueRequestAuth | null;
}) {
  const capability = await fetchBlueReportingCapability({
    companyId: config.BLUE_COMPANY_ID,
    auth: input?.auth ?? null,
  });
  const dashboards = capability.supportsDashboards
    ? await fetchBlueDashboards({
        companyId: config.BLUE_COMPANY_ID,
        take: 12,
        auth: input?.auth ?? null,
      })
    : { items: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } };
  const shouldLoadReports =
    capability.supportsReports || config.BLUE_REPORT_FALLBACK_IDS.length > 0;
  const reports = shouldLoadReports
    ? await fetchBlueReports({
        companyId: config.BLUE_COMPANY_ID,
        take: 12,
        auth: input?.auth ?? null,
      })
    : { items: [], totalCount: 0, hasNextPage: false, hasPreviousPage: false };
  const reportsStatusText = reports.items.length
    ? "Saved Blue reports are available in this workspace."
    : capability.supportsReports
      ? "Enterprise reporting is enabled."
      : "Enterprise reporting is not enabled yet.";

  const summaryText = [
    `${capability.companyName ?? "Blue company"} reporting summary.`,
    `Plan: ${capability.plan?.planName ?? capability.plan?.planId ?? capability.subscriptionStatus ?? "unknown"}.`,
    reportsStatusText,
    `Dashboards available: ${dashboards.items.length}.`,
    `Reports available: ${reports.items.length}.`,
    dashboards.items.length
      ? `Dashboard titles: ${dashboards.items.map((item) => item.title).slice(0, 5).join(", ")}.`
      : "No dashboards returned.",
    reports.items.length
      ? `Report titles: ${reports.items.map((item) => item.title).slice(0, 5).join(", ")}.`
      : "No reports returned.",
  ].join(" ");

  return {
    capability,
    dashboards,
    reports,
    summaryText,
  };
}

export async function answerReportingQuestion(input: {
  question: string;
  auth?: BlueRequestAuth | null;
}) {
  const overview = await getReportingOverview({ auth: input.auth ?? null });
  const question = input.question.trim().toLowerCase();

  let answerText: string;

  if (question.includes("enterprise") || question.includes("plan")) {
    answerText = [
      `Plan status: ${overview.capability.plan?.planName ?? overview.capability.plan?.planId ?? overview.capability.subscriptionStatus ?? "unknown"}.`,
      overview.reports.items.length > 0
        ? "Saved Blue reports are available in this workspace."
        : overview.capability.supportsReports
          ? "Enterprise reporting is enabled."
          : "Enterprise reporting is not enabled yet.",
    ].join(" ");
  } else if (question.includes("dashboard")) {
    answerText =
      overview.dashboards.items.length === 0
        ? overview.reports.items.length > 0
          ? `Blue is not returning dashboard objects right now, but there are ${overview.reports.items.length} reports available: ${overview.reports.items
              .map((item) => item.title)
              .join(", ")}.`
          : "No dashboards are currently returned from Blue."
        : `There are ${overview.dashboards.items.length} dashboards: ${overview.dashboards.items
            .map((item) => item.title)
            .join(", ")}.`;
  } else if (question.includes("report")) {
    answerText =
      overview.reports.items.length === 0
        ? overview.capability.supportsReports || config.BLUE_REPORT_FALLBACK_IDS.length > 0
          ? "No reports are currently returned from Blue."
          : "Blue reports are staged here, but Enterprise reporting is not enabled yet."
        : `There are ${overview.reports.items.length} reports: ${overview.reports.items
            .map((item) => item.title)
            .join(", ")}.`;
  } else if (
    question.includes("latest") ||
    question.includes("recent") ||
    question.includes("updated")
  ) {
    const latestDashboard = [...overview.dashboards.items].sort((left, right) =>
      left.updatedAt < right.updatedAt ? 1 : -1,
    )[0];
    const latestReport = [...overview.reports.items].sort((left, right) =>
      (left.lastGeneratedAt ?? left.updatedAt) < (right.lastGeneratedAt ?? right.updatedAt)
        ? 1
        : -1,
    )[0];
    answerText = [
      latestDashboard
        ? `Latest dashboard update: ${latestDashboard.title} at ${latestDashboard.updatedAt}.`
        : "No dashboard updates are available.",
      latestReport
        ? `Latest report generation: ${latestReport.title} at ${latestReport.lastGeneratedAt ?? latestReport.updatedAt}.`
        : overview.capability.supportsReports || config.BLUE_REPORT_FALLBACK_IDS.length > 0
          ? "No report generations are available."
          : "No report generation data is available until Enterprise reporting is enabled.",
    ].join(" ");
  } else {
    answerText = overview.summaryText;
  }

  return {
    ...overview,
    question: input.question,
    answerText,
  };
}
