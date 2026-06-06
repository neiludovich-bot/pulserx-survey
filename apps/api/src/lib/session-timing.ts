import type { SessionStateJson } from "@interview/schemas";

export type SessionTimingSnapshot = {
  startedAt: string | null;
  targetDurationSeconds: number;
  elapsedSeconds: number;
  remainingSeconds: number;
  isOverTime: boolean;
};

export function getLiveSessionTiming(
  sessionState: SessionStateJson,
  nowMs = Date.now(),
): SessionTimingSnapshot {
  const startedMs = sessionState.startedAt
    ? Date.parse(sessionState.startedAt)
    : NaN;
  const elapsedFromClock = Number.isNaN(startedMs)
    ? sessionState.elapsedSeconds
    : Math.floor(Math.max(0, nowMs - startedMs) / 1000);
  const elapsedSeconds = Math.max(
    sessionState.elapsedSeconds,
    elapsedFromClock,
  );
  const remainingSeconds = Math.max(
    0,
    sessionState.targetDurationSeconds - elapsedSeconds,
  );

  return {
    startedAt: sessionState.startedAt,
    targetDurationSeconds: sessionState.targetDurationSeconds,
    elapsedSeconds,
    remainingSeconds,
    isOverTime: remainingSeconds <= 0,
  };
}
