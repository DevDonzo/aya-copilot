import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BlueUser } from "../../src/types/blue.js";
import { createTestEnvironment } from "../helpers/test-env.js";

const mockEnsureEmployee = vi.fn();
const mockCreateId = vi.fn(() => "ident_test");
const mockFindEmployeeByName = vi.fn();
const mockReassignEmployeeReferences = vi.fn();
const mockUpsertIdentityLink = vi.fn();
const mockFetchWorkspaceUsers = vi.fn();
const mockFetchCompanyUsers = vi.fn();

vi.mock("../../src/db.js", () => ({
  ensureEmployee: mockEnsureEmployee,
  createId: mockCreateId,
  findEmployeeByName: mockFindEmployeeByName,
  reassignEmployeeReferences: mockReassignEmployeeReferences,
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

      expect(mockFetchWorkspaceUsers).toHaveBeenCalledWith("cmhazc4rl1vkand1eonnmiyjy");
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

  it("fills known Aya employee emails when Blue does not expose them", async () => {
    const { applyKnownAyaEmployeeEmails } = await import("../../src/blue/users-sync.js");

    const result = applyKnownAyaEmployeeEmails([
      {
        id: "emp_abdullah",
        email: "",
        firstName: "Abdullah",
        lastName: "Albiz",
        fullName: "Abdullah Albiz",
        timezone: null,
      } as BlueUser,
      {
        id: "emp_ajlan",
        email: "",
        firstName: "Ajlan",
        lastName: "Bilwani",
        fullName: "Ajlan  Bilwani",
        timezone: null,
      } as BlueUser,
      {
        id: "emp_arslan",
        email: "",
        firstName: "Muhammad",
        lastName: "Shahid",
        fullName: "Muhammad Arslan Shahid",
        timezone: null,
      } as BlueUser,
      {
        id: "emp_asiyah",
        email: "",
        firstName: "Asiyah",
        lastName: "Azmi",
        fullName: "Asiyah Azmi",
        timezone: null,
      } as BlueUser,
      {
        id: "emp_hamza",
        email: "",
        firstName: "Hamza",
        lastName: "Paracha",
        fullName: "Hamza Paracha",
        timezone: null,
      } as BlueUser,
      {
        id: "emp_haya",
        email: "",
        firstName: "Hayah",
        lastName: "Hussain",
        fullName: "Hayah Hussain",
        timezone: null,
      } as BlueUser,
      {
        id: "emp_nauman",
        email: "",
        firstName: "Nauman",
        lastName: "Nazir",
        fullName: "Nauman Nazir",
        timezone: null,
      } as BlueUser,
      {
        id: "emp_naved",
        email: "",
        firstName: "Naved",
        lastName: "Hussain",
        fullName: "Naved Hussain",
        timezone: null,
      } as BlueUser,
      {
        id: "emp_rehan",
        email: "",
        firstName: "Rehan",
        lastName: "S",
        fullName: "Rehan S",
        timezone: null,
      } as BlueUser,
      {
        id: "emp_rehan_aya",
        email: "",
        firstName: "Rehan",
        lastName: "AYA",
        fullName: "Rehan AYA",
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
        id: "emp_tahmyna",
        email: "",
        firstName: "Tahmyna",
        lastName: "Qazi",
        fullName: "Tahmyna Qazi",
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
      { email: "abdullaha@ayafinancial.com" },
      { email: "abilwani@ayafinancial.com" },
      { email: "ashahid@ayafinancial.com" },
      { email: "support@ayafinancial.com" },
      { email: "hamza@ayafinancial.com" },
      { email: "hayah@ayafinancial.com" },
      { email: "nnazir@ayafinancial.com" },
      { email: "nh@ayafinancial.com" },
      { email: "rsaeed@ayafinancial.com" },
      { email: "rsaeed@ayafinancial.com" },
      { email: "skhan@ayafinancial.com" },
      { email: "tqazi@ayafinancial.com" },
      { email: "existing@ayafinancial.com" },
    ]);
  });

  it("maps duplicate Blue user ids for the same employee to one canonical employee", async () => {
    const env = createTestEnvironment();
    try {
      mockFetchWorkspaceUsers.mockResolvedValue([
        {
          id: "cm2o7pr4f3tlroi9uexnouw44",
          email: "",
          firstName: "Rehan",
          lastName: "S",
          fullName: "Rehan S",
          timezone: null,
        } satisfies BlueUser,
        {
          id: "cm2or9cai0j7pcacvqx3kgvxz",
          email: "",
          firstName: "Rehan",
          lastName: "AYA",
          fullName: "Rehan AYA",
          timezone: null,
        } satisfies BlueUser,
      ]);
      mockFetchCompanyUsers.mockResolvedValue([]);

      const { syncWorkspaceEmployees } = await import("../../src/blue/users-sync.js");
      const result = await syncWorkspaceEmployees();

      expect(mockEnsureEmployee).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: "cm2o7pr4f3tlroi9uexnouw44",
          displayName: "Rehan S",
          email: "rsaeed@ayafinancial.com",
        }),
      );
      expect(mockUpsertIdentityLink).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: "cm2o7pr4f3tlroi9uexnouw44",
          source: "blue",
          externalId: "cm2o7pr4f3tlroi9uexnouw44",
          externalLabel: "Rehan S",
        }),
      );
      expect(mockUpsertIdentityLink).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: "cm2o7pr4f3tlroi9uexnouw44",
          source: "blue",
          externalId: "cm2or9cai0j7pcacvqx3kgvxz",
          externalLabel: "Rehan AYA",
        }),
      );
      expect(mockReassignEmployeeReferences).toHaveBeenCalledWith({
        duplicateEmployeeId: "cm2or9cai0j7pcacvqx3kgvxz",
        canonicalEmployeeId: "cm2o7pr4f3tlroi9uexnouw44",
      });
      expect(result).toEqual({
        fetched: 2,
        withEmail: 2,
        missingEmail: 0,
      });
    } finally {
      env.cleanup();
    }
  });
});
