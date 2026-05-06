import { db, createId, initializeDatabase } from "./modules/db/kysely.js";
import * as activityRepo from "./modules/db/repositories/activity.js";
import * as activeRecordContextRepo from "./modules/db/repositories/active-record-context.js";
import * as auditRepo from "./modules/db/repositories/audit.js";
import * as authRepo from "./modules/db/repositories/auth.js";
import * as blueCacheRepo from "./modules/db/repositories/blue-cache.js";
import * as employeesRepo from "./modules/db/repositories/employees.js";
import * as identityRepo from "./modules/db/repositories/identity-links.js";
import * as notificationStateRepo from "./modules/db/repositories/notification-state.js";
import * as pendingRecordChoiceRepo from "./modules/db/repositories/pending-record-choices.js";
import * as syncStateRepo from "./modules/db/repositories/sync-state.js";
import * as webhookRepo from "./modules/db/repositories/webhooks.js";

void initializeDatabase();

export { createId, db, initializeDatabase };

export const ensureEmployee = employeesRepo.ensureEmployee;
export const updateEmployeeRole = employeesRepo.updateEmployeeRole;
export const findEmployeeByName = employeesRepo.findEmployeeByName;
export const findEmployeeById = employeesRepo.findEmployeeById;
export const findEmployeeByEmailColumn = employeesRepo.findEmployeeByEmailColumn;
export const listEmployees = employeesRepo.listEmployees;

export const upsertIdentityLink = identityRepo.upsertIdentityLink;
export const listIdentityLinks = identityRepo.listIdentityLinks;
export const getIdentityLinkById = identityRepo.getIdentityLinkById;
export const findEmployeeByIdentity = identityRepo.findEmployeeByIdentity;
export const findEmployeeByEmail = async (email: string) =>
  identityRepo.findEmployeeByIdentity("email", email);
export const findIdentityLink = identityRepo.findIdentityLink;
export const deleteIdentityLinksBySources = identityRepo.deleteIdentityLinksBySources;
export const deleteIdentityLinkById = identityRepo.deleteIdentityLinkById;
export const upsertPendingRecordChoice = pendingRecordChoiceRepo.upsertPendingRecordChoice;
export const getPendingRecordChoice = pendingRecordChoiceRepo.getPendingRecordChoice;
export const deletePendingRecordChoice = pendingRecordChoiceRepo.deletePendingRecordChoice;
export const upsertActiveRecordContext =
  activeRecordContextRepo.upsertActiveRecordContext;
export const getActiveRecordContext = activeRecordContextRepo.getActiveRecordContext;
export const deleteActiveRecordContext =
  activeRecordContextRepo.deleteActiveRecordContext;
export const getEmployeeNotificationState =
  notificationStateRepo.getEmployeeNotificationState;
export const upsertEmployeeNotificationState =
  notificationStateRepo.upsertEmployeeNotificationState;

export const replaceBlueListsCache = blueCacheRepo.replaceBlueListsCache;
export const replaceBlueRecordsCache = blueCacheRepo.replaceBlueRecordsCache;
export const upsertBlueListsCache = blueCacheRepo.upsertBlueListsCache;
export const upsertBlueRecordsCache = blueCacheRepo.upsertBlueRecordsCache;
export const softDeleteMissingBlueRecords = blueCacheRepo.softDeleteMissingBlueRecords;
export const softDeleteBlueRecordById = blueCacheRepo.softDeleteBlueRecordById;
export const listCachedBlueLists = blueCacheRepo.listCachedBlueLists;
export const searchCachedBlueRecords = blueCacheRepo.searchCachedBlueRecords;
export const listCachedBlueRecords = blueCacheRepo.listCachedBlueRecords;
export const listCachedBlueRecordsForInspection =
  blueCacheRepo.listCachedBlueRecordsForInspection;
export const getCachedBlueRecordById = blueCacheRepo.getCachedBlueRecordById;

export const upsertEmployeeCredential = authRepo.upsertEmployeeCredential;
export const getEmployeeCredential = authRepo.getEmployeeCredential;
export const createAuthSession = authRepo.createAuthSession;
export const getAuthSession = authRepo.getAuthSession;
export const deleteAuthSession = authRepo.deleteAuthSession;
export const pruneExpiredAuthSessions = authRepo.pruneExpiredAuthSessions;

export const insertActivityEvent = activityRepo.insertActivityEvent;
export const listEventsForEmployeeDay = activityRepo.listEventsForEmployeeDay;
export const listEventsForEmployeeInRange = activityRepo.listEventsForEmployeeInRange;
export const listWorkspaceEventsInRange = activityRepo.listWorkspaceEventsInRange;
export const getWorkspaceActivityOverview = activityRepo.getWorkspaceActivityOverview;
export const listWorkspaceEmployeeActivity =
  activityRepo.listWorkspaceEmployeeActivity;
export const countEventsBySourceForEmployeeDay =
  activityRepo.countEventsBySourceForEmployeeDay;
export const countEventsByActionForEmployeeDay =
  activityRepo.countEventsByActionForEmployeeDay;
export const listEventsForDay = activityRepo.listEventsForDay;
export const countEventsByEmployeeForDay = activityRepo.countEventsByEmployeeForDay;
export const listEmployeesWithoutActivityForDay =
  activityRepo.listEmployeesWithoutActivityForDay;
export const listMentionsForUser = activityRepo.listMentionsForUser;

export const insertBotAuditLog = auditRepo.insertBotAuditLog;
export const getAdminDashboardOverview = auditRepo.getAdminDashboardOverview;
export const listAdminDashboardEmployeeActivity =
  auditRepo.listAdminDashboardEmployeeActivity;
export const listAdminDashboardRecentLogs =
  auditRepo.listAdminDashboardRecentLogs;
export const getAdminDashboardLogDetail = auditRepo.getAdminDashboardLogDetail;
export const listBotAuditLogsForEmployeeDay =
  auditRepo.listBotAuditLogsForEmployeeDay;
export const listBotAuditLogsForDay = auditRepo.listBotAuditLogsForDay;
export const listBotAuditLogsInRange = auditRepo.listBotAuditLogsInRange;

export const getBlueSyncState = syncStateRepo.getBlueSyncState;
export const listBlueSyncStates = syncStateRepo.listBlueSyncStates;
export const upsertBlueSyncState = syncStateRepo.upsertBlueSyncState;

export const upsertBlueWebhookSubscription =
  webhookRepo.upsertBlueWebhookSubscription;
export const listBlueWebhookSubscriptions =
  webhookRepo.listBlueWebhookSubscriptions;
