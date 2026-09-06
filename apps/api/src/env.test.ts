import { afterEach, describe, expect, it, vi } from "vitest";
import { parseApiEnvFromProcess } from "./env";

afterEach(() => vi.unstubAllEnvs());

describe("survey latency configuration", () => {
  it("defaults narrow interpretation and drafting to low while retaining medium grounding", () => {
    for (const key of ["OPENAI_REASONING_EFFORT", "OPENAI_REASONING_EFFORT_INTERPRETATION", "OPENAI_REASONING_EFFORT_MODERATOR", "OPENAI_REASONING_EFFORT_COMPOSITION", "OPENAI_REASONING_EFFORT_GROUNDING"]) vi.stubEnv(key, undefined);
    expect(parseApiEnvFromProcess()).toMatchObject({
      OPENAI_REASONING_EFFORT: "low", OPENAI_REASONING_EFFORT_INTERPRETATION: "low",
      OPENAI_REASONING_EFFORT_MODERATOR: "medium", OPENAI_REASONING_EFFORT_COMPOSITION: "low",
      OPENAI_REASONING_EFFORT_GROUNDING: "medium",
    });
  });

  it("honors independent production overrides for rollback or measurement", () => {
    vi.stubEnv("OPENAI_REASONING_EFFORT_INTERPRETATION", "medium");
    vi.stubEnv("OPENAI_REASONING_EFFORT_MODERATOR", "high");
    vi.stubEnv("OPENAI_REASONING_EFFORT_COMPOSITION", "medium");
    vi.stubEnv("OPENAI_REASONING_EFFORT_GROUNDING", "high");
    expect(parseApiEnvFromProcess()).toMatchObject({
      OPENAI_REASONING_EFFORT_INTERPRETATION: "medium", OPENAI_REASONING_EFFORT_MODERATOR: "high",
      OPENAI_REASONING_EFFORT_COMPOSITION: "medium", OPENAI_REASONING_EFFORT_GROUNDING: "high",
    });
  });
});
