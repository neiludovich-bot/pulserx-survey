import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMvpSurveyAuditSession, listMvpSurveyAuditSessions } from "./mvp-survey-audit-service";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn() }));
vi.mock("./prisma", () => ({ prisma: { session: mocks } }));

const sharedStudy = { name: "Latest shared study title", slug: "mvp-customgpt-nubeqa" };
function session(id: string, metadata: unknown) {
  return {
    id, status: "ACTIVE", startedAt: new Date("2026-09-05T12:00:00Z"), completedAt: null,
    metadata, study: sharedStudy, _count: { turns: 0, decisions: 0 }, turns: [], decisions: [],
  };
}

describe("MVP audit session titles", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgresql://example");
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("keeps participant and synthetic session titles distinct in the audit list", async () => {
    mocks.findMany.mockResolvedValue([
      session("participant-session", { studyName: "Participant research study" }),
      session("synthetic-session", { studyName: "SYNTHETIC QA: moderator replay" }),
    ]);
    const result = await listMvpSurveyAuditSessions();
    expect(result.sessions.map(({ id, studyName }) => ({ id, studyName }))).toEqual([
      { id: "participant-session", studyName: "Participant research study" },
      { id: "synthetic-session", studyName: "SYNTHETIC QA: moderator replay" },
    ]);
    expect(sharedStudy.name).toBe("Latest shared study title");
  });

  it.each([
    { metadata: { studyName: "SYNTHETIC QA: moderator replay" }, expected: "SYNTHETIC QA: moderator replay" },
    { metadata: {}, expected: sharedStudy.name },
    { metadata: { studyName: "" }, expected: sharedStudy.name },
    { metadata: { studyName: 42 }, expected: sharedStudy.name },
  ])("uses per-session audit detail titles with legacy fallback: $expected", async ({ metadata, expected }) => {
    mocks.findFirst.mockResolvedValue(session("detail-session", metadata));
    const result = await getMvpSurveyAuditSession("detail-session");
    expect(result?.session.studyName).toBe(expected);
  });
});
