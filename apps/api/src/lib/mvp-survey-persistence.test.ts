import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  persistMvpSurveySessionStarted,
  persistMvpSurveyTurnAudit,
} from "./mvp-survey-persistence";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  decision: {
    create: vi.fn(),
  },
  session: {
    upsert: vi.fn(),
  },
  study: {
    upsert: vi.fn(),
  },
  turn: {
    upsert: vi.fn(),
  },
}));

vi.mock("./prisma", () => ({
  prisma: prismaMock,
}));

const startedAt = new Date("2026-06-09T12:00:00.000Z");

const sessionSnapshot = {
  sessionId: "mvp_session_1",
  surveySlug: "padcev",
  sourceBrand: "PADCEV",
  studyName: "PADCEV HCP MVP",
  surveyIntentSlug: "side-effect-management",
  surveyIntentLabel: "Side Effect Management",
  surveyIntentCoverage: ["identify side-effect confidence"],
  projectId: "97350",
  projectIdEnvName: "CUSTOMGPT_PADCEV_PROJECT_ID",
  targetDurationSeconds: 600,
  startedAt,
  currentQuestionId: "safety_management_workflow",
  currentQuestion: "How do you manage side effects?",
  activeDiseaseAreas: ["la/mUC"],
  primaryDiseaseArea: "la/mUC",
  queuedQuestionIds: ["safety_patient_caution"],
  askedQuestionIds: ["safety_management_workflow"],
  completedReason: null,
};

describe("MVP survey persistence", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.study.upsert.mockResolvedValue({ id: "study_1" });
    prismaMock.session.upsert.mockReturnValue({ op: "session.upsert" });
    prismaMock.turn.upsert.mockReturnValue({ op: "turn.upsert" });
    prismaMock.decision.create.mockReturnValue({ op: "decision.create" });
    prismaMock.$transaction.mockResolvedValue([]);
  });

  afterEach(() => {
    if (originalDatabaseUrl) {
      process.env.DATABASE_URL = originalDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  it("does not attempt DB writes when DATABASE_URL is absent", async () => {
    delete process.env.DATABASE_URL;

    await persistMvpSurveySessionStarted({
      session: sessionSnapshot,
      initialMessage: {
        id: "msg_1",
        role: "interviewer",
        content: "Is it okay to begin?",
        createdAt: startedAt.toISOString(),
        references: [],
      },
      customGptEnabled: true,
      setupReason: null,
    });

    expect(prismaMock.study.upsert).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("writes session, turns, and decision audit records when DB is configured", async () => {
    process.env.DATABASE_URL = "postgresql://example";

    await persistMvpSurveySessionStarted({
      session: sessionSnapshot,
      initialMessage: {
        id: "msg_1",
        role: "interviewer",
        content: "Is it okay to begin?",
        createdAt: startedAt.toISOString(),
        references: [],
      },
      customGptEnabled: true,
      setupReason: null,
    });

    await persistMvpSurveyTurnAudit({
      session: sessionSnapshot,
      turn: {
        eventType: "turn_completed",
        participantMessage: "Neuropathy management matters most.",
        assistantMessage: "What workflow support would help?",
        sequenceBase: 1,
        currentQuestionBefore: "How do you manage side effects?",
        selectedQuestionId: "safety_resources",
        selectedQuestion: "Which resources would help?",
        actualAskedQuestionId: "safety_resources",
        actualAskedQuestion: "What workflow support would help?",
        currentQuestionAfter: "What workflow support would help?",
        sourceContextRequirement: "Use PADCEV safety resources.",
        needsCustomGpt: true,
        customGptStatus: "success",
        customGptReason: "Source context retrieved.",
        references: [
          {
            citationId: "1",
            title: "PADCEV Monotherapy Safety",
            url: "https://padcevhcp.com/safety",
          },
        ],
        droppedReferences: [],
        nextAction: "ask",
        remainingSeconds: 520,
      },
    });

    expect(prismaMock.study.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: "mvp-customgpt-padcev" },
      }),
    );
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(prismaMock.session.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mvp_session_1" },
      }),
    );
    expect(prismaMock.turn.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          role: "PARTICIPANT",
          sequence: 2,
        }),
      }),
    );
    expect(prismaMock.decision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "SELECT_NEXT_QUESTION",
          sessionId: "mvp_session_1",
          status: "COMPLETED",
        }),
      }),
    );
  });
});
