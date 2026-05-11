import { describe, expect, it } from "vitest";

import {
  selectCandidateFromMessage,
  type PendingRecordCandidate,
} from "../../../src/modules/disambiguation/record-choices.js";

const candidates: PendingRecordCandidate[] = [
  {
    id: "rec_1",
    title: "Salman Chappra - Suffah Academy/Masjid Khadij Commercial deal",
    listTitle: "Rehan Special Projects",
  },
  {
    id: "rec_2",
    title: "Suffah Academy - Commercial - $6.5 M - Apr 30 2026",
    listTitle: "6 - Term Sheet Signed",
  },
  {
    id: "rec_3",
    title: "Suffah Academy - Residential",
    listTitle: "4 - Docs Collected",
  },
];

describe("selectCandidateFromMessage", () => {
  it("resolves numeric follow-ups", () => {
    expect(selectCandidateFromMessage("2", candidates)?.id).toBe("rec_2");
    expect(selectCandidateFromMessage("option 3", candidates)?.id).toBe("rec_3");
    expect(selectCandidateFromMessage("2.", candidates)?.id).toBe("rec_2");
  });

  it("resolves ordinal follow-ups", () => {
    expect(selectCandidateFromMessage("the second one", candidates)?.id).toBe(
      "rec_2",
    );
    expect(selectCandidateFromMessage("third one", candidates)?.id).toBe("rec_3");
    expect(selectCandidateFromMessage("last one", candidates)?.id).toBe("rec_3");
  });

  it("resolves descriptive follow-ups", () => {
    expect(
      selectCandidateFromMessage(
        "the commercial one",
        candidates,
        "suffah academy",
      )?.id,
    ).toBe("rec_2");
    expect(
      selectCandidateFromMessage("the term sheet signed one", candidates)?.id,
    ).toBe("rec_2");
    expect(
      selectCandidateFromMessage("the residential one", candidates)?.id,
    ).toBe("rec_3");
  });

  it("does not guess the first candidate for generic pointer phrases", () => {
    expect(selectCandidateFromMessage("that one", candidates)).toBeNull();
    expect(selectCandidateFromMessage("this client", candidates)).toBeNull();
  });

  it("returns null when there is no reliable match", () => {
    expect(selectCandidateFromMessage("the other lender", candidates)).toBeNull();
  });

  it("does not treat unrelated commands as pending-record selections", () => {
    const hamzaCandidates: PendingRecordCandidate[] = [
      {
        id: "rec_hamza_juma",
        title: "Hamza Juma",
        listTitle: "11 - Closed won / Done",
      },
      {
        id: "rec_hamza_paracha",
        title: "Hamza Paracha",
        listTitle: "1 - Underwriting",
      },
    ];

    expect(
      selectCandidateFromMessage(
        "add follow-up note to AYA SMOKE TEST - OpenAI gpt-4o-mini - 2026-05-11: automated handoff smoke note from Codex",
        hamzaCandidates,
        "hamza",
      ),
    ).toBeNull();
  });
});
