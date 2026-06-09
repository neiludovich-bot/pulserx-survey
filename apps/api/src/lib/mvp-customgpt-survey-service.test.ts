import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../env";
import {
  resetMvpCustomGptSurveySessions,
  startMvpCustomGptSurvey,
  submitMvpCustomGptSurveyTurn,
  transcribeMvpCustomGptSurveyVoice,
} from "./mvp-customgpt-survey-service";

const originalCustomGptApiKey = env.CUSTOMGPT_API_KEY;
const originalCustomGptProjectId = env.CUSTOMGPT_PROJECT_ID;
const originalOpenAiApiKey = env.OPENAI_API_KEY;

afterEach(() => {
  env.CUSTOMGPT_API_KEY = originalCustomGptApiKey;
  env.CUSTOMGPT_PROJECT_ID = originalCustomGptProjectId;
  env.OPENAI_API_KEY = originalOpenAiApiKey;
  resetMvpCustomGptSurveySessions();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MVP CustomGPT survey service", () => {
  it("keeps the guarded survey moving when CustomGPT credentials are missing", async () => {
    env.CUSTOMGPT_API_KEY = undefined;
    env.CUSTOMGPT_PROJECT_ID = undefined;

    const started = startMvpCustomGptSurvey({
      targetDurationSeconds: 600,
    });
    expect(started.status).toBe("needs_setup");
    expect(started.currentQuestion).toContain("BRUKINSA");

    const next = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Can you explain the SEQUOIA frontline evidence first?",
    });

    expect(next.nextAction).toBe("setup_required");
    expect(next.currentQuestion).toContain("SEQUOIA");
    expect(next.messages.at(-1)?.content).toContain("guarded survey flow");
  });

  it("does not call CustomGPT for plain non-source survey navigation", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    env.CUSTOMGPT_PROJECT_ID = "96737";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      targetDurationSeconds: 600,
    });
    const next = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Yes",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(next.nextAction).toBe("ask");
    expect(next.currentQuestion).toBe("What is your clinical role?");
    expect(next.messages.at(-1)?.content).toBe("What is your clinical role?");
  });

  it("re-asks the current question when a response looks garbled", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    env.CUSTOMGPT_PROJECT_ID = "96737";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      targetDurationSeconds: 600,
    });
    const next = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content:
        "National did it. About national did it. National is all, yeah. Oh, national, okay, yeah, yeah.",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(next.nextAction).toBe("ask");
    expect(next.currentQuestion).toContain("Is it okay to begin?");
    expect(next.messages.at(-1)?.content).toContain("misheard");
    expect(next.messages.at(-1)?.content).toContain("Is it okay to begin?");
  });

  it("does not advance on non-English transcription text but accepts CLL and MCL", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    env.CUSTOMGPT_PROJECT_ID = "96737";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      targetDurationSeconds: 600,
    });
    await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Yes",
    });
    await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Medical oncologist",
    });
    await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Community oncology practice",
    });

    const rejected = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "안녕하세요.",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(rejected.currentQuestion).toContain("Which B-cell malignancies");
    expect(rejected.messages.at(-1)?.content).toContain("non-English");

    const accepted = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "CLL and MCL",
    });

    expect(accepted.currentQuestion).toBe(
      "Which of those disease areas is most central to your day-to-day practice?",
    );
  });

  it("skips the primary disease focus question when only one disease area is named", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    env.CUSTOMGPT_PROJECT_ID = "96737";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      targetDurationSeconds: 600,
    });
    await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Yes",
    });
    await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Medical oncologist",
    });
    await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Community oncology practice",
    });

    const next = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "CLL",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(next.currentQuestion).toBe(
      "About how many patients in that primary disease area do you personally see or support in a typical month?",
    );
    expect(next.messages.at(-1)?.content).toBe(
      "About how many patients in that primary disease area do you personally see or support in a typical month?",
    );
  });

  it("accepts short spoken patient-volume ranges", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    env.CUSTOMGPT_PROJECT_ID = "96737";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      targetDurationSeconds: 600,
    });

    for (const content of [
      "Yes",
      "Physician",
      "Community oncology practice",
      "CLL and MCL",
      "CLL",
    ]) {
      await submitMvpCustomGptSurveyTurn({
        sessionId: started.sessionId,
        content,
      });
    }

    const next = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "five to ten",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(next.currentQuestion).toBe("How familiar are you with BRUKINSA today?");
  });

  it("completes the MVP after the terminal closing question is answered", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    env.CUSTOMGPT_PROJECT_ID = "96737";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      targetDurationSeconds: 60,
    });

    const closePrompt = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Yes",
    });

    expect(closePrompt.currentQuestion).toContain("To close");

    const completed = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "I have no other questions at this time. Thank you.",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(completed.status).toBe("completed");
    expect(completed.nextAction).toBe("wrap_up");
    expect(completed.currentQuestion).toBeNull();
    expect(completed.messages.at(-1)?.content).toContain(
      "enough to close this MVP pass",
    );
    expect(completed.messages.at(-1)?.content).not.toContain(
      "Before we get into",
    );
  });

  it("rejects a voice transcript that does not answer the active MVP question", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    env.CUSTOMGPT_PROJECT_ID = "96737";
    env.OPENAI_API_KEY = "test-openai-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            text: "Hello, I'm Anzio.",
          }),
          { status: 200 },
        ),
      ),
    );

    const started = startMvpCustomGptSurvey({
      targetDurationSeconds: 600,
    });
    await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Yes",
    });
    await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Medical oncologist",
    });
    await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Community oncology practice",
    });

    await expect(
      transcribeMvpCustomGptSurveyVoice({
        sessionId: started.sessionId,
        audioBase64: Buffer.from("audio-bytes").toString("base64"),
        mimeType: "audio/webm",
      }),
    ).rejects.toThrow("does not look like an answer");
  });

  it("returns a cited CustomGPT answer and keeps control on the selected question", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    env.CUSTOMGPT_PROJECT_ID = "96737";

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      if (href.endsWith("/projects/96737/conversations") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              session_id: "customgpt-session-1",
            },
          }),
          { status: 200 },
        );
      }

      if (href.includes("/messages") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              openai_response:
                "The BRUKINSA source material describes the SEQUOIA study context with cited detail. What stands out to you from the SEQUOIA data, and how does it affect your perception of BRUKINSA in treatment-naive CLL/SLL?",
              citations: [
                {
                  id: "sequoia-source",
                  title: "BRUKINSA HCP SEQUOIA detail",
                  url: "https://example.com/sequoia",
                },
              ],
            },
          }),
          { status: 200 },
        );
      }

      if (href.includes("/citations/sequoia-source") && method === "GET") {
        return new Response(
          JSON.stringify({
            data: {
              id: "sequoia-source",
              title: "BRUKINSA HCP SEQUOIA detail",
              url: "https://example.com/sequoia",
            },
          }),
          { status: 200 },
        );
      }

      return new Response("Unexpected CustomGPT request", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      targetDurationSeconds: 600,
    });
    const next = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Can you explain SEQUOIA first?",
    });

    expect(next.status).toBe("active");
    expect(next.nextAction).toBe("answer_then_ask");
    expect(next.currentQuestion).toContain("SEQUOIA");
    expect(next.messages.at(-1)?.content).toContain("[1]");
    expect(next.messages.at(-1)?.references).toEqual([
      {
        citationId: "sequoia-source",
        title: "BRUKINSA HCP SEQUOIA detail",
        url: "https://example.com/sequoia",
        description: null,
      },
    ]);
  });

  it("normalizes orphaned CustomGPT citation markers to returned references", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    env.CUSTOMGPT_PROJECT_ID = "96737";

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      if (href.endsWith("/projects/96737/conversations") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              session_id: "customgpt-session-orphan-citation",
            },
          }),
          { status: 200 },
        );
      }

      if (href.includes("/messages") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              openai_response:
                "The SEQUOIA answer came back with an orphaned marker. [7] How does the SEQUOIA evidence affect your view of BRUKINSA in first-line CLL/SLL?",
              citations: [
                {
                  id: "sequoia-source",
                  title: "BRUKINSA HCP SEQUOIA detail",
                  url: "https://example.com/sequoia",
                },
              ],
            },
          }),
          { status: 200 },
        );
      }

      return new Response("Unexpected CustomGPT request", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      targetDurationSeconds: 600,
    });
    const next = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Can you explain SEQUOIA first?",
    });

    const content = next.messages.at(-1)?.content ?? "";
    expect(content).toContain("[1]");
    expect(content).not.toContain("[7]");
  });

  it("normalizes simple clinical math markup from CustomGPT answers", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    env.CUSTOMGPT_PROJECT_ID = "96737";

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      if (href.endsWith("/projects/96737/conversations") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              session_id: "customgpt-session-markup",
            },
          }),
          { status: 200 },
        );
      }

      if (href.includes("/messages") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              openai_response:
                "Maintained above the $$IC_{50}$$ with low off-target activity. What is your clinical role?",
              citations: [],
            },
          }),
          { status: 200 },
        );
      }

      return new Response("Unexpected CustomGPT request", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      targetDurationSeconds: 600,
    });
    const next = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Can you explain the BTK binding claim?",
    });

    const content = next.messages.at(-1)?.content ?? "";
    expect(content).toContain("IC50");
    expect(content).not.toContain("$$");
    expect(content).not.toContain("_{50}");
  });

  it("drops off-lane CustomGPT references when CLL is the active disease lane", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    env.CUSTOMGPT_PROJECT_ID = "96737";

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      if (href.endsWith("/projects/96737/conversations") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              session_id: "customgpt-session-off-lane",
            },
          }),
          { status: 200 },
        );
      }

      if (href.includes("/messages") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              openai_response:
                "For CLL/SLL patient fit, the relevant source context should stay in CLL/SLL. [1] [2] [3] For which first-line CLL/SLL patient types, if any, would this evidence make BRUKINSA more attractive?",
              citations: [
                {
                  id: "wm-source",
                  title: "WM Resources for HCPs | BRUKINSA",
                  url: "https://brukinsahcp.com/wm/resources/",
                },
                {
                  id: "cll-source",
                  title: "BRUKINSA CLL Study Design | HCPs",
                  url: "https://brukinsahcp.com/cll/study-design/",
                },
                {
                  id: "mcl-source",
                  title: "BRUKINSA MCL Study Design | HCPs",
                  url: "https://brukinsahcp.com/mcl/study-design/",
                },
              ],
            },
          }),
          { status: 200 },
        );
      }

      return new Response("Unexpected CustomGPT request", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      targetDurationSeconds: 600,
    });
    await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Yes",
    });
    await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Medical oncologist",
    });
    await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Community oncology practice",
    });
    await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "CLL",
    });

    const next = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content:
        "I want to know what are the appropriate patient populations, including exclusions or inclusions based on gene mutation or high risk for a known side effect.",
    });

    expect(next.currentQuestion).toContain("first-line CLL/SLL patient types");
    expect(next.messages.at(-1)?.references).toEqual([
      {
        citationId: "cll-source",
        title: "BRUKINSA CLL Study Design | HCPs",
        url: "https://brukinsahcp.com/cll/study-design/",
        description: null,
      },
    ]);
    expect(next.messages.at(-1)?.content).toContain("[1]");
    expect(next.messages.at(-1)?.content).not.toContain("[2]");
    expect(next.messages.at(-1)?.content).not.toContain("[3]");
  });

  it("requires proactive source context when the respondent did not ask for the study background", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    env.CUSTOMGPT_PROJECT_ID = "96737";

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      if (href.endsWith("/projects/96737/conversations") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              session_id: "customgpt-session-2",
            },
          }),
          { status: 200 },
        );
      }

      if (href.includes("/messages") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              openai_response:
                "SEQUOIA context from the BRUKINSA source appears first. What stands out to you from the SEQUOIA data, and how does it affect your perception of BRUKINSA in treatment-naive CLL/SLL?",
              citations: [
                {
                  id: "sequoia-source",
                  title: "BRUKINSA HCP SEQUOIA detail",
                  url: "https://example.com/sequoia",
                },
              ],
            },
          }),
          { status: 200 },
        );
      }

      if (href.includes("/citations/sequoia-source") && method === "GET") {
        return new Response(
          JSON.stringify({
            data: {
              id: "sequoia-source",
              title: "BRUKINSA HCP SEQUOIA detail",
              url: "https://example.com/sequoia",
            },
          }),
          { status: 200 },
        );
      }

      return new Response("Unexpected CustomGPT request", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      targetDurationSeconds: 600,
    });
    for (const content of [
      "Yes",
      "Medical oncologist",
      "Community oncology practice",
      "CLL",
      "CLL",
      "About 20 patients per month",
      "I am moderately familiar.",
    ]) {
      await submitMvpCustomGptSurveyTurn({
        sessionId: started.sessionId,
        content,
      });
    }

    const next = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "SEQUOIA frontline efficacy is what matters most to me.",
    });

    const messageRequest = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/messages"),
    )?.[1] as RequestInit | undefined;
    const messageBody = JSON.parse(String(messageRequest?.body)) as {
      prompt: string;
      custom_context: string;
    };

    expect(next.nextAction).toBe("answer_then_ask");
    expect(next.currentQuestion).toContain("SEQUOIA");
    expect(messageBody.prompt).toContain("source-context requirement applies");
    expect(messageBody.prompt).toContain("Do not ask the question naked");
    expect(messageBody.custom_context).toContain(
      "Source-context requirement for this turn",
    );
    expect(messageBody.prompt.length).toBeLessThanOrEqual(7800);
  });

  it("compacts long participant answers before calling CustomGPT", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    env.CUSTOMGPT_PROJECT_ID = "96737";

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      if (href.endsWith("/projects/96737/conversations") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              session_id: "customgpt-session-3",
            },
          }),
          { status: 200 },
        );
      }

      if (href.includes("/messages") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              openai_response:
                "I heard your detail. How does the SEQUOIA evidence affect your view of BRUKINSA in first-line CLL/SLL?",
              citations: [],
            },
          }),
          { status: 200 },
        );
      }

      return new Response("Unexpected CustomGPT request", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      targetDurationSeconds: 600,
    });
    await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: `Can you explain the SEQUOIA frontline evidence? ${"detail ".repeat(900)}`,
    });

    const messageRequest = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/messages"),
    )?.[1] as RequestInit | undefined;
    const messageBody = JSON.parse(String(messageRequest?.body)) as {
      prompt: string;
    };

    expect(messageBody.prompt.length).toBeLessThanOrEqual(7800);
    expect(messageBody.prompt).toContain("[truncated]");
  });

  it("does not jump backward to intake questions after a later content module", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    env.CUSTOMGPT_PROJECT_ID = "96737";

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      if (href.endsWith("/projects/96737/conversations") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              session_id: `customgpt-session-${fetchMock.mock.calls.length}`,
            },
          }),
          { status: 200 },
        );
      }

      if (href.includes("/messages") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          prompt?: string;
        };
        const prompt = body.prompt ?? "";
        const answer = prompt.includes("support resources")
          ? "Thinking about practical barriers, the BRUKINSA HCP site describes support resources such as patient brochures, a patient management guide, dosing/administration materials, and myBeOne Support for access and reimbursement. Would these types of resources meaningfully reduce real-world barriers to using or supporting BRUKINSA for you, or would access and logistics still be a concern?"
          : "Thinking across the clinical evidence, safety and tolerability, disease indications, dosing, medication-management information, patient fit, and support resources, what is your overall perception of BRUKINSA after reviewing this information?";

        return new Response(
          JSON.stringify({
            data: {
              openai_response: answer,
              citations: [],
            },
          }),
          { status: 200 },
        );
      }

      return new Response("Unexpected CustomGPT request", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      targetDurationSeconds: 600,
    });
    for (const content of [
      "Yes",
      "Medical oncologist",
      "Community oncology practice",
      "CLL",
      "CLL",
      "About 20 patients per month",
      "I am moderately familiar.",
    ]) {
      await submitMvpCustomGptSurveyTurn({
        sessionId: started.sessionId,
        content,
      });
    }

    const supportTurn = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Access and support resources are practical barriers.",
    });

    expect(supportTurn.currentQuestion).toContain("support resources");
    expect(supportTurn.messages.at(-1)?.content).not.toContain(
      "What type of practice setting do you work in?",
    );

    const nextTurn = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "They might help somewhat, but logistics would still matter.",
    });

    expect(nextTurn.currentQuestion).toContain("overall perception");
    expect(nextTurn.currentQuestion).not.toContain("practice setting");
    expect(nextTurn.messages.at(-1)?.content).not.toContain(
      "What type of practice setting do you work in?",
    );
  });

  it("keeps the active CLL disease lane instead of auto-pivoting into WM", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    env.CUSTOMGPT_PROJECT_ID = "96737";

    const prompts: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      if (href.endsWith("/projects/96737/conversations") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              session_id: `customgpt-session-${fetchMock.mock.calls.length}`,
            },
          }),
          { status: 200 },
        );
      }

      if (href.includes("/messages") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          prompt?: string;
        };
        const prompt = body.prompt ?? "";
        prompts.push(prompt);
        const selectedQuestion =
          prompt.match(
            /Selected next survey question to ask at the end of your message: ([^\n]+)/,
          )?.[1] ?? "Thanks, that gives us enough.";

        return new Response(
          JSON.stringify({
            data: {
              openai_response: selectedQuestion,
              citations: [],
            },
          }),
          { status: 200 },
        );
      }

      return new Response("Unexpected CustomGPT request", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      targetDurationSeconds: 600,
    });

    for (const content of [
      "Yes",
      "Medical oncologist",
      "Community oncology practice",
      "CLL only",
      "First-line efficacy is what I care about.",
      "That improves my confidence in CLL.",
      "The head-to-head ibrutinib comparison matters.",
      "Safety and tolerability matter next.",
    ]) {
      await submitMvpCustomGptSurveyTurn({
        sessionId: started.sessionId,
        content,
      });
    }

    const next = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "That makes sense.",
    });

    const lastPrompt = prompts.at(-1) ?? "";
    expect(next.currentQuestion).toContain("safety and tolerability");
    expect(next.currentQuestion).not.toContain("Waldenstrom");
    expect(next.currentQuestion).not.toContain("WM evidence");
    expect(lastPrompt).toContain("Active disease lane: CLL/SLL");
    expect(lastPrompt).not.toContain("wm_aspen");
  });

  it("scopes broad reactive source questions to the active CLL lane", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    env.CUSTOMGPT_PROJECT_ID = "96737";

    const prompts: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      if (href.endsWith("/projects/96737/conversations") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              session_id: `customgpt-session-${fetchMock.mock.calls.length}`,
            },
          }),
          { status: 200 },
        );
      }

      if (href.includes("/messages") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          prompt?: string;
        };
        const prompt = body.prompt ?? "";
        prompts.push(prompt);

        return new Response(
          JSON.stringify({
            data: {
              openai_response:
                "For CLL/SLL, the newer information should stay focused on CLL/SLL source material. Before we get into BRUKINSA-specific information, when you evaluate or support use of a BTK inhibitor for an appropriate patient, what are the top two or three factors that matter most?",
              citations: [
                {
                  id: "cll-efficacy",
                  title: "BRUKINSA® (zanubrutinib) Efficacy in CLL | HCPs",
                  url: "https://brukinsahcp.com/cll/efficacy/",
                },
              ],
            },
          }),
          { status: 200 },
        );
      }

      return new Response("Unexpected CustomGPT request", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      targetDurationSeconds: 600,
    });

    for (const content of [
      "Yes",
      "Medical oncologist",
      "Community oncology practice",
      "CLL",
      "I treat 5 to 10 CLL patients per month",
    ]) {
      await submitMvpCustomGptSurveyTurn({
        sessionId: started.sessionId,
        content,
      });
    }

    const turn = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content:
        "I am pretty familiar with its first indication but what is new information?",
    });

    const lastPrompt = prompts.at(-1) ?? "";
    expect(turn.messages.at(-1)?.content).toContain("BTK inhibitor");
    expect(lastPrompt).toContain("Active disease lane: CLL/SLL");
    expect(lastPrompt).toContain("broad source/detail question");
    expect(lastPrompt).toContain("scoped to the active disease lane (CLL/SLL)");
    expect(lastPrompt).toContain("do not answer from or cite other disease pages");
    expect(lastPrompt).toContain("Respect the active disease lane");
    expect(lastPrompt).not.toContain("WM Study Design");
  });

  it("accepts short option answers and routes guideline choices to a guideline module", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    env.CUSTOMGPT_PROJECT_ID = "96737";

    const prompts: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      if (href.endsWith("/projects/96737/conversations") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              session_id: `customgpt-session-${fetchMock.mock.calls.length}`,
            },
          }),
          { status: 200 },
        );
      }

      if (href.includes("/messages") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          prompt?: string;
        };
        const prompt = body.prompt ?? "";
        prompts.push(prompt);
        const selectedQuestion =
          prompt.match(
            /Selected next survey question to ask at the end of your message: ([^\n]+)/,
          )?.[1] ?? "Thanks, that gives us enough.";

        return new Response(
          JSON.stringify({
            data: {
              openai_response: selectedQuestion,
              citations: [],
            },
          }),
          { status: 200 },
        );
      }

      return new Response("Unexpected CustomGPT request", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      targetDurationSeconds: 600,
    });

    for (const content of [
      "Yes",
      "Medical oncologist",
      "Community oncology practice",
      "CLL",
      "five to ten",
      "I am familiar with BRUKINSA in CLL.",
    ]) {
      await submitMvpCustomGptSurveyTurn({
        sessionId: started.sessionId,
        content,
      });
    }

    const orientationTurn = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "CLL.",
    });

    expect(orientationTurn.currentQuestion).toContain(
      "what part matters most for your view of BRUKINSA",
    );

    const guidelineTurn = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Guidelines",
    });

    const lastPrompt = prompts.at(-1) ?? "";
    expect(guidelineTurn.messages.at(-1)?.content).not.toContain(
      "I may not have captured",
    );
    expect(guidelineTurn.currentQuestion).toContain(
      "NCCN or guideline positioning",
    );
    expect(lastPrompt).toContain("CLL/SLL guideline or NCCN positioning");
    expect(lastPrompt).toContain("Selected next module: CLL/SLL - Guideline Positioning");
  });

  it("queues multiple respondent priority factors instead of fixating on one", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    env.CUSTOMGPT_PROJECT_ID = "96737";

    const prompts: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      if (href.endsWith("/projects/96737/conversations") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              session_id: `customgpt-session-${fetchMock.mock.calls.length}`,
            },
          }),
          { status: 200 },
        );
      }

      if (href.includes("/messages") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          prompt?: string;
        };
        const prompt = body.prompt ?? "";
        prompts.push(prompt);
        const selectedQuestion =
          prompt.match(
            /Selected next survey question to ask at the end of your message: ([^\n]+)/,
          )?.[1] ?? "Thanks, that gives us enough.";

        return new Response(
          JSON.stringify({
            data: {
              openai_response: selectedQuestion,
              citations: [],
            },
          }),
          { status: 200 },
        );
      }

      return new Response("Unexpected CustomGPT request", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      targetDurationSeconds: 600,
    });

    for (const content of [
      "Yes",
      "Medical oncologist",
      "Community oncology practice",
      "CLL",
      "five to ten",
      "Very familiar.",
    ]) {
      await submitMvpCustomGptSurveyTurn({
        sessionId: started.sessionId,
        content,
      });
    }

    const evidenceTurn = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Overall survival, NCCN categorization, and side effect profile.",
    });

    expect(evidenceTurn.status).toBe("active");
    expect(evidenceTurn.currentQuestion).toContain("SEQUOIA evidence");
    expect(prompts.at(-1) ?? "").toContain(
      "Queued respondent-priority modules after this turn: cll_guideline_positioning",
    );
    expect(prompts.at(-1) ?? "").toContain("cll_safety_tolerability");

    const guidelineTurn = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "The PFS evidence is important.",
    });

    expect(guidelineTurn.status).toBe("active");
    expect(guidelineTurn.currentQuestion).toContain(
      "NCCN or guideline positioning",
    );

    const safetyTurn = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "NCCN category would increase confidence.",
    });

    expect(safetyTurn.status).toBe("active");
    expect(safetyTurn.currentQuestion).toContain("safety and tolerability");
    expect(safetyTurn.currentQuestion).not.toContain("Survey complete");
  });

  it("routes generic data requests to concrete study detail instead of vague perception", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";
    env.CUSTOMGPT_PROJECT_ID = "96737";

    const prompts: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      if (href.endsWith("/projects/96737/conversations") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              session_id: `customgpt-session-${fetchMock.mock.calls.length}`,
            },
          }),
          { status: 200 },
        );
      }

      if (href.includes("/messages") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          prompt?: string;
        };
        const prompt = body.prompt ?? "";
        prompts.push(prompt);

        const answer = prompt.includes("What is your clinical role?")
          ? "What is your clinical role?"
          : prompt.includes("What type of practice setting do you work in?")
            ? "What type of practice setting do you work in?"
            : prompt.includes(
                  "Which B-cell malignancies do you personally treat",
                )
              ? "Which B-cell malignancies do you personally treat, manage, counsel, monitor, or support?"
              : "Here are the concrete study highlights from the BRUKINSA source material, including design, endpoints, numeric results, and caveats. Which part of this evidence is most relevant to your view: CLL/SLL SEQUOIA first-line data, CLL/SLL ALPINE head-to-head data, MCL/MZL/FL response-focused data, safety/tolerability, or something else?";

        return new Response(
          JSON.stringify({
            data: {
              openai_response: answer,
              citations: [
                {
                  id: "sequoia-source",
                  title: "BRUKINSA HCP SEQUOIA detail",
                  url: "https://example.com/sequoia",
                },
              ],
            },
          }),
          { status: 200 },
        );
      }

      if (href.includes("/citations/sequoia-source") && method === "GET") {
        return new Response(
          JSON.stringify({
            data: {
              id: "sequoia-source",
              title: "BRUKINSA HCP SEQUOIA detail",
              url: "https://example.com/sequoia",
            },
          }),
          { status: 200 },
        );
      }

      return new Response("Unexpected CustomGPT request", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      targetDurationSeconds: 600,
    });
    await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Yes",
    });
    await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Community hematologist oncologist",
    });
    await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Community oncology",
    });
    const dataTurn = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "I treat CLL and MCL. It sounds like a good drug, but what does the data show?",
    });

    const lastPrompt = prompts.at(-1) ?? "";
    expect(dataTurn.currentQuestion).toContain("Which part of this evidence");
    expect(dataTurn.currentQuestion).not.toContain("current perception");
    expect(lastPrompt).toContain("Give the actual useful study details");
    expect(lastPrompt).toContain("key numeric result");
    expect(lastPrompt).toContain("prioritize concrete study results");
    expect(lastPrompt).toContain("SEQUOIA and ALPINE highlights");
  });

  it("passes recent source context so repeated PADCEV AE follow-ups do not restate the same safety dump", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";

    const prompts: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      if (href.endsWith("/projects/97350/conversations") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              session_id: `padcev-session-${fetchMock.mock.calls.length}`,
            },
          }),
          { status: 200 },
        );
      }

      if (href.includes("/messages") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          prompt?: string;
        };
        const prompt = body.prompt ?? "";
        prompts.push(prompt);

        const answer =
          prompts.length === 1
            ? "Peripheral neuropathy and rash were already summarized with monitoring and dose modification guidance. Which safety or tolerability details most influence how comfortable you would be using or supporting PADCEV?"
            : "Since we already covered the broad adverse-event profile, the added point is to focus on the respondent's specific rash workflow rather than restating the full AE list. For which locally advanced or metastatic urothelial cancer patient types, if any, would the PADCEV evidence make treatment more attractive, and where would you be cautious?";

        return new Response(
          JSON.stringify({
            data: {
              openai_response: answer,
              citations: [
                {
                  id: "padcev-safety",
                  title: "PADCEV Monotherapy Safety",
                  url: "https://padcevhcp.com/monotherapy-safety/",
                },
              ],
            },
          }),
          { status: 200 },
        );
      }

      if (href.includes("/citations/padcev-safety") && method === "GET") {
        return new Response(
          JSON.stringify({
            data: {
              id: "padcev-safety",
              title: "PADCEV Monotherapy Safety",
              url: "https://padcevhcp.com/monotherapy-safety/",
            },
          }),
          { status: 200 },
        );
      }

      return new Response("Unexpected CustomGPT request", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      surveySlug: "padcev",
      surveyIntentSlug: "side-effect-management",
      targetDurationSeconds: 600,
    });

    await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Yes",
    });

    await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Can you say more about adverse events, specifically rash?",
    });

    const repeatedAePrompt = prompts.at(-1) ?? "";
    expect(repeatedAePrompt).toContain(
      "Do not repeat source context already given in recent interviewer turns",
    );
    expect(repeatedAePrompt).toContain(
      "do not produce a full label-style safety inventory",
    );
    expect(repeatedAePrompt).toContain("2-4 focused bullets");
    expect(repeatedAePrompt).toContain(
      "Recent interviewer source context already covered",
    );
    expect(repeatedAePrompt).toContain(
      "Peripheral neuropathy and rash were already summarized",
    );
  });

  it("keeps the PADCEV side-effect intent inside safety-management questions", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";

    const prompts: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      if (href.endsWith("/projects/97350/conversations") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              session_id: `padcev-session-${fetchMock.mock.calls.length}`,
            },
          }),
          { status: 200 },
        );
      }

      if (href.includes("/messages") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          prompt?: string;
        };
        const prompt = body.prompt ?? "";
        prompts.push(prompt);
        const selectedQuestion =
          prompt.match(
            /Selected next survey question to ask at the end of your message: ([^\n]+)/,
          )?.[1] ?? "Thanks, that gives us enough.";

        return new Response(
          JSON.stringify({
            data: {
              openai_response: selectedQuestion,
              citations: [],
            },
          }),
          { status: 200 },
        );
      }

      return new Response("Unexpected CustomGPT request", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      surveySlug: "padcev",
      surveyIntentSlug: "side-effect-management",
      targetDurationSeconds: 600,
    });

    const safetyTurn = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Yes",
    });

    expect(safetyTurn.currentQuestion).toContain(
      "Which safety or tolerability details",
    );
    expect(prompts.at(-1) ?? "").toContain(
      "Intent-blocked question ids unless respondent explicitly asks off-lane",
    );
    expect(prompts.at(-1) ?? "").toContain("patient_fit");

    const managementTurn = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Peripheral neuropathy is the biggest practical concern.",
    });

    expect(managementTurn.currentQuestion).toContain(
      "When a PADCEV adverse event emerges",
    );
    expect(managementTurn.currentQuestion).not.toContain(
      "would the PADCEV evidence make treatment more attractive",
    );
    expect(prompts.at(-1) ?? "").toContain(
      "Do not cite efficacy/PFS/OS pages unless the respondent explicitly asks about risk-benefit",
    );
    expect(prompts.at(-1) ?? "").toContain(
      "broad patient-attractiveness modules are off-lane",
    );

    const resourceTurn = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "I would need dose modification guidance and a monitoring checklist.",
    });

    expect(resourceTurn.currentQuestion).toContain(
      "monitoring checklists, adverse-reaction management guides",
    );
    expect(resourceTurn.currentQuestion).not.toContain(
      "would the PADCEV evidence make treatment more attractive",
    );
  });

  it("does not route early PADCEV side-effect concerns to the closing question", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      if (href.endsWith("/projects/97350/conversations") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              session_id: `padcev-session-${fetchMock.mock.calls.length}`,
            },
          }),
          { status: 200 },
        );
      }

      if (href.includes("/messages") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          prompt?: string;
        };
        const selectedQuestion =
          body.prompt?.match(
            /Selected next survey question to ask at the end of your message: ([^\n]+)/,
          )?.[1] ?? "Thanks, that gives us enough.";

        return new Response(
          JSON.stringify({
            data: {
              openai_response: selectedQuestion,
              citations: [],
            },
          }),
          { status: 200 },
        );
      }

      return new Response("Unexpected CustomGPT request", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      surveySlug: "padcev",
      surveyIntentSlug: "general-padcev-reaction",
      targetDurationSeconds: 600,
    });

    const familiarityTurn = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Yes",
    });
    expect(familiarityTurn.currentQuestion).toContain(
      "How familiar are you with PADCEV",
    );

    const positioningTurn = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Very familiar.",
    });
    expect(positioningTurn.currentQuestion).toContain(
      "current role across first-line combination therapy",
    );

    const safetyTurn = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "It sounds good but I'm concerned about the side effects.",
    });

    expect(safetyTurn.currentQuestion).toContain(
      "Which safety or tolerability details",
    );
    expect(safetyTurn.currentQuestion).not.toContain("To close");
  });

  it("does not keyword-route terminal questions from generic partial words", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      if (href.endsWith("/projects/97350/conversations") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              session_id: `padcev-session-${fetchMock.mock.calls.length}`,
            },
          }),
          { status: 200 },
        );
      }

      if (href.includes("/messages") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          prompt?: string;
        };
        const selectedQuestion =
          body.prompt?.match(
            /Selected next survey question to ask at the end of your message: ([^\n]+)/,
          )?.[1] ?? "Thanks, that gives us enough.";

        return new Response(
          JSON.stringify({
            data: {
              openai_response: selectedQuestion,
              citations: [],
            },
          }),
          { status: 200 },
        );
      }

      return new Response("Unexpected CustomGPT request", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      surveySlug: "padcev",
      surveyIntentSlug: "general-padcev-reaction",
      targetDurationSeconds: 600,
    });

    await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Yes",
    });
    await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Very familiar.",
    });

    const nextTurn = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content:
        "I am concerned about how the clinical story fits, but I am not wrapping up.",
    });

    expect(nextTurn.currentQuestion).not.toContain("To close");
  });

  it("does not mark later PADCEV safety-lane questions as asked when CustomGPT mentions their topics", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      if (href.endsWith("/projects/97350/conversations") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              session_id: `padcev-session-${fetchMock.mock.calls.length}`,
            },
          }),
          { status: 200 },
        );
      }

      if (href.includes("/messages") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          prompt?: string;
        };
        const selectedQuestion =
          body.prompt?.match(
            /Selected next survey question to ask at the end of your message: ([^\n]+)/,
          )?.[1] ?? "Which safety details matter?";

        return new Response(
          JSON.stringify({
            data: {
              openai_response: [
                "PADCEV safety-management resources can include monitoring checklists, adverse-reaction management guides, dosing resources, and patient counseling materials when supported by the source.",
                "Would PADCEV monitoring checklists, adverse-reaction management guides, dosing resources, or patient counseling materials meaningfully reduce side-effect-management barriers for you?",
                selectedQuestion,
              ].join("\n\n"),
              citations: [],
            },
          }),
          { status: 200 },
        );
      }

      return new Response("Unexpected CustomGPT request", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      surveySlug: "padcev",
      surveyIntentSlug: "side-effect-management",
      targetDurationSeconds: 600,
    });

    const safetyTurn = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Yes",
    });

    expect(safetyTurn.currentQuestion).toContain(
      "Which safety or tolerability details",
    );
    expect(safetyTurn.askedQuestions).toContain(
      "Which safety or tolerability details most influence how comfortable you would be using or supporting PADCEV?",
    );
    expect(safetyTurn.askedQuestions).not.toContain(
      "Would PADCEV monitoring checklists, adverse-reaction management guides, dosing resources, or patient counseling materials meaningfully reduce side-effect-management barriers for you?",
    );

    const nextTurn = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Peripheral neuropathy and rash management are what I need help with.",
    });

    expect(nextTurn.currentQuestion).toContain(
      "When a PADCEV adverse event emerges",
    );
    expect(nextTurn.askedQuestions).not.toContain(
      "Would PADCEV monitoring checklists, adverse-reaction management guides, dosing resources, or patient counseling materials meaningfully reduce side-effect-management barriers for you?",
    );
  });

  it("allows explicit off-lane PADCEV excursions and then returns to the selected intent lane", async () => {
    env.CUSTOMGPT_API_KEY = "test-customgpt-key";

    const prompts: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      if (href.endsWith("/projects/97350/conversations") && method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              session_id: `padcev-session-${fetchMock.mock.calls.length}`,
            },
          }),
          { status: 200 },
        );
      }

      if (href.includes("/messages") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          prompt?: string;
        };
        const prompt = body.prompt ?? "";
        prompts.push(prompt);
        const selectedQuestion =
          prompt.match(
            /Selected next survey question to ask at the end of your message: ([^\n]+)/,
          )?.[1] ?? "Thanks, that gives us enough.";

        return new Response(
          JSON.stringify({
            data: {
              openai_response: selectedQuestion,
              citations: [],
            },
          }),
          { status: 200 },
        );
      }

      return new Response("Unexpected CustomGPT request", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const started = startMvpCustomGptSurvey({
      surveySlug: "padcev",
      surveyIntentSlug: "side-effect-management",
      targetDurationSeconds: 600,
    });

    const safetyTurn = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content: "Yes",
    });

    expect(safetyTurn.currentQuestion).toContain(
      "Which safety or tolerability details",
    );

    const excursionTurn = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content:
        "Before we go further, which patient populations are appropriate and where would you be cautious?",
    });

    expect(excursionTurn.currentQuestion).toContain(
      "For which locally advanced or metastatic urothelial cancer patient types",
    );
    expect(prompts.at(-1) ?? "").toContain(
      "explicit respondent-requested off-lane excursion",
    );
    expect(prompts.at(-1) ?? "").not.toContain(
      "Do not use or cite efficacy/PFS/OS pages",
    );

    const returnTurn = await submitMvpCustomGptSurveyTurn({
      sessionId: started.sessionId,
      content:
        "I would be cautious with baseline neuropathy but otherwise consider appropriate la/mUC patients.",
    });

    expect(returnTurn.currentQuestion).toContain(
      "When a PADCEV adverse event emerges",
    );
    expect(returnTurn.currentQuestion).not.toContain(
      "For which locally advanced or metastatic urothelial cancer patient types",
    );
  });
});
