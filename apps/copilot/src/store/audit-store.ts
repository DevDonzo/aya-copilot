import { insertBotAuditLog as insertBotAuditLogRepo } from "../db.js";

export async function insertBotAuditLog(input: {
  id: string;
  employeeId?: string;
  transport: string;
  inboundText: string;
  detectedIntent?: string;
  adapter: string;
  commandName?: string;
  commandArgs?: string;
  outcome: string;
  responseText?: string;
  requestJson?: unknown;
  responseJson?: unknown;
}) {
  await insertBotAuditLogRepo({
    id: input.id,
    employeeId: input.employeeId,
    transport: input.transport,
    inboundText: input.inboundText,
    detectedIntent: input.detectedIntent,
    adapter: input.adapter,
    commandName: input.commandName,
    commandArgs: input.commandArgs,
    outcome: input.outcome,
    responseText: input.responseText,
    requestJson: input.requestJson,
    responseJson: input.responseJson,
  });
}
