import type { BlueRequestAuth, EmployeeIdentity } from "../domain/types.js";
import {
  handleInboundMessage,
  type InboundMessagePayload,
} from "../messages/handle-message.js";
import {
  addCommentToClient,
  assignRecord,
  assignTask,
  createClientRecord,
  getEmployeeDailyBrief,
  getClientComments,
  getClientDetail,
  getEmployeeAssignmentReport,
  getEmployeeActivityReport,
  getEmployeeDaySummary,
  getEmployeeFollowUpQueue,
  getEmployeeWorkload,
  getUserMentionsReport,
  getRecordActivityReport,
  getTeamFollowUpQueue,
  getTeamDaySummary,
  getWorkspaceActivityReport,
  moveClientToStage,
  resolveActorOrThrow as resolveActorIdentityService,
  searchClients,
} from "../modules/copilot/actions.js";

export {
  addCommentToClient,
  assignRecord,
  assignTask,
  createClientRecord,
  getEmployeeDailyBrief,
  getClientComments,
  getClientDetail,
  getEmployeeAssignmentReport,
  getEmployeeActivityReport,
  getEmployeeDaySummary,
  getEmployeeFollowUpQueue,
  getEmployeeWorkload,
  getUserMentionsReport,
  getRecordActivityReport,
  getTeamFollowUpQueue,
  getTeamDaySummary,
  getWorkspaceActivityReport,
  moveClientToStage,
  searchClients,
};

export async function resolveActorIdentity(input: {
  employeeId?: string;
  employeeEmail?: string;
  employeeName?: string;
}): Promise<EmployeeIdentity | null> {
  try {
    return await resolveActorIdentityService({
      employeeId: input.employeeId,
      employeeEmail: input.employeeEmail,
      employeeName: input.employeeName,
      transport: "mcp",
    });
  } catch {
    return null;
  }
}

export async function runAyaMessageTool(input: {
  message: string;
  actorEmployeeId?: string;
  actorEmployeeEmail?: string;
  actorEmployeeName?: string;
  blueAuth?: BlueRequestAuth | null;
  conversationKey?: string;
}) {
  const payload: InboundMessagePayload = {
    transport: "mcp",
    conversationKey: input.conversationKey,
    actorEmployeeId: input.actorEmployeeId,
    actorEmployeeEmail: input.actorEmployeeEmail,
    actorEmployeeName: input.actorEmployeeName,
    actorBlueTokenId: input.blueAuth?.tokenId,
    actorBlueTokenSecret: input.blueAuth?.tokenSecret,
    message: input.message,
  };

  return await handleInboundMessage(payload);
}
