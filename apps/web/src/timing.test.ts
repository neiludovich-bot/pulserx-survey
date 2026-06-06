import { describe, expect, it } from "vitest";
import { getLiveTimingSnapshot } from "./timing";

describe("getLiveTimingSnapshot", () => {
  it("counts down from the canonical startedAt timestamp", () => {
    const startedAt = "2026-06-01T12:00:00.000Z";
    const nowMs = Date.parse("2026-06-01T12:01:15.000Z");

    expect(
      getLiveTimingSnapshot(
        {
          startedAt,
          targetDurationSeconds: 480,
          elapsedSeconds: 0,
          remainingSeconds: 480,
          isOverTime: false,
        },
        nowMs,
      ),
    ).toMatchObject({
      elapsedSeconds: 75,
      remainingSeconds: 405,
      elapsedPercent: 16,
      isOverTime: false,
    });
  });

  it("does not show negative remaining time after the target duration", () => {
    const startedAt = "2026-06-01T12:00:00.000Z";
    const nowMs = Date.parse("2026-06-01T12:09:00.000Z");

    expect(
      getLiveTimingSnapshot(
        {
          startedAt,
          targetDurationSeconds: 480,
          elapsedSeconds: 0,
          remainingSeconds: 480,
          isOverTime: false,
        },
        nowMs,
      ),
    ).toMatchObject({
      remainingSeconds: 0,
      elapsedPercent: 100,
      isOverTime: true,
    });
  });
});
