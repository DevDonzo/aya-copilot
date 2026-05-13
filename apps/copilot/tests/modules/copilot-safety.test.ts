import { describe, expect, it } from "vitest";

import { getPreAuthSafetyBlock } from "../../src/modules/copilot/safety.js";

describe("copilot safety guard", () => {
  it("blocks broad destructive bulk actions before identity-dependent planning", () => {
    for (const message of [
      "move every record to Done",
      "delete all records",
      "mark all clients complete",
      "bulk update records",
      "close all records",
    ]) {
      expect(getPreAuthSafetyBlock(message)).toMatchObject({
        code: "BULK_DESTRUCTIVE_ACTION",
      });
    }
  });

  it("does not block read-only broad requests", () => {
    for (const message of [
      "show all records assigned to me",
      "summarize every client I own",
      "who has overdue assignments?",
    ]) {
      expect(getPreAuthSafetyBlock(message)).toBeNull();
    }
  });
});
