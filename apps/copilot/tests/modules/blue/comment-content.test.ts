import { describe, expect, it } from "vitest";

import { buildBlueCommentContent } from "../../../src/modules/blue/comment-content.js";

describe("blue comment content", () => {
  it("renders teammate mentions as Tiptap mention nodes", async () => {
    const result = await buildBlueCommentContent({
      text: "@sarah khan follow up",
      employees: [
        {
          id: "emp_sarah",
          displayName: "Sarah Khan",
          email: "sarah.khan@ayafinancial.com",
        },
      ],
    });

    expect(result.text).toBe("@sarah khan follow up");
    expect(result.usedMentions).toBe(1);
    expect(result.html).toBe(
      '<p><span class="mention" data-type="mention" contenteditable="false" data-mention="emp_sarah" data-id="emp_sarah" data-label="Sarah Khan">@Sarah Khan</span> follow up</p>',
    );
  });

  it("leaves unmatched mentions as plain text", async () => {
    const result = await buildBlueCommentContent({
      text: "@unknown follow up",
      employees: [
        {
          id: "emp_sarah",
          displayName: "Sarah Khan",
          email: "sarah.khan@ayafinancial.com",
        },
      ],
    });

    expect(result.usedMentions).toBe(0);
    expect(result.html).toBe("<p>@unknown follow up</p>");
  });
});
