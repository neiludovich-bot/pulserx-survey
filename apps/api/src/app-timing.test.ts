import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@interview/engine", async () => import("../../../packages/engine/src/index"));
vi.mock("@interview/schemas", async () => import("../../../packages/schemas/src/index"));
vi.mock("@interview/prompts", async () => import("../../../packages/prompts/src/index"));
const mocks = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock("./lib/mvp-customgpt-survey-service", () => ({ submitMvpCustomGptSurveyTurn: mocks.submit, startMvpCustomGptSurvey: vi.fn(), submitMvpCustomGptSurveyVoiceTurn: vi.fn(), synthesizeMvpCustomGptSurveyLatestInterviewer: vi.fn(), transcribeMvpCustomGptSurveyVoice: vi.fn() }));
import { buildApp } from "./app";
import { getModelCallTimingContext } from "../../../packages/engine/src/model-call-timing-context";

describe("HTTP survey-turn timing boundary", () => {
  afterEach(() => vi.restoreAllMocks());
  it("returns fresh per-request groups and correlates safe synthetic turn boundaries", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const groups: Array<string | undefined> = [];
    mocks.submit.mockImplementation(async () => {
      await Promise.resolve(); groups.push(getModelCallTimingContext()?.callGroupId);
      return { surveySlug: "nubeqa", studyName: "PRIVATE SYNTHETIC QA", turnCount: 4, content: "PRIVATE answer" };
    });
    const app = buildApp();
    try {
      const responses = await Promise.all([1, 2].map(() => app.inject({ method: "POST", url: "/mvp/customgpt-survey/turn", headers: { origin: "http://localhost:3000", "x-request-id": "PRIVATE user-controlled header" }, payload: { sessionId: "PRIVATE session ID", content: "PRIVATE question", surveySlug: "nubeqa" } })));
      expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
      const headers = responses.map((response) => response.headers["x-model-call-group-id"]);
      expect(new Set(headers).size).toBe(2);
      expect(new Set(groups)).toEqual(new Set(headers));
      expect(responses[0].headers["access-control-expose-headers"]).toContain("X-Model-Call-Group-Id");
      const events = log.mock.calls.map(([entry]) => JSON.parse(entry as string)).filter((entry) => entry.event === "survey_turn_timing");
      expect(new Set(events.map((entry) => entry.callGroupId))).toEqual(new Set(headers));
      expect(events).toHaveLength(2);
      for (const event of events) expect(event).toMatchObject({ status: "success", synthetic: true, survey_slug: "nubeqa", turnSequence: 7 });
      expect(JSON.stringify(events)).not.toContain("PRIVATE");
    } finally { await app.close(); }
  });
});
