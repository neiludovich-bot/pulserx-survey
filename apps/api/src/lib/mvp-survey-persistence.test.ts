import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guideFromQuestionStrings } from "./mvp-brukinsa-guide";
import {
  loadMvpSurveySessionSnapshot,
  persistMvpSurveySessionStarted,
  persistMvpSurveyTurnAudit,
  type MvpPersistenceSessionSnapshot,
} from "./mvp-survey-persistence";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  decision: {
    create: vi.fn(),
  },
  session: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
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
  pendingReturnQuestionId: null,
  activeDiseaseAreas: ["la/mUC"],
  primaryDiseaseArea: "la/mUC",
  queuedQuestionIds: ["safety_patient_caution"],
  excursionQuestionIds: [],
  askedQuestionIds: ["safety_management_workflow"],
  adaptiveProbeQuestions: [],
  completedReason: null,
};

const moderatorState: NonNullable<MvpPersistenceSessionSnapshot["moderatorState"]> = {
  version: 1,
  priorities: [
    {
      id: "pfs",
      label: "Progression-free survival",
      participantEvidence: "PFS and DDI matter most.",
      status: "reacted",
      sourceQuestion: "What progression-free survival evidence is available?",
      reactionEvidence: ["The follow-up is still too short for me."],
      referenceIds: ["pfs-source"],
      probeCount: 0,
    },
    {
      id: "ddi",
      label: "Drug interactions",
      participantEvidence: "PFS and DDI matter most.",
      status: "presented",
      sourceQuestion: "What drug interactions are documented?",
      reactionEvidence: [],
      referenceIds: ["ddi-source"],
      probeCount: 0,
    },
    {
      id: "access",
      label: "Access",
      participantEvidence: "Access is another concern.",
      status: "pending",
      sourceQuestion: "What access resources are available?",
      reactionEvidence: [],
      referenceIds: [],
      probeCount: 0,
    },
    {
      id: "dosing",
      label: "Dosing",
      participantEvidence: "We can skip dosing.",
      status: "skipped",
      sourceQuestion: "What dosing information is available?",
      reactionEvidence: [],
      referenceIds: [],
      probeCount: 0,
    },
  ],
  activePriorityId: "ddi",
};

const importedGuide = guideFromQuestionStrings([
  "What factors matter most?",
  "Which access barrier matters most in your setting?",
  "What else would you like to add?",
]);

describe("MVP survey persistence", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.study.upsert.mockResolvedValue({ id: "study_1" });
    prismaMock.session.upsert.mockReturnValue({ op: "session.upsert" });
    prismaMock.session.findUnique.mockReset();
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
      session: {
        ...sessionSnapshot,
        answeredQuestionIds: ["safety_management_workflow"],
        answerEvidenceByQuestionId: {
          safety_management_workflow: ["Neuropathy management matters most."],
        },
      },
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

    const startedMetadata =
      prismaMock.session.upsert.mock.calls[0][0].create.metadata;
    expect(startedMetadata).toMatchObject({
      answeredQuestionIds: [],
      answerEvidenceByQuestionId: {},
      moderatorState: { version: 1, priorities: [], activePriorityId: null },
    });
    const persistedMetadata =
      prismaMock.session.upsert.mock.calls[1][0].update.metadata;
    prismaMock.session.findUnique.mockResolvedValue({
      id: sessionSnapshot.sessionId,
      startedAt,
      createdAt: startedAt,
      metadata: persistedMetadata,
      study: { name: sessionSnapshot.studyName },
      turns: [],
    });
    const restored = await loadMvpSurveySessionSnapshot(
      sessionSnapshot.sessionId,
    );
    expect(restored?.session).toMatchObject({
      answeredQuestionIds: ["safety_management_workflow"],
      answerEvidenceByQuestionId: {
        safety_management_workflow: ["Neuropathy management matters most."],
      },
    });
  });

  it("restores distinct per-session titles when the shared study name changes", async () => {
    process.env.DATABASE_URL = "postgresql://example";
    const sessions = [
      { ...sessionSnapshot, sessionId: "title_session_1", studyName: "Original participant study" },
      { ...sessionSnapshot, sessionId: "title_session_2", studyName: "Later synthetic study" },
    ];
    for (const session of sessions) {
      await persistMvpSurveySessionStarted({
        session,
        initialMessage: { id: `start_${session.sessionId}`, role: "interviewer", content: "Is it okay to begin?", createdAt: startedAt.toISOString(), references: [] },
        customGptEnabled: true, setupReason: null,
      });
    }
    for (const [index, session] of sessions.entries()) {
      const written = prismaMock.session.upsert.mock.calls[index][0];
      expect(written.create.metadata.studyName).toBe(session.studyName);
      expect(written.update.metadata.studyName).toBe(session.studyName);
      prismaMock.session.findUnique.mockResolvedValue({
        id: session.sessionId, startedAt, createdAt: startedAt,
        metadata: written.create.metadata,
        study: { name: sessions[1].studyName }, turns: [],
      });
      const restored = await loadMvpSurveySessionSnapshot(session.sessionId);
      expect(restored?.session.studyName).toBe(session.studyName);
    }
  });

  it("uses the shared study title for older sessions without a per-session title", async () => {
    process.env.DATABASE_URL = "postgresql://example";
    const { studyName: _oldTitle, ...legacyMetadata } = sessionSnapshot;
    prismaMock.session.findUnique.mockResolvedValue({
      id: sessionSnapshot.sessionId, startedAt, createdAt: startedAt,
      metadata: { runtime: "mvp-customgpt-survey", ...legacyMetadata },
      study: { name: "Legacy shared study title" }, turns: [],
    });
    const restored = await loadMvpSurveySessionSnapshot(sessionSnapshot.sessionId);
    expect(restored?.session.studyName).toBe("Legacy shared study title");
  });

  it("restores old sessions with no answered-question metadata without crediting asked questions", async () => {
    process.env.DATABASE_URL = "postgresql://example";
    prismaMock.session.findUnique.mockResolvedValue({
      id: sessionSnapshot.sessionId,
      startedAt,
      createdAt: startedAt,
      metadata: { runtime: "mvp-customgpt-survey", ...sessionSnapshot },
      study: { name: sessionSnapshot.studyName },
      turns: [],
    });

    const restored = await loadMvpSurveySessionSnapshot(
      sessionSnapshot.sessionId,
    );
    expect(restored?.session.askedQuestionIds).toEqual([
      "safety_management_workflow",
    ]);
    expect(restored?.session.answeredQuestionIds).toEqual([]);
    expect(restored?.session.answerEvidenceByQuestionId).toEqual({});
    expect(restored?.session.moderatorState).toEqual({ version: 1, priorities: [], activePriorityId: null });
    expect(restored?.session.guide).toBeUndefined();
    expect(restored?.session.fullGuide).toBeUndefined();
  });

  it.each(["nubeqa", "brukinsa", "padcev"])(
    "round-trips moderator priorities and decision trace for %s without deriving reaction credit",
    async (surveySlug) => {
      process.env.DATABASE_URL = "postgresql://example";
      const moderatorDecision = {
        action: "ask_reaction",
        priorityId: "ddi",
        reason: "The interaction evidence was presented and its reaction remains unanswered.",
      };
      const persistedModeratorState = structuredClone(moderatorState);
      const evidencePacket = { sources: [{
        id: "ddi-source", surveySlug: surveySlug as "nubeqa" | "brukinsa" | "padcev",
        title: "Original interaction source", url: `https://example.test/${surveySlug}/ddi`,
        description: "Synthetic source fixture; no medical claim.", tags: ["DDI"],
        text: "Original retrieved source excerpt, separate from the generated assistant answer.", assets: [],
      }] };
      persistedModeratorState.priorities[1].evidencePacket = evidencePacket;
      persistedModeratorState.sourceDiscussion = { query: "What interaction precautions are documented?", evidencePacket };
      await persistMvpSurveyTurnAudit({
        session: { ...sessionSnapshot, surveySlug, sourceBrand: surveySlug.toUpperCase(), moderatorState: persistedModeratorState,
          guide: importedGuide, fullGuide: importedGuide },
        turn: {
          eventType: "turn_completed",
          participantMessage: "What about interactions?",
          assistantMessage: "What is your reaction to that interaction information?",
          sequenceBase: 3,
          currentQuestionBefore: sessionSnapshot.currentQuestion,
          nextAction: "ask",
          remainingSeconds: 450,
          moderatorDecision,
        },
      });
      const written = prismaMock.session.upsert.mock.calls[0][0];
      expect(written.create.metadata.moderatorState).toEqual(persistedModeratorState);
      expect(written.update.metadata.moderatorState).toEqual(persistedModeratorState);
      expect(prismaMock.decision.create.mock.calls[0][0].data.output.moderatorDecision).toEqual(moderatorDecision);
      expect(prismaMock.turn.upsert.mock.calls[1][0].create.payload.moderatorDecision).toEqual(moderatorDecision);

      prismaMock.session.findUnique.mockResolvedValue({
        id: sessionSnapshot.sessionId,
        startedAt,
        createdAt: startedAt,
        metadata: written.update.metadata,
        study: { name: sessionSnapshot.studyName },
        turns: [],
      });
      const restored = await loadMvpSurveySessionSnapshot(sessionSnapshot.sessionId);
      expect(restored?.session.moderatorState).toEqual(persistedModeratorState);
      expect(restored?.session.moderatorState?.sourceDiscussion).toEqual(persistedModeratorState.sourceDiscussion);
      expect(restored?.session.moderatorState?.priorities[1].evidencePacket).toEqual(evidencePacket);
      expect(restored?.session.moderatorState?.priorities[1].evidencePacket?.sources[0].text).not.toContain("What is your reaction");
      expect(restored?.session.guide).toEqual(importedGuide);
      expect(restored?.session.fullGuide).toEqual(importedGuide);
      expect(restored?.session.moderatorState?.priorities.find((priority) => priority.id === "ddi")?.reactionEvidence).toEqual([]);
      expect(restored?.session.moderatorState?.priorities.find((priority) => priority.id === "access")?.status).toBe("pending");
    },
  );

  it.each([
    null,
    "invalid",
    { version: 2, priorities: [], activePriorityId: null },
    { version: 1, priorities: [{ id: "ddi", status: "reacted" }], activePriorityId: "ddi" },
    { version: 1, priorities: [], activePriorityId: null, untrustedCredit: true },
    { ...moderatorState, activePriorityId: "missing-priority" },
    { ...moderatorState, priorities: [...moderatorState.priorities, moderatorState.priorities[0]] },
  ])("defaults invalid moderator metadata without fabricating priorities or reactions", async (invalidState) => {
    process.env.DATABASE_URL = "postgresql://example";
    prismaMock.session.findUnique.mockResolvedValue({
      id: sessionSnapshot.sessionId,
      startedAt,
      createdAt: startedAt,
      metadata: { runtime: "mvp-customgpt-survey", ...sessionSnapshot, moderatorState: invalidState },
      study: { name: sessionSnapshot.studyName },
      turns: [],
    });
    const restored = await loadMvpSurveySessionSnapshot(sessionSnapshot.sessionId);
    expect(restored?.session.moderatorState).toEqual({ version: 1, priorities: [], activePriorityId: null });
    expect(restored?.session.askedQuestionIds).toEqual(sessionSnapshot.askedQuestionIds);
  });

  it.each([
    { invalidGuide: [] },
    { invalidGuide: [importedGuide[0], { id: "missing_fields" }] },
    { invalidGuide: [importedGuide[0], importedGuide[0]] },
    { invalidGuide: [{ ...importedGuide[0], unexpected: "not an authored guide field" }] },
  ])("rejects an invalid persisted guide as a whole rather than restoring a partial queue", async ({ invalidGuide }) => {
    process.env.DATABASE_URL = "postgresql://example";
    prismaMock.session.findUnique.mockResolvedValue({
      id: sessionSnapshot.sessionId,
      startedAt, createdAt: startedAt,
      metadata: { runtime: "mvp-customgpt-survey", ...sessionSnapshot, guide: invalidGuide, fullGuide: invalidGuide },
      study: { name: sessionSnapshot.studyName }, turns: [],
    });
    const restored = await loadMvpSurveySessionSnapshot(sessionSnapshot.sessionId);
    expect(restored?.session.guide).toBeUndefined();
    expect(restored?.session.fullGuide).toBeUndefined();
  });

  it("preserves authored source prerequisites and surfaced references in a guide snapshot", async () => {
    process.env.DATABASE_URL = "postgresql://example";
    const sourceGuide = [{
      ...importedGuide[0],
      captureBeforeSourceContext: true,
      sourceContextRequirement: "Present the approved source context after capturing baseline priorities.",
      surfacedReferences: [{ citationId: "approved-guide", title: "Approved source", url: "https://example.test/source", description: null, assets: [] }],
    }];
    await persistMvpSurveySessionStarted({
      session: { ...sessionSnapshot, guide: sourceGuide, fullGuide: [...sourceGuide, importedGuide[1]] },
      initialMessage: { id: "start", role: "interviewer", content: sourceGuide[0].canonicalQuestion, createdAt: startedAt.toISOString(), references: [] },
      customGptEnabled: true, setupReason: null,
    });
    const metadata = prismaMock.session.upsert.mock.calls[0][0].create.metadata;
    expect(metadata.guide).toEqual(sourceGuide);
    expect(metadata.fullGuide).toEqual([...sourceGuide, importedGuide[1]]);
  });

  it("rejects malformed moderator state before any session or turn writes", async () => {
    process.env.DATABASE_URL = "postgresql://example";
    await persistMvpSurveyTurnAudit({
      session: {
        ...sessionSnapshot,
        moderatorState: { version: 99, priorities: [], activePriorityId: null } as unknown as NonNullable<MvpPersistenceSessionSnapshot["moderatorState"]>,
      },
      turn: {
        eventType: "turn_completed",
        participantMessage: "My reaction",
        assistantMessage: "Next question",
        sequenceBase: 1,
        currentQuestionBefore: sessionSnapshot.currentQuestion,
        nextAction: "ask",
        remainingSeconds: 500,
      },
    });
    expect(prismaMock.study.upsert).not.toHaveBeenCalled();
    expect(prismaMock.session.upsert).not.toHaveBeenCalled();
    expect(prismaMock.turn.upsert).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    {
      answeredQuestionIds: "safety_management_workflow",
      answerEvidenceByQuestionId: ["This is not a question-to-evidence map."],
      expectedIds: [],
      expectedEvidence: {},
    },
    {
      answeredQuestionIds: [
        null,
        7,
        "",
        " ",
        "safety_management_workflow",
        "safety_management_workflow",
      ],
      answerEvidenceByQuestionId: JSON.parse(
        '{"safety_management_workflow":["  Exact participant text.  ","  Exact participant text.  "],"bad_type":"not an array","mixed":["valid",5],"blank":[" "],"empty":[]," ":["text"],"__proto__":["text"]}',
      ),
      expectedIds: ["safety_management_workflow"],
      expectedEvidence: {
        safety_management_workflow: ["  Exact participant text.  "],
      },
    },
  ])(
    "discards malformed answered-question metadata conservatively",
    async (fixture) => {
      process.env.DATABASE_URL = "postgresql://example";
      prismaMock.session.findUnique.mockResolvedValue({
        id: sessionSnapshot.sessionId,
        startedAt,
        createdAt: startedAt,
        metadata: {
          runtime: "mvp-customgpt-survey",
          ...sessionSnapshot,
          answeredQuestionIds: fixture.answeredQuestionIds,
          answerEvidenceByQuestionId: fixture.answerEvidenceByQuestionId,
        },
        study: { name: sessionSnapshot.studyName },
        turns: [],
      });

      const restored = await loadMvpSurveySessionSnapshot(
        sessionSnapshot.sessionId,
      );
      expect(restored?.session.answeredQuestionIds).toEqual(
        fixture.expectedIds,
      );
      expect(restored?.session.answerEvidenceByQuestionId).toEqual(
        fixture.expectedEvidence,
      );
    },
  );
});
