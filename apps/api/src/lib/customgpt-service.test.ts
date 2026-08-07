import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const itWhenCustomGptKeyMissing = process.env.CUSTOMGPT_API_KEY ? it.skip : it;
const originalEnv = { ...process.env };

describe("CustomGPT clarification service", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  itWhenCustomGptKeyMissing(
    "fails closed when CustomGPT credentials are not configured",
    async () => {
      delete process.env.CUSTOMGPT_API_KEY;
      const { askCustomGptForSurveyClarification } =
        await import("./customgpt-service");

      await expect(
        askCustomGptForSurveyClarification({
          projectId: "123",
          question: "What does the guide mean by warning signs?",
          surveyContext:
            "After reviewing the material, what feels clear, unclear, or concerning?",
        }),
      ).resolves.toMatchObject({
        enabled: false,
        answer: null,
        references: [],
        reason: "CUSTOMGPT_API_KEY is not configured.",
      });
    },
  );

  it("returns a thorough answer with formatted citation references", async () => {
    process.env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    process.env.CUSTOMGPT_PROJECT_ID = "321";
    const messageBodies: unknown[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);

        if (init?.body) {
          messageBodies.push(JSON.parse(String(init.body)));
        }

        if (href.endsWith("/projects/321/conversations")) {
          return new Response(
            JSON.stringify({
              data: {
                session_id: "session_abc",
              },
            }),
            { status: 200 },
          );
        }

        if (href.endsWith("/projects/321/conversations/session_abc/messages")) {
          return new Response(
            JSON.stringify({
              data: {
                openai_response:
                  "The website explains the dosing schedule and distinguishes routine questions from urgent concerns.",
                citations: [101, "102"],
              },
            }),
            { status: 200 },
          );
        }

        if (href.endsWith("/projects/321/citations/101")) {
          return new Response(
            JSON.stringify({
              data: {
                title: "BRUKINSA HCP Dosing",
                page_url: "https://example.test/brukinsa/dosing",
              },
            }),
            { status: 200 },
          );
        }

        if (href.endsWith("/projects/321/citations/102")) {
          return new Response(
            JSON.stringify({
              data: {
                file_name: "BRUKINSA HCP Website Question List.docx",
                file_url: "https://example.test/files/brukinsa-questions.docx",
              },
            }),
            { status: 200 },
          );
        }

        return new Response("not found", { status: 404 });
      }),
    );

    const { askCustomGptForSurveyClarification } =
      await import("./customgpt-service");
    const result = await askCustomGptForSurveyClarification({
      question: "Where does the site explain dosing?",
      surveyContext: "HCP website review",
    });

    expect(result.answer).toContain("The website explains the dosing schedule");
    expect(result.answer).toContain("References:");
    expect(result.answer).toContain("BRUKINSA HCP Dosing");
    expect(result.answer).toContain("https://example.test/brukinsa/dosing");
    expect(result.references).toHaveLength(2);
    expect(result.citationIds).toEqual(["101", "102"]);
    expect(messageBodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          response_source: "own_content",
          agent_capability: "optimal-choice",
        }),
      ]),
    );
    expect(JSON.stringify(messageBodies)).toContain("Give a thorough answer");
    expect(JSON.stringify(messageBodies)).toContain(
      "named clinical study or trial",
    );
    expect(JSON.stringify(messageBodies)).toContain("key endpoint or result");
    expect(JSON.stringify(messageBodies)).not.toContain("one or two sentences");
  });

  it("does not fall back to the global project when a survey explicitly has no project", async () => {
    process.env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    process.env.CUSTOMGPT_PROJECT_ID = "321";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { askCustomGptForSurveyInterviewerTurn } =
      await import("./customgpt-service");
    const result = await askCustomGptForSurveyInterviewerTurn({
      projectId: null,
      participantMessage: "What does the NUBEQA site say?",
      surveyContext: "NUBEQA HCP interview",
      currentQuestion: null,
      selectedNextQuestion: "What stands out about NUBEQA?",
      selectedQuestionSourceContext: null,
      remainingSeconds: 600,
      askedQuestions: [],
    });

    expect(result).toMatchObject({
      enabled: false,
      answer: null,
      references: [],
      reason: "CUSTOMGPT_PROJECT_ID is not configured for this study.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses CustomGPT as retrieval only and strips accidental survey questions", async () => {
    process.env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    process.env.CUSTOMGPT_PROJECT_ID = "654";
    const messageBodies: unknown[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);

        if (init?.body) {
          messageBodies.push(JSON.parse(String(init.body)));
        }

        if (href.endsWith("/projects/654/conversations")) {
          return new Response(
            JSON.stringify({
              data: {
                session_id: "session_retrieval_only",
              },
            }),
            { status: 200 },
          );
        }

        if (
          href.endsWith(
            "/projects/654/conversations/session_retrieval_only/messages",
          )
        ) {
          return new Response(
            JSON.stringify({
              data: {
                openai_response: [
                  "EV-302 reported ORR of 68% with PADCEV plus pembrolizumab versus 44% with chemotherapy, and complete response of 29% versus 13%. [1]",
                  "Which EV-302 result affects your view most?",
                  "For which locally advanced or metastatic urothelial cancer patient types, if any, would the PADCEV evidence make treatment more attractive?",
                ].join("\n\n"),
                citations: [901],
              },
            }),
            { status: 200 },
          );
        }

        if (href.endsWith("/projects/654/citations/901")) {
          return new Response(
            JSON.stringify({
              data: {
                title: "PADCEV EV-302 Efficacy",
                page_url: "https://example.test/padcev/ev-302",
              },
            }),
            { status: 200 },
          );
        }

        return new Response("not found", { status: 404 });
      }),
    );

    const { askCustomGptForSurveyInterviewerTurn } =
      await import("./customgpt-service");
    const result = await askCustomGptForSurveyInterviewerTurn({
      participantMessage: "What did EV-302 show for response rate?",
      surveyContext: "PADCEV source answer turn",
      currentQuestion: "What stands out from the evidence?",
      selectedNextQuestion:
        "For which locally advanced or metastatic urothelial cancer patient types, if any, would the PADCEV evidence make treatment more attractive?",
      selectedQuestionSourceContext:
        "Use EV-302 response endpoints if available.",
      remainingSeconds: 540,
      askedQuestions: ["How familiar are you with PADCEV?"],
      responseMode: "answer_then_ask",
    });

    expect(result.answer).toContain("ORR of 68%");
    expect(result.answer).toContain("complete response of 29%");
    expect(result.answer).not.toContain("Which EV-302 result");
    expect(result.answer).not.toContain("For which locally advanced");
    expect(result.references).toHaveLength(1);

    const promptText = JSON.stringify(messageBodies);
    expect(promptText).toContain("CustomGPT retrieval layer");
    expect(promptText).toContain(
      "survey application appends the selected next question separately",
    );
    expect(promptText).toContain(
      "do not ask, restate, paraphrase, or answer it",
    );
    expect(promptText).not.toContain("ask one survey question");
    expect(promptText).not.toContain("ask at the end");
  });

  it("keeps inline CustomGPT citation objects as respondent-visible references", async () => {
    process.env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    process.env.CUSTOMGPT_PROJECT_ID = "654";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const href = String(url);

        if (href.endsWith("/projects/654/conversations")) {
          return new Response(
            JSON.stringify({
              data: {
                id: "session_inline_refs",
              },
            }),
            { status: 200 },
          );
        }

        if (
          href.endsWith(
            "/projects/654/conversations/session_inline_refs/messages",
          )
        ) {
          return new Response(
            JSON.stringify({
              data: {
                response:
                  "SEQUOIA source context includes trial design, population, and endpoint detail.",
                citations: [
                  {
                    citation_id: 301,
                    page_title: "SEQUOIA Trial Detail",
                    page_url: "https://example.test/sequoia-detail",
                    snippet: "Trial design and endpoint detail.",
                  },
                  {
                    title: "BRUKINSA HCP Efficacy Page",
                    url: "https://example.test/efficacy",
                    description: "Approved HCP site source.",
                  },
                ],
              },
            }),
            { status: 200 },
          );
        }

        return new Response("not found", { status: 404 });
      }),
    );

    const { askCustomGptForSurveyClarification } =
      await import("./customgpt-service");
    const result = await askCustomGptForSurveyClarification({
      question: "What should I know before reacting to SEQUOIA?",
      surveyContext: "SEQUOIA survey prompt",
    });

    expect(result.answer).toContain("SEQUOIA source context");
    expect(result.answer).toContain("References:");
    expect(result.answer).toContain("SEQUOIA Trial Detail");
    expect(result.answer).toContain("https://example.test/sequoia-detail");
    expect(result.answer).toContain("BRUKINSA HCP Efficacy Page");
    expect(result.references).toEqual([
      {
        citationId: "301",
        title: "SEQUOIA Trial Detail",
        url: "https://example.test/sequoia-detail",
        description: "Trial design and endpoint detail.",
      },
      {
        citationId: "inline:2",
        title: "BRUKINSA HCP Efficacy Page",
        url: "https://example.test/efficacy",
        description: "Approved HCP site source.",
      },
    ]);
    expect(result.citationIds).toEqual(["301", "inline:2"]);
  });

  it("asks CustomGPT for proactive study context without answering for the respondent", async () => {
    process.env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    const messageBodies: unknown[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);

        if (init?.body) {
          messageBodies.push(JSON.parse(String(init.body)));
        }

        if (href.endsWith("/projects/777/conversations")) {
          return new Response(
            JSON.stringify({
              data: {
                session_id: "session_context",
              },
            }),
            { status: 200 },
          );
        }

        if (
          href.endsWith("/projects/777/conversations/session_context/messages")
        ) {
          return new Response(
            JSON.stringify({
              data: {
                openai_response:
                  "ALPINE is summarized from approved source material for context, including design, population, endpoints, and caveats.",
                citations: [201],
              },
            }),
            { status: 200 },
          );
        }

        if (href.endsWith("/projects/777/citations/201")) {
          return new Response(
            JSON.stringify({
              data: {
                title: "ALPINE Study Source",
                page_url: "https://example.test/alpine",
                description: "Approved source detail for ALPINE.",
              },
            }),
            { status: 200 },
          );
        }

        return new Response("not found", { status: 404 });
      }),
    );

    const { askCustomGptForProactiveStudyContext } =
      await import("./customgpt-service");
    const result = await askCustomGptForProactiveStudyContext({
      projectId: "777",
      question: "What is your reaction to the ALPINE study data?",
      surveyContext: "The interviewer is about to ask a study reaction prompt.",
    });

    expect(result.answer).toContain("ALPINE is summarized");
    expect(result.answer).toContain("References:");
    expect(result.references).toEqual([
      {
        citationId: "201",
        title: "ALPINE Study Source",
        url: "https://example.test/alpine",
        description: "Approved source detail for ALPINE.",
      },
    ]);
    expect(JSON.stringify(messageBodies)).toContain(
      "Survey question needing context",
    );
    expect(JSON.stringify(messageBodies)).toContain(
      "Do not answer the survey question for the respondent",
    );
    expect(JSON.stringify(messageBodies)).toContain(
      "enough detail for an HCP to react",
    );
    expect(JSON.stringify(messageBodies)).toContain("study name/acronym");
    expect(JSON.stringify(messageBodies)).toContain(
      "Do not reduce substantive study context to a one-line teaser",
    );
    expect(JSON.stringify(messageBodies)).not.toContain(
      "concise source-grounded context block",
    );
  });
});
