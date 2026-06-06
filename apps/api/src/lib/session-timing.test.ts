import { describe, expect, it } from "vitest";
import { sessionStateJsonSchema } from "@interview/schemas";
import { getLiveSessionTiming } from "./session-timing";

function makeSessionState(startedAt: string) {
  return sessionStateJsonSchema.parse({
    sessionId: "session_timing",
    studyId: "study_timing",
    status: "active",
    startedAt,
    lastActivityAt: startedAt,
    targetDurationSeconds: 480,
    elapsedSeconds: 0,
    remainingSeconds: 480,
    currentNodeId: "node_1",
    currentNodeKey: "node_1",
    askedNodeIds: ["node_1"],
    completedNodeIds: [],
    pendingMustAskNodeIds: ["node_1"],
    attemptCountsByNodeId: {},
    facts: {},
    contradictionFlags: [],
    offTopicRedirectCount: 0,
    safetyEscalationCount: 0,
    history: [],
  });
}

describe("getLiveSessionTiming", () => {
  it("computes current API timing from startedAt without mutating state", () => {
    const state = makeSessionState("2026-06-01T12:00:00.000Z");

    expect(
      getLiveSessionTiming(state, Date.parse("2026-06-01T12:02:00.000Z")),
    ).toMatchObject({
      elapsedSeconds: 120,
      remainingSeconds: 360,
      isOverTime: false,
    });
  });

  it("caps remaining time at zero", () => {
    const state = makeSessionState("2026-06-01T12:00:00.000Z");

    expect(
      getLiveSessionTiming(state, Date.parse("2026-06-01T12:09:00.000Z")),
    ).toMatchObject({
      remainingSeconds: 0,
      isOverTime: true,
    });
  });
});
