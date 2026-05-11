import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BlueUser } from "../../src/types/blue.js";
import { createTestEnvironment } from "../helpers/test-env.js";

const mockEnsureEmployee = vi.fn();
const mockCreateId = vi.fn(() => "ident_test");
const mockFindEmployeeByName = vi.fn();
const mockUpsertIdentityLink = vi.fn();
const mockFetchWorkspaceUsers = vi.fn();
const mockFetchCompanyUsers = vi.fn();

vi.mock("../../src/db.js", () => ({
  ensureEmployee: mockEnsureEmployee,
  createId: mockCreateId,
  findEmployeeByName: mockFindEmployeeByName,
  upsertIdentityLink: mockUpsertIdentityLink,
}));

vi.mock("../../src/modules/blue/graphql/client.js", () => ({
  fetchWorkspaceUsers: mockFetchWorkspaceUsers,
  fetchCompanyUsers: mockFetchCompanyUsers,
}));

describe("users sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fills missing workspace emails from the company directory during sync", async () => {
    const env = createTestEnvironment();
    try {
      mockFetchWorkspaceUsers.mockResolvedValue([
        {
          id: "emp_hamza",
          uid: "uid_hamza",
          email: "",
          firstName: "Hamza",
          lastName: "Paracha",
          fullName: "Hamza Paracha",
          timezone: "America/Toronto",
          updatedAt: "2026-04-09T00:00:00.000Z",
        } satisfies BlueUser,
      ]);
      mockFetchCompanyUsers.mockResolvedValue([
        {
          id: "emp_hamza",
          uid: "uid_hamza",
          email: "hamza.paracha@ayafinancial.com",
          firstName: "Hamza",
          lastName: "Paracha",
          fullName: "Hamza Paracha",
          timezone: "America/Toronto",
          updatedAt: "2026-04-09T00:00:00.000Z",
        } satisfies BlueUser,
      ]);

      const { syncWorkspaceEmployees } = await import("../../src/blue/users-sync.js");
      const result = await syncWorkspaceEmployees();

      expect(mockFetchWorkspaceUsers).toHaveBeenCalledWith("cmn524yr800e101mh7kn44mhf");
      expect(mockFetchCompanyUsers).toHaveBeenCalledWith("test-company");
      expect(mockEnsureEmployee).toHaveBeenCalledWith({
        employeeId: "emp_hamza",
        displayName: "Hamza Paracha",
        email: "hamza.paracha@ayafinancial.com",
        timezone: "America/Toronto",
      });
      expect(result).toEqual({
        fetched: 1,
        withEmail: 1,
        missingEmail: 0,
      });
    } finally {
      env.cleanup();
    }
  });

  it("matches by unique full name only when ids are unavailable", async () => {
    const { enrichWorkspaceUsersWithCompanyDirectory } = await import("../../src/blue/users-sync.js");

    const result = enrichWorkspaceUsersWithCompanyDirectory(
      [
        {
          id: "emp_local",
          email: "",
          firstName: "Sarah",
          lastName: "Khan",
          fullName: "Sarah Khan",
          timezone: null,
        } as BlueUser,
      ],
      [
        {
          id: "emp_remote",
          email: "sarah.khan@ayafinancial.com",
          firstName: "Sarah",
          lastName: "Khan",
          fullName: "Sarah Khan",
          timezone: "America/Toronto",
        } as BlueUser,
      ],
    );

    expect(result[0]).toMatchObject({
      email: "sarah.khan@ayafinancial.com",
      timezone: "America/Toronto",
    });
  });

  it("fills known Aya admin emails when Blue does not expose them", async () => {
    const { applyKnownAyaEmployeeEmails } = await import("../../src/blue/users-sync.js");

    const result = applyKnownAyaEmployeeEmails([
      {
        id: "emp_rehan",
        email: "",
        firstName: "Rehan",
        lastName: "S",
        fullName: "Rehan S",
        timezone: null,
      } as BlueUser,
      {
        id: "emp_sarah",
        email: "",
        firstName: "Sarah",
        lastName: "Khan",
        fullName: "Sarah Khan",
        timezone: null,
      } as BlueUser,
      {
        id: "emp_existing",
        email: "existing@ayafinancial.com",
        firstName: "Existing",
        lastName: "Person",
        fullName: "Sarah Khan",
        timezone: null,
      } as BlueUser,
    ]);

    expect(result).toMatchObject([
      { email: "rsaeed@ayafinancial.com" },
      { email: "skhan@ayafinancial.com" },
      { email: "existing@ayafinancial.com" },
    ]);
  });
});
