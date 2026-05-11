import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestEnvironment } from "../../helpers/test-env.js";

describe("blue request auth helpers", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("normalizes complete credentials and ignores unresolved placeholders", async () => {
    const env = createTestEnvironment();
    try {
      const { normalizeBlueRequestAuth } = await import(
        "../../../src/modules/blue/request-auth.js"
      );

      expect(
        normalizeBlueRequestAuth({
          tokenId: " pat_123 ",
          tokenSecret: " secret_123 ",
        }),
      ).toEqual({
        tokenId: "pat_123",
        tokenSecret: "secret_123",
      });

      expect(
        normalizeBlueRequestAuth({
          tokenId: "{{AYA_BLUE_TOKEN_ID}}",
          tokenSecret: "{{AYA_BLUE_TOKEN_SECRET}}",
        }),
      ).toBeNull();

      expect(
        normalizeBlueRequestAuth({
          tokenId: "1234567890abcdef1234567890abcdeg",
          tokenSecret: "1234567890abcdef1234567890abcdef",
        }),
      ).toEqual({
        tokenId: "1234567890abcdef1234567890abcdef",
        tokenSecret: "1234567890abcdef1234567890abcdeg",
      });
    } finally {
      env.cleanup();
    }
  });

  it("blocks system fallback when production policy disables it", async () => {
    const env = createTestEnvironment({
      NODE_ENV: "production",
      ALLOW_SYSTEM_BLUE_WRITE_FALLBACK: "false",
      AYA_MCP_API_KEY: "test-mcp-key",
    });
    try {
      const { resolveBlueWriteAuth } = await import(
        "../../../src/modules/blue/request-auth.js"
      );

      expect(() => resolveBlueWriteAuth(null)).toThrow(
        /Blue account is not connected for write actions yet/i,
      );
    } finally {
      env.cleanup();
    }
  });
});
