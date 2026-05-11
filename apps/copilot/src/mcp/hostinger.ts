import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { config } from "../config.js";

export async function handleHostingerMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  parsedBody?: unknown,
) {
  normalizeMcpRequestHeaders(request);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = createHostingerMcpServer();
  await server.connect(transport);
  await transport.handleRequest(request, response, parsedBody);
}

function normalizeMcpRequestHeaders(request: IncomingMessage) {
  const method = request.method?.toUpperCase();
  const currentAccept = request.headers.accept ?? "";
  const acceptParts = new Set(
    currentAccept
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );

  if (method === "GET") {
    acceptParts.add("text/event-stream");
  }

  if (method === "POST" || method === "DELETE") {
    acceptParts.add("application/json");
    acceptParts.add("text/event-stream");
    if (!request.headers["content-type"]) {
      request.headers["content-type"] = "application/json";
      setRawHeader(request, "content-type", "application/json");
    }
  }

  if (acceptParts.size > 0) {
    const acceptValue = Array.from(acceptParts).join(", ");
    request.headers.accept = acceptValue;
    setRawHeader(request, "accept", acceptValue);
  }
}

function setRawHeader(request: IncomingMessage, name: string, value: string) {
  const rawHeaders = request.rawHeaders;
  if (!Array.isArray(rawHeaders)) {
    return;
  }

  for (let index = rawHeaders.length - 2; index >= 0; index -= 2) {
    if (rawHeaders[index]?.toLowerCase() === name) {
      rawHeaders.splice(index, 2);
    }
  }

  rawHeaders.push(name, value);
}

function createHostingerMcpServer() {
  const server = new McpServer({
    name: "Hostinger",
    version: "1.0.0",
  });

  server.registerTool(
    "hostinger_list_vps",
    {
      title: "List VPS Instances",
      description: "List all VPS instances in your Hostinger account.",
      inputSchema: {},
    },
    async () => {
      const apiKey = config.HOSTINGER_API_KEY;
      if (!apiKey) {
        return {
          content: [{ type: "text", text: "Error: HOSTINGER_API_KEY is not configured." }],
          isError: true,
        };
      }

      try {
        const response = await fetch("https://api.hostinger.com/v1/vps", {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Accept": "application/json",
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          return {
            content: [{ type: "text", text: `Hostinger API Error: ${response.status} ${errorText}` }],
            isError: true,
          };
        }

        const data = await response.json();
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to fetch VPS list: ${err}` }],
          isError: true,
        };
      }
    },
  );

  return server;
}
