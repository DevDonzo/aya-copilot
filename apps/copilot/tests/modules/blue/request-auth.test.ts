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
        /Connect your Blue account before using Aya with CRM data/i,
      );
    } finally {
      env.cleanup();
    }
  });

  it("validates Blue credentials against the signed-in actor", async () => {
    const env = createTestEnvironment();
    const fetchCurrentBlueUser = vi.fn();
    const fetchWorkspaceLists = vi.fn();
    vi.doMock("../../../src/modules/blue/graphql/client.js", () => ({
      fetchCurrentBlueUser,
      fetchWorkspaceLists,
    }));

    try {
      const {
        BLUE_AUTH_INVALID_MESSAGE,
        BLUE_AUTH_MISMATCH_MESSAGE,
        BLUE_AUTH_WORKSPACE_REQUIRED_MESSAGE,
        requireValidatedBlueRequestAuth,
      } = await import("../../../src/modules/blue/request-auth.js");

      fetchCurrentBlueUser.mockResolvedValueOnce({
        id: "employee_1",
        uid: "employee_1",
        email: "hamza@ayafinancial.com",
        fullName: "Hamza Paracha",
        projectUserRole: {
          id: "role_1",
          name: "Member",
          isRecordsEnabled: true,
        },
      });
      await expect(
        requireValidatedBlueRequestAuth(
          { tokenId: "token_1", tokenSecret: "secret_1" },
          {
            employeeId: "employee_1",
            displayName: "Hamza Paracha",
            email: "hamza@ayafinancial.com",
            roleName: "employee",
          },
        ),
      ).resolves.toEqual({ tokenId: "token_1", tokenSecret: "secret_1" });

      fetchCurrentBlueUser.mockRejectedValueOnce(new Error("invalid token"));
      await expect(
        requireValidatedBlueRequestAuth(
          { tokenId: "token_1", tokenSecret: "wrong" },
          {
            employeeId: "employee_1",
            displayName: "Hamza Paracha",
            email: "hamza@ayafinancial.com",
            roleName: "employee",
          },
        ),
      ).rejects.toThrow(BLUE_AUTH_INVALID_MESSAGE);

      fetchCurrentBlueUser.mockResolvedValueOnce({
        id: "employee_2",
        uid: "employee_2",
        email: "other@ayafinancial.com",
        fullName: "Other User",
        projectUserRole: {
          id: "role_1",
          name: "Member",
          isRecordsEnabled: true,
        },
      });
      await expect(
        requireValidatedBlueRequestAuth(
          { tokenId: "token_2", tokenSecret: "secret_2" },
          {
            employeeId: "employee_1",
            displayName: "Hamza Paracha",
            email: "hamza@ayafinancial.com",
            roleName: "employee",
          },
        ),
      ).rejects.toThrow(BLUE_AUTH_MISMATCH_MESSAGE);

      fetchCurrentBlueUser.mockResolvedValueOnce({
        id: "employee_1",
        uid: "employee_1",
        email: "hamza@ayafinancial.com",
        fullName: "Hamza Paracha",
        projectUserRole: null,
      });
      fetchWorkspaceLists.mockResolvedValueOnce([
        { id: "list_1", title: "Leads", position: 1, updatedAt: "2026-05-14" },
      ]);
      await expect(
        requireValidatedBlueRequestAuth(
          { tokenId: "token_1", tokenSecret: "secret_1" },
          {
            employeeId: "employee_1",
            displayName: "Hamza Paracha",
            email: "hamza@ayafinancial.com",
            roleName: "employee",
          },
        ),
      ).resolves.toEqual({ tokenId: "token_1", tokenSecret: "secret_1" });

      expect(fetchWorkspaceLists).toHaveBeenCalledWith({
        workspaceId: "cmhazc4rl1vkand1eonnmiyjy",
        auth: { tokenId: "token_1", tokenSecret: "secret_1" },
      });

      fetchCurrentBlueUser.mockResolvedValueOnce({
        id: "employee_1",
        uid: "employee_1",
        email: "hamza@ayafinancial.com",
        fullName: "Hamza Paracha",
        projectUserRole: {
          id: "role_1",
          name: "Viewer",
          isRecordsEnabled: false,
        },
      });
      await expect(
        requireValidatedBlueRequestAuth(
          { tokenId: "token_1", tokenSecret: "secret_1" },
          {
            employeeId: "employee_1",
            displayName: "Hamza Paracha",
            email: "hamza@ayafinancial.com",
            roleName: "employee",
          },
        ),
      ).rejects.toThrow(BLUE_AUTH_WORKSPACE_REQUIRED_MESSAGE);

      fetchCurrentBlueUser.mockResolvedValueOnce({
        id: "employee_1",
        uid: "employee_1",
        email: "hamza@ayafinancial.com",
        fullName: "Hamza Paracha",
        projectUserRole: null,
      });
      fetchWorkspaceLists.mockRejectedValueOnce(new Error("forbidden"));
      await expect(
        requireValidatedBlueRequestAuth(
          { tokenId: "token_1", tokenSecret: "secret_1" },
          {
            employeeId: "employee_1",
            displayName: "Hamza Paracha",
            email: "hamza@ayafinancial.com",
            roleName: "employee",
          },
        ),
      ).rejects.toThrow(BLUE_AUTH_WORKSPACE_REQUIRED_MESSAGE);
    } finally {
      vi.doUnmock("../../../src/modules/blue/graphql/client.js");
      env.cleanup();
    }
  });

  it("caches successful Blue credential validation for the configured TTL", async () => {
    const env = createTestEnvironment({
      AYA_BLUE_AUTH_CACHE_TTL_MS: "300000",
    });
    const fetchCurrentBlueUser = vi.fn();
    const fetchWorkspaceLists = vi.fn();
    vi.doMock("../../../src/modules/blue/graphql/client.js", () => ({
      fetchCurrentBlueUser,
      fetchWorkspaceLists,
    }));

    try {
      const { requireValidatedBlueRequestAuth } = await import(
        "../../../src/modules/blue/request-auth.js"
      );
      const auth = { tokenId: "token_1", tokenSecret: "secret_1" };
      const actor = {
        employeeId: "employee_1",
        displayName: "Hamza Paracha",
        email: "hamza@ayafinancial.com",
        roleName: "employee",
      };

      fetchCurrentBlueUser.mockResolvedValueOnce({
        id: "employee_1",
        uid: "employee_1",
        email: "hamza@ayafinancial.com",
        fullName: "Hamza Paracha",
        projectUserRole: {
          id: "role_1",
          name: "Member",
          isRecordsEnabled: true,
        },
      });

      await expect(requireValidatedBlueRequestAuth(auth, actor)).resolves.toEqual(
        auth,
      );
      await expect(requireValidatedBlueRequestAuth(auth, actor)).resolves.toEqual(
        auth,
      );

      expect(fetchCurrentBlueUser).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock("../../../src/modules/blue/graphql/client.js");
      env.cleanup();
    }
  });
});
