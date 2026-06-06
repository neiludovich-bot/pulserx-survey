import type { RespondentSessionResponse } from "@interview/schemas";

export type LiveTimingSnapshot = {
  elapsedSeconds: number;
  remainingSeconds: number;
  elapsedPercent: number;
  isOverTime: boolean;
};

type SessionTiming = RespondentSessionResponse["timing"];

export function getLiveTimingSnapshot(
  timing: SessionTiming,
  nowMs = Date.now(),
): LiveTimingSnapshot {
  const targetDurationSeconds = timing.targetDurationSeconds;
  const startedMs = timing.startedAt ? Date.parse(timing.startedAt) : NaN;
  const elapsedFromClock = Number.isNaN(startedMs)
    ? timing.elapsedSeconds
    : Math.floor(Math.max(0, nowMs - startedMs) / 1000);
  const elapsedSeconds = Math.max(timing.elapsedSeconds, elapsedFromClock);
  const remainingSeconds = Math.max(0, targetDurationSeconds - elapsedSeconds);

  return {
    elapsedSeconds,
    remainingSeconds,
    elapsedPercent: Math.min(
      100,
      Math.round((elapsedSeconds / targetDurationSeconds) * 100),
    ),
    isOverTime: remainingSeconds <= 0,
  };
}
