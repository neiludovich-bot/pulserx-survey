import { describe, expect, it } from "vitest";
import {
  getIntegrationReadiness,
  verifyIntegrations,
} from "./integration-readiness";

describe("integration readiness", () => {
  it("reports credential readiness without exposing secrets", () => {
    const readiness = getIntegrationReadiness();

    expect(readiness.openaiRealtime.model).toBeTruthy();
    expect(readiness.customGpt.baseUrl).toMatch(/^https?:\/\//);
    expect(readiness.customGpt.studyProjectCount).toBe(0);
    expect(readiness.setupActions).toEqual(expect.any(Array));
    if (!process.env.OPENAI_API_KEY) {
      expect(readiness.setupActions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: "add_openai_key",
            severity: "blocker",
          }),
        ]),
      );
    }
    if (!process.env.CUSTOMGPT_API_KEY) {
      expect(readiness.setupActions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: "add_customgpt_key",
            severity: "blocker",
          }),
        ]),
      );
    }
    expect(readiness).not.toHaveProperty("OPENAI_API_KEY");
    expect(readiness).not.toHaveProperty("CUSTOMGPT_API_KEY");
  });

  it("treats per-study CustomGPT projects as connected setup context", () => {
    const readiness = getIntegrationReadiness({ studyProjectCount: 1 });

    expect(readiness.customGpt.projectConfigured).toBe(true);
    expect(readiness.customGpt.studyProjectCount).toBe(1);
    expect(readiness.setupActions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "set_customgpt_project",
        }),
      ]),
    );
  });

  it("skips active provider checks when credentials are missing", async () => {
    const verification = await verifyIntegrations();

    if (!process.env.OPENAI_API_KEY) {
      expect(verification.openaiRealtime).toMatchObject({
        status: "skipped",
        checked: false,
      });
    }

    if (!process.env.CUSTOMGPT_API_KEY || !process.env.CUSTOMGPT_PROJECT_ID) {
      expect(verification.customGpt).toMatchObject({
        status: "skipped",
        checked: false,
        responseReceived: false,
      });
    }
  });
});
