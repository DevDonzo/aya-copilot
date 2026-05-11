import { ValidationError } from "../../app/errors.js";
import { config } from "../../config.js";
import type { BlueRequestAuth } from "../../domain/types.js";

const unresolvedPlaceholderPattern = /^\{\{.+\}\}$/;
const blueTokenIdPattern = /^[0-9a-f]{32}$/i;

export const BLUE_WRITE_AUTH_REQUIRED_MESSAGE =
  "Your Blue account is not connected for write actions yet. Open the Aya MCP server settings, save your personal Blue Token ID and Secret, then try again.";

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

  throw new ValidationError(BLUE_WRITE_AUTH_REQUIRED_MESSAGE);
}
