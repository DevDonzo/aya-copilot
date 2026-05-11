#!/usr/bin/env node

const DEFAULT_BASE_URL = "http://127.0.0.1:3080";
const DEFAULT_EMAIL = "hamza.test@ayafinancial.com";
const DEFAULT_PASSWORD = "AyaTemp123!";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
const NO_PARENT = "00000000-0000-0000-0000-000000000000";
const DEFAULT_TIMEOUT_MS = 120_000;

const READ_ONLY_SEQUENCE = [
  "hello",
  "updates on fatima hammou?",
  "show me reports",
  "what dashboards do we have?",
  "who did what today?",
  "what is Hamza working on?",
];

const FULL_DEMO_SEQUENCE = [
  "hello",
  "updates on fatima hammou?",
  "move her to underwriting",
  "show me reports",
  "what dashboards do we have?",
  "who did what today?",
  "what is Hamza working on?",
];

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    email: process.env.LIBRECHAT_EMAIL || DEFAULT_EMAIL,
    password: process.env.LIBRECHAT_PASSWORD || DEFAULT_PASSWORD,
    token: process.env.LIBRECHAT_BEARER_TOKEN || null,
    endpoint: process.env.LIBRECHAT_ENDPOINT || "openAI",
    endpointType: process.env.LIBRECHAT_ENDPOINT_TYPE || null,
    timeoutMs: Number(process.env.LIBRECHAT_STREAM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    fullDemo: false,
    json: false,
    prompts: [],
  };

  for (const arg of argv) {
    if (arg === "--full-demo") {
      options.fullDemo = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg.startsWith("--base-url=")) {
      options.baseUrl = arg.slice("--base-url=".length);
      continue;
    }

    if (arg.startsWith("--email=")) {
      options.email = arg.slice("--email=".length);
      continue;
    }

    if (arg.startsWith("--password=")) {
      options.password = arg.slice("--password=".length);
      continue;
    }

    if (arg.startsWith("--token=")) {
      options.token = arg.slice("--token=".length);
      continue;
    }

    if (arg.startsWith("--endpoint=")) {
      options.endpoint = arg.slice("--endpoint=".length);
      continue;
    }

    if (arg.startsWith("--endpoint-type=")) {
      options.endpointType = arg.slice("--endpoint-type=".length);
      continue;
    }

    if (arg.startsWith("--timeout-ms=")) {
      options.timeoutMs = Number(arg.slice("--timeout-ms=".length));
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    options.prompts.push(arg);
  }

  return options;
}

async function login({ baseUrl, email, password }) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new Error(`Login returned non-JSON response: ${bodyText}`);
  }

  if (!response.ok || !body?.token) {
    throw new Error(
      `Login failed (${response.status}): ${body?.message ?? bodyText}`,
    );
  }

  return body.token;
}

async function startGeneration({
  baseUrl,
  token,
  prompt,
  conversationId,
  parentMessageId,
  endpoint,
  endpointType,
}) {
  const payload = {
    text: prompt,
    endpoint,
    conversationId,
    parentMessageId,
    spec: "aya-copilot-assistant",
    ephemeralAgent: {
      mcp: ["aya_ops"],
      web_search: false,
      file_search: false,
      execute_code: false,
      artifacts: "",
    },
  };

  if (endpointType) {
    payload.endpointType = endpointType;
  }

  const response = await fetch(`${baseUrl}/api/agents/chat/${encodeURIComponent(endpoint)}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": DEFAULT_USER_AGENT,
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new Error(
      `Start generation returned non-JSON response (${response.status}): ${bodyText}`,
    );
  }

  if (!response.ok || !body?.streamId) {
    throw new Error(
      `Start generation failed (${response.status}): ${body?.message ?? bodyText}`,
    );
  }

  return body;
}

function extractToolSummaries(runSteps) {
  const tools = [];

  for (const step of runSteps) {
    const details = step?.stepDetails;
    if (details?.type !== "tool_calls" || !Array.isArray(details.tool_calls)) {
      continue;
    }

    for (const call of details.tool_calls) {
      if (call?.type !== "function") {
        continue;
      }

      tools.push({
        name: call.function?.name ?? "unknown",
        arguments: call.function?.arguments ?? "",
      });
    }
  }

  return tools;
}

async function collectStream({ baseUrl, token, streamId, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${baseUrl}/api/agents/chat/stream/${encodeURIComponent(streamId)}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          "user-agent": DEFAULT_USER_AGENT,
        },
        signal: controller.signal,
      },
    );

    if (!response.ok || !response.body) {
      const bodyText = await response.text();
      throw new Error(
        `Stream request failed (${response.status}): ${bodyText || "empty body"}`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalEvent = null;
    let errorEvent = null;
    const runSteps = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        const rawEvent = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf("\n\n");

        if (!rawEvent.trim()) {
          continue;
        }

        const lines = rawEvent.split("\n");
        const eventType = lines
          .find((line) => line.startsWith("event: "))
          ?.slice("event: ".length);
        const data = lines
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice("data: ".length))
          .join("");

        if (!data) {
          continue;
        }

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        if (eventType === "error") {
          errorEvent = parsed;
        }

        if (parsed?.event === "on_run_step") {
          runSteps.push(parsed.data);
        }

        if (parsed?.final) {
          finalEvent = parsed;
          await reader.cancel();
          break;
        }
      }

      if (finalEvent) {
        break;
      }
    }

    if (!finalEvent) {
      const fallbackError = errorEvent
        ? JSON.stringify(errorEvent)
        : "stream completed without a final event";
      throw new Error(fallbackError);
    }

    return { finalEvent, errorEvent, runSteps };
  } finally {
    clearTimeout(timeout);
  }
}

function getTextFromContent(content) {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((part) => part?.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

async function runPrompt({
  baseUrl,
  token,
  prompt,
  conversationId,
  parentMessageId,
  timeoutMs,
  endpoint,
  endpointType,
}) {
  const started = await startGeneration({
    baseUrl,
    token,
    prompt,
    conversationId,
    parentMessageId,
    endpoint,
    endpointType,
  });
  const streamed = await collectStream({
    baseUrl,
    token,
    streamId: started.streamId,
    timeoutMs,
  });
  const finalEvent = streamed.finalEvent;
  const responseMessage = finalEvent.responseMessage ?? {};
  const requestMessage = finalEvent.requestMessage ?? {};
  const toolSummaries = extractToolSummaries(streamed.runSteps);

  return {
    prompt,
    conversationId:
      finalEvent.conversation?.conversationId ?? started.conversationId,
    requestMessageId: requestMessage.messageId ?? null,
    responseMessageId: responseMessage.messageId ?? null,
    answerText: getTextFromContent(responseMessage.content),
    toolSummaries,
    runStepTypes: streamed.runSteps.map((step) => step?.type ?? "unknown"),
    errorEvent: streamed.errorEvent,
  };
}

function printHumanSummary(results) {
  for (const result of results) {
    const toolNames = result.toolSummaries.map((tool) => tool.name).join(", ");
    console.log(`PROMPT: ${result.prompt}`);
    console.log(`ANSWER: ${result.answerText || "(empty)"}`);
    console.log(
      `TOOLS: ${toolNames || "none"} | steps=${result.runStepTypes.join(", ") || "none"}`,
    );
    if (result.errorEvent) {
      console.log(`STREAM ERROR: ${JSON.stringify(result.errorEvent)}`);
    }
    console.log("---");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const prompts =
    options.prompts.length > 0
      ? options.prompts
      : options.fullDemo
        ? FULL_DEMO_SEQUENCE
        : READ_ONLY_SEQUENCE;

  const token =
    options.token ??
    (await login({
      baseUrl: options.baseUrl,
      email: options.email,
      password: options.password,
    }));

  const results = [];
  let conversationId = "new";
  let parentMessageId = NO_PARENT;

  for (const prompt of prompts) {
    const result = await runPrompt({
      baseUrl: options.baseUrl,
      token,
      prompt,
      conversationId,
      parentMessageId,
      timeoutMs: options.timeoutMs,
      endpoint: options.endpoint,
      endpointType: options.endpointType,
    });

    results.push(result);
    conversationId = result.conversationId;
    parentMessageId = result.responseMessageId ?? parentMessageId;
  }

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  printHumanSummary(results);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
