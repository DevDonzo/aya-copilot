import { MongoClient } from "mongodb";

import { config } from "../config.js";

let clientPromise: Promise<MongoClient> | null = null;

type TranscriptMessage = {
  sender: string;
  text: string;
  createdAt: string | null;
  isCreatedByUser: boolean;
};

type LibreChatMessagePart =
  | {
      type?: string | null;
      text?: string | null;
      tool_call?: {
        output?: string | null;
      } | null;
    }
  | null;

export type LibreChatTranscript = {
  conversationId: string;
  title: string;
  employeeName: string;
  employeeEmail: string;
  endpoint: string;
  model: string;
  createdAt: string | null;
  updatedAt: string | null;
  messageCount: number;
  messages: TranscriptMessage[];
};

export async function listRecentLibreChatTranscripts(input?: {
  limit?: number;
  employeeEmail?: string;
}) {
  const db = await getLibreChatDb();
  const limit = Math.max(1, Math.min(input?.limit ?? 20, 100));

  const pipeline: Record<string, unknown>[] = [
    {
      $addFields: {
        userKey: { $toString: "$user" },
      },
    },
    {
      $lookup: {
        from: "users",
        let: { userKey: "$userKey" },
        pipeline: [
          {
            $addFields: {
              idString: { $toString: "$_id" },
            },
          },
          {
            $match: {
              $expr: { $eq: ["$idString", "$$userKey"] },
            },
          },
          {
            $project: {
              _id: 0,
              name: 1,
              email: 1,
            },
          },
        ],
        as: "userDoc",
      },
    },
    {
      $addFields: {
        userDoc: { $arrayElemAt: ["$userDoc", 0] },
      },
    },
  ];

  if (input?.employeeEmail) {
    pipeline.push({
      $match: {
        "userDoc.email": input.employeeEmail,
      },
    });
  }

  pipeline.push(
    {
      $lookup: {
        from: "messages",
        let: { conversationId: "$conversationId" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$conversationId", "$$conversationId"] },
            },
          },
          {
            $sort: { createdAt: -1 },
          },
          {
            $limit: 6,
          },
          {
            $project: {
              _id: 0,
              sender: 1,
              text: 1,
              content: 1,
              createdAt: 1,
              isCreatedByUser: 1,
            },
          },
        ],
        as: "messagePreview",
      },
    },
    {
      $addFields: {
        messageCount: { $size: "$messagePreview" },
      },
    },
    {
      $sort: { updatedAt: -1, createdAt: -1 },
    },
    {
      $limit: limit,
    },
    {
      $project: {
        _id: 0,
        conversationId: 1,
        title: 1,
        endpoint: 1,
        model: 1,
        createdAt: 1,
        updatedAt: 1,
        messageCount: 1,
        employeeName: "$userDoc.name",
        employeeEmail: "$userDoc.email",
        messages: "$messagePreview",
      },
    },
  );

  const rows = (await db
    .collection("conversations")
    .aggregate(pipeline)
    .toArray()) as Array<{
    conversationId?: string;
    title?: string | null;
    endpoint?: string | null;
    model?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    messageCount?: number | null;
    employeeName?: string | null;
    employeeEmail?: string | null;
    messages?: Array<{
      sender?: string | null;
      text?: string | null;
      content?: LibreChatMessagePart[] | null;
      createdAt?: string | null;
      isCreatedByUser?: boolean | null;
    }>;
  }>;

  return rows.map((row) => ({
    conversationId: row.conversationId ?? "",
    title: row.title ?? "New Chat",
    employeeName: row.employeeName ?? "Unknown",
    employeeEmail: row.employeeEmail ?? "",
    endpoint: row.endpoint ?? "",
    model: row.model ?? "",
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
    messageCount: row.messageCount ?? 0,
    messages: (row.messages ?? []).map((message) => ({
      sender: message.sender ?? (message.isCreatedByUser ? "user" : "assistant"),
      text: extractTranscriptMessageText(message.text, message.content),
      createdAt: message.createdAt ?? null,
      isCreatedByUser: Boolean(message.isCreatedByUser),
    })),
  })) satisfies LibreChatTranscript[];
}

function extractTranscriptMessageText(
  text: string | null | undefined,
  content: LibreChatMessagePart[] | null | undefined,
) {
  const directText = text?.trim();
  if (directText) {
    return directText;
  }

  const parts = content ?? [];
  const textParts = parts
    .flatMap((part) => {
      if (!part) {
        return [];
      }

      if (part.type === "text" && part.text?.trim()) {
        return [part.text.trim()];
      }

      if (part.type === "tool_call" && part.tool_call?.output?.trim()) {
        return [`Tool: ${part.tool_call.output.trim()}`];
      }

      return [];
    })
    .filter(Boolean);

  return textParts.join("\n\n");
}

async function getLibreChatDb() {
  const client = await getLibreChatClient();
  return client.db(config.LIBRECHAT_MONGO_DB_NAME);
}

async function getLibreChatClient() {
  if (!clientPromise) {
    clientPromise = MongoClient.connect(config.LIBRECHAT_MONGO_URI);
  }

  return clientPromise;
}
