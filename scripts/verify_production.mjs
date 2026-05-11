#!/usr/bin/env node

const baseUrl = new URL(
  process.env.PRODUCTION_BASE_URL || process.argv[2] || 'https://copilot.ayafinancial.com',
);
const timeoutMs = Number(process.env.PRODUCTION_VERIFY_TIMEOUT_MS || 15000);

function buildUrl(path) {
  return new URL(path, baseUrl);
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = buildUrl(path);

  try {
    const response = await fetch(url, {
      redirect: 'manual',
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    return { response, text, url };
  } catch (error) {
    throw new Error(`${url.href} request failed: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}`);
  }
}

async function checkHealth() {
  const { response, text } = await request('/health');
  assert(response.ok, `/health returned HTTP ${response.status}`);

  const health = parseJson(text, '/health');
  assert(health.ok === true, '/health ok must be true');
  assert(health.database?.ok === true, '/health database.ok must be true');
  assert(health.blueApi?.ok === true, '/health blueApi.ok must be true');
}

async function checkConfig() {
  const { response, text } = await request('/api/config');
  assert(response.ok, `/api/config returned HTTP ${response.status}`);

  const config = parseJson(text, '/api/config');
  assert(config.appTitle === 'AYA Copilot', 'appTitle must be AYA Copilot');
  assert(config.emailLoginEnabled === true, 'email login must be enabled');
  assert(config.registrationEnabled === true, 'self registration must be enabled');
  assert(config.socialLoginEnabled === false, 'social login must be disabled');
  assert(config.googleLoginEnabled === false, 'Google login must be disabled');
  const allowedDomains =
    config.registration?.allowedDomains ??
    config.registrationAllowedDomains ??
    config.allowedDomains;
  if (allowedDomains !== undefined) {
    assert(Array.isArray(allowedDomains), 'allowed registration domains must be a list');
    assert(
      allowedDomains.length === 1 && allowedDomains[0] === 'ayafinancial.com',
      'registration must be restricted to ayafinancial.com',
    );
  }
  assert(
    config.interface?.mcpServers?.use === true || config.mcpServers?.use === true,
    'MCP server UI must be enabled',
  );

  const modelSpecs = config.modelSpecs?.list || config.modelSpecs || [];
  assert(Array.isArray(modelSpecs), 'modelSpecs must be a list');
  assert(
    modelSpecs.some((spec) => JSON.stringify(spec).includes('aya-ops-assistant')),
    'aya-ops-assistant model spec must be present',
  );
}

async function checkLoginPage() {
  const { response, text } = await request('/login');
  assert(
    response.status >= 200 && response.status < 400,
    `/login returned HTTP ${response.status}`,
  );

  assert(!/continue\s+with\s+google/i.test(text), 'login page still shows Google sign-in copy');
  assert(!/oauth\/google/i.test(text), 'login page still references Google OAuth route');
}

async function checkAdminRemoved() {
  const { response } = await request('/admin');
  assert(response.status === 404, `/admin must return 404, got HTTP ${response.status}`);
}

async function checkMcpProtected() {
  for (const path of ['/mcp', '/mcp/hostinger']) {
    const { response } = await request(path, {
      headers: {
        accept: 'application/json',
      },
    });
    assert(
      response.status === 401 || response.status === 403,
      `${path} must reject unauthenticated requests, got HTTP ${response.status}`,
    );
  }
}

async function checkHomePage() {
  const { response, text } = await request('/');
  assert(response.ok, `/ returned HTTP ${response.status}`);
  assert(!/404\s+not\s+found/i.test(text), 'home page returned a 404 document');
}

const checks = [
  ['public home page', checkHomePage],
  ['health endpoint', checkHealth],
  ['LibreChat config', checkConfig],
  ['login page auth surface', checkLoginPage],
  ['admin surface removed', checkAdminRemoved],
  ['MCP endpoints protected', checkMcpProtected],
];

const failures = [];

for (const [name, check] of checks) {
  try {
    await check();
    console.log(`OK ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

if (failures.length > 0) {
  console.error('');
  console.error(`Production verification failed for ${baseUrl.href}`);
  process.exit(1);
}

console.log(`Production verification passed for ${baseUrl.href}`);
