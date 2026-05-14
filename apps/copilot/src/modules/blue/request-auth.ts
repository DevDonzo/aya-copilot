import { AuthError, ExternalServiceError } from "../../app/errors.js";
import { config } from "../../config.js";
import type { BlueRequestAuth, EmployeeIdentity } from "../../domain/types.js";
import { fetchCurrentBlueUser } from "./graphql/client.js";

const unresolvedPlaceholderPattern = /^\{\{.+\}\}$/;
const blueTokenIdPattern = /^[0-9a-f]{32}$/i;

export const BLUE_WRITE_AUTH_REQUIRED_MESSAGE =
  "Connect your Blue account before using Aya with CRM data. Open the Aya MCP server settings and enter both your Blue Token ID and Blue Token Secret, then try again.";
export const BLUE_AUTH_REQUIRED_MESSAGE = BLUE_WRITE_AUTH_REQUIRED_MESSAGE;
export const BLUE_AUTH_INVALID_MESSAGE =
  "Your saved Blue Token ID and Secret could not be verified. Open the Aya MCP server settings, confirm both values are correct, then try again.";
export const BLUE_AUTH_MISMATCH_MESSAGE =
  "Your saved Blue credentials do not match your signed-in Aya account. Open the Aya MCP server settings and save your own personal Blue Token ID and Secret.";
export const BLUE_AUTH_WORKSPACE_REQUIRED_MESSAGE =
  "Your saved Blue credentials do not have access to the allowed Aya workspace. Ask an admin to confirm your Blue workspace access.";

function normalizeBlueAuthValue(value?: string | null) {
  const normalized = value?.trim();
  if (!normalized || unresolvedPlaceholderPattern.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function looksLikeBlueTokenId(value: string) {
  return blueTokenIdPattern.test(value);
}

function normalizeBlueCredentialPair(tokenId: string, tokenSecret: string) {
  /**
   * Blue Token IDs in Aya's working config are 32-char hex strings.
   * Some employees have already saved the two Blue values reversed in LibreChat,
   * so normalize the request-scoped pair here instead of forcing re-entry.
   */
  if (!looksLikeBlueTokenId(tokenId) && looksLikeBlueTokenId(tokenSecret)) {
    return {
      tokenId: tokenSecret,
      tokenSecret: tokenId,
    };
  }

  return {
    tokenId,
    tokenSecret,
  };
}

export function normalizeBlueRequestAuth(input: {
  tokenId?: string | null;
  tokenSecret?: string | null;
}): BlueRequestAuth | null {
  const tokenId = normalizeBlueAuthValue(input.tokenId);
  const tokenSecret = normalizeBlueAuthValue(input.tokenSecret);

  if (!tokenId && !tokenSecret) {
    return null;
  }

  if (!tokenId || !tokenSecret) {
    return null;
  }

  return normalizeBlueCredentialPair(tokenId, tokenSecret);
}

export function resolveBlueWriteAuth(
  auth: BlueRequestAuth | null | undefined,
): BlueRequestAuth | null {
  if (auth) {
    return auth;
  }

  if (config.ALLOW_SYSTEM_BLUE_WRITE_FALLBACK) {
    return null;
  }

  throw new AuthError(BLUE_WRITE_AUTH_REQUIRED_MESSAGE);
}

export function requireBlueRequestAuth(
  auth: BlueRequestAuth | null | undefined,
): BlueRequestAuth {
  if (auth) {
    return auth;
  }

  throw new AuthError(BLUE_AUTH_REQUIRED_MESSAGE);
}

export async function requireValidatedBlueRequestAuth(
  auth: BlueRequestAuth | null | undefined,
  actor?: EmployeeIdentity | null,
): Promise<BlueRequestAuth> {
  const requestAuth = requireBlueRequestAuth(auth);
  const blueUser = await fetchCurrentBlueUser(requestAuth).catch((error: unknown) => {
    if (isBlueCredentialRejection(error)) {
      throw new AuthError(BLUE_AUTH_INVALID_MESSAGE);
    }

    throw error;
  });

  if (!blueUser) {
    throw new AuthError(BLUE_AUTH_INVALID_MESSAGE);
  }

  if (!blueUser.projectUserRole || blueUser.projectUserRole.isRecordsEnabled === false) {
    throw new AuthError(BLUE_AUTH_WORKSPACE_REQUIRED_MESSAGE);
  }

  if (actor && !blueUserMatchesActor(blueUser, actor)) {
    throw new AuthError(BLUE_AUTH_MISMATCH_MESSAGE);
  }

  return requestAuth;
}

function blueUserMatchesActor(
  blueUser: {
    id?: string | null;
    uid?: string | null;
    email?: string | null;
    fullName?: string | null;
  },
  actor: EmployeeIdentity,
) {
  const blueIds = [blueUser.id, blueUser.uid].map(normalizeComparable).filter(Boolean);
  const actorIds = [actor.employeeId, actor.blueUserId]
    .map(normalizeComparable)
    .filter(Boolean);
  if (actorIds.some((actorId) => blueIds.includes(actorId))) {
    return true;
  }

  const blueEmail = normalizeComparable(blueUser.email);
  const actorEmail = normalizeComparable(actor.email);
  if (blueEmail && actorEmail && blueEmail === actorEmail) {
    return true;
  }

  return false;
}

function normalizeComparable(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function isBlueCredentialRejection(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/auth|credential|forbidden|invalid|permission|token|unauthori[sz]ed/i.test(message)) {
    return true;
  }

  return error instanceof ExternalServiceError && /401|403/.test(message);
}
