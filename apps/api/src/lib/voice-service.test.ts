import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../env";
import { transcribeAudio } from "./voice-service";

const originalOpenAiApiKey = env.OPENAI_API_KEY;

afterEach(() => {
  env.OPENAI_API_KEY = originalOpenAiApiKey;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("voice service", () => {
  it("rejects non-English transcription hallucinations", async () => {
    env.OPENAI_API_KEY = "test-openai-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            text: "你好。",
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      transcribeAudio({
        audioBuffer: Buffer.from("audio-bytes"),
        mimeType: "audio/webm",
      }),
    ).rejects.toThrow("non-English or unclear speech");
  });
});
