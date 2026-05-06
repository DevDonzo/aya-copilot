import { z } from "zod";

export const roleNameSchema = z.enum(["employee", "admin"]);

export const loginBodySchema = z.object({
  employeeName: z.string().trim().min(1),
  password: z.string().min(1),
});

export const provisionBodySchema = z
  .object({
    employeeId: z.string().trim().min(1).optional(),
    employeeName: z.string().trim().min(1).optional(),
    password: z.string().min(8),
    roleName: roleNameSchema,
  })
  .refine((value) => Boolean(value.employeeId || value.employeeName), {
    message: "employeeId or employeeName is required",
    path: ["employeeId"],
  });

export const identityLinkBodySchema = z
  .object({
    employeeId: z.string().trim().min(1).optional(),
    employeeName: z.string().trim().min(1).optional(),
    source: z.string().trim().min(1),
    externalId: z.string().trim().min(1),
    externalLabel: z.string().trim().min(1).optional(),
  })
  .refine((value) => Boolean(value.employeeId || value.employeeName), {
    message: "employeeId or employeeName is required",
    path: ["employeeId"],
  });

export const messageBodySchema = z.object({
  transport: z.string().trim().min(1).optional(),
  senderId: z.string().trim().min(1).optional(),
  senderLabel: z.string().trim().min(1).optional(),
  actorEmployeeId: z.string().trim().min(1).optional(),
  actorEmployeeEmail: z.string().trim().email().optional(),
  actorEmployeeName: z.string().trim().min(1).optional(),
  actorBlueTokenId: z.string().trim().min(1).optional(),
  actorBlueTokenSecret: z.string().trim().min(1).optional(),
  message: z.string().trim().min(1),
});

export const syncBodySchema = z
  .object({
    forceFull: z.boolean().optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .optional()
  .default({});

export const adminLogsQuerySchema = z.object({
  employeeId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const adminTranscriptsQuerySchema = z.object({
  employeeEmail: z.string().trim().email().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const managerReportQuerySchema = z
  .object({
    dateStart: z.string().trim().min(1).optional(),
    dateEnd: z.string().trim().min(1).optional(),
    employeeId: z.string().trim().min(1).optional(),
    clientQuery: z.string().trim().min(1).optional(),
    focus: z
      .enum(["all", "comments", "moves", "creates", "reads", "timeline"])
      .optional()
      .default("all"),
  })
  .transform((value) => {
    const today = new Date().toISOString().slice(0, 10);
    return {
      ...value,
      dateStart: value.dateStart ?? today,
      dateEnd: value.dateEnd ?? value.dateStart ?? today,
    };
  })
  .refine((value) => value.dateStart <= value.dateEnd, {
    message: "dateStart must be before or equal to dateEnd",
    path: ["dateStart"],
  });

export const employeeSummaryQuerySchema = z
  .object({
    employeeId: z.string().trim().min(1).optional(),
    employee: z.string().trim().min(1).optional(),
    date: z.string().trim().min(1).optional(),
  })
  .refine((value) => Boolean(value.employeeId || value.employee), {
    message: "employeeId or employee is required",
    path: ["employeeId"],
  });

export const teamSummaryQuerySchema = z.object({
  date: z.string().trim().min(1).optional(),
  inactiveOnly: z.coerce.boolean().optional().default(false),
});

export const webhookEnvelopeSchema = z.object({
  event: z.string().trim().min(1).optional(),
  type: z.string().trim().min(1).optional(),
  data: z.unknown().optional(),
});

export type LoginBody = z.infer<typeof loginBodySchema>;
export type ProvisionBody = z.infer<typeof provisionBodySchema>;
export type IdentityLinkBody = z.infer<typeof identityLinkBodySchema>;
export type MessageBody = z.infer<typeof messageBodySchema>;
export type SyncBody = z.infer<typeof syncBodySchema>;
