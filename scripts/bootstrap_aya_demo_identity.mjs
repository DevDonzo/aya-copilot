const defaults = {
  ayaBaseUrl: "http://127.0.0.1:3010",
  bootstrapKey: process.env.AUTH_BOOTSTRAP_KEY ?? "",
  employeeName: "Hamza Paracha",
  librechatEmail: "hamza.test@ayafinancial.com",
  ayaPassword: "AyaTemp123!",
};

const args = parseArgs(process.argv.slice(2));
const options = {
  ayaBaseUrl: args["base-url"] ?? defaults.ayaBaseUrl,
  bootstrapKey: args["bootstrap-key"] ?? defaults.bootstrapKey,
  employeeName: args["employee-name"] ?? defaults.employeeName,
  librechatEmail: args["librechat-email"] ?? defaults.librechatEmail,
  ayaPassword: args["aya-password"] ?? defaults.ayaPassword,
};

await provisionAdmin(options);
const sessionCookie = await loginAdmin(options);
const identityLink = await createIdentityLink(options, sessionCookie);

console.log(
  JSON.stringify(
    {
      ok: true,
      provisionedEmployee: options.employeeName,
      linkedEmail: options.librechatEmail,
      identityLink,
    },
    null,
    2,
  ),
);

async function provisionAdmin(options) {
  if (!options.bootstrapKey) {
    throw new Error(
      "Provisioning requires AUTH_BOOTSTRAP_KEY or --bootstrap-key to be set explicitly.",
    );
  }

  await apiRequest(options.ayaBaseUrl, "/auth/provision", {
    method: "POST",
    headers: {
      "x-bootstrap-key": options.bootstrapKey,
    },
    body: {
      employeeName: options.employeeName,
      password: options.ayaPassword,
      roleName: "admin",
    },
  });
}

async function loginAdmin(options) {
  const response = await apiRequest(options.ayaBaseUrl, "/auth/login", {
    method: "POST",
    body: {
      employeeName: options.employeeName,
      password: options.ayaPassword,
    },
    includeResponse: true,
  });
  const setCookie = response.headers.get("set-cookie");
  const sessionCookie = setCookie?.split(";")[0];

  if (!sessionCookie) {
    throw new Error("Aya login succeeded but did not return a session cookie");
  }

  return sessionCookie;
}

async function createIdentityLink(options, sessionCookie) {
  return await apiRequest(options.ayaBaseUrl, "/identity-links", {
    method: "POST",
    headers: {
      cookie: sessionCookie,
    },
    body: {
      employeeName: options.employeeName,
      source: "email",
      externalId: options.librechatEmail,
      externalLabel: options.employeeName,
    },
  });
}

async function apiRequest(baseUrl, path, options) {
  const response = await fetch(new URL(path, baseUrl), {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "user-agent": "AyaDemoBootstrap/1.0",
      ...(options.headers ?? {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const payload = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : `${response.status} ${response.statusText}`;
    throw new Error(`${path} failed: ${message}`);
  }

  if (options.includeResponse) {
    return response;
  }

  return payload;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseArgs(argv) {
  const parsed = {};

  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, rawValue] = arg.slice(2).split("=", 2);
    parsed[rawKey] = rawValue ?? "";
  }

  return parsed;
}
