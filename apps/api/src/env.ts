import { z } from "zod";

const apiEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z
    .string()
    .url()
    .default(
      process.env.NODE_ENV === "production"
        ? "https://pulserx.ai"
        : "http://localhost:3000",
    ),
  DATABASE_URL: z
    .string()
    .min(1)
    .default(
      "postgresql://postgres:postgres@localhost:5432/interview_agent?schema=public",
    ),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL_ANALYSIS: z.string().default("gpt-5.4-mini"),
  OPENAI_MODEL_DECISION: z.string().default("gpt-5.4-mini"),
  OPENAI_MODEL_PHRASING: z.string().default("gpt-5.4-mini"),
  OPENAI_MODEL_SOURCE: z.string().default("gpt-5.4"),
  OPENAI_REASONING_EFFORT: z.enum(["none", "low", "medium", "high"]).default("low"),
  OPENAI_REASONING_EFFORT_GROUNDING: z.enum(["none", "low", "medium", "high"]).default("medium"),
  OPENAI_REASONING_EFFORT_INTERPRETATION: z.enum(["none", "low", "medium", "high"]).default("medium"),
  OPENAI_REASONING_EFFORT_MODERATOR: z.enum(["none", "low", "medium", "high"]).default("medium"),
  OPENAI_REASONING_EFFORT_COMPOSITION: z.enum(["none", "low", "medium", "high"]).default("low"),
  OPENAI_MODEL_TRANSCRIPTION: z.string().default("gpt-4o-transcribe"),
  OPENAI_MODEL_TTS: z.string().default("gpt-4o-mini-tts"),
  OPENAI_TTS_SPEED: z.coerce.number().min(0.25).max(4).default(1.2),
  OPENAI_MODEL_REALTIME: z.string().default("gpt-realtime"),
  VOICE_LANGUAGE: z.string().min(2).default("en"),
  OPENAI_DEBUG_DIR: z.string().default(".debug/openai"),
  CUSTOMGPT_API_KEY: z.string().optional(),
  CUSTOMGPT_API_BASE_URL: z
    .string()
    .url()
    .default("https://app.customgpt.ai/api/v1"),
  CUSTOMGPT_PROJECT_ID: z.string().optional(),
  CUSTOMGPT_PADCEV_PROJECT_ID: z.string().optional(),
  CUSTOMGPT_NUBEQA_PROJECT_ID: z.string().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ADMIN_SESSION_SECRET: z.string().min(16).optional(),
  MVP_SOURCE_PROVIDER: z
    .enum(["customgpt", "controlled_rag", "shadow"])
    .default("customgpt"),
  MVP_TURN_ROUTER_PROVIDER: z
    .enum(["deterministic", "openai_hybrid"])
    .default("openai_hybrid"),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function parseApiEnvFromProcess() {
  return apiEnvSchema.parse(process.env);
}

export const env: ApiEnv = parseApiEnvFromProcess();

export function reloadEnvFromProcess() {
  const nextEnv = parseApiEnvFromProcess();

  for (const key of Object.keys(env) as Array<keyof ApiEnv>) {
    if (!(key in nextEnv)) {
      delete (env as Record<string, unknown>)[key];
    }
  }

  Object.assign(env, nextEnv);
  return env;
}
