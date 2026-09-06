import { describe, expect, it } from "vitest";
import { prioritySourceQuestion } from "./mvp-priority-source-scope";

describe("priority source scope", () => {
  it("retains explicit settings in original evidence without adopting generated expansion", () => {
    const query = prioritySourceQuestion({ label: "PFS", participantEvidence: "PFS in previously untreated patients" }, "Example");
    expect(query).toContain("What information about PFS is available for Example?");
    expect(query).toContain("Participant wording: PFS in previously untreated patients");
  });
  it("preserves an actual requested comparison", () => {
    expect(prioritySourceQuestion({ label: "outcomes X versus Y", participantEvidence: "outcomes X versus Y" }, "Example"))
      .toBe("What information about outcomes X versus Y is available for Example?");
  });
  it("uses original evidence when a paraphrased label adds unsupported scope", () => {
    expect(prioritySourceQuestion({ label: "all efficacy across every population", participantEvidence: "PFS" }, "Example"))
      .toBe("What information about PFS is available for Example?");
  });
  it("does not treat a partial word in evidence as the selected label", () => {
    expect(prioritySourceQuestion({ label: "risk", participantEvidence: "brisk activity" }, "Example"))
      .toBe("What information about brisk activity is available for Example?");
  });
});
