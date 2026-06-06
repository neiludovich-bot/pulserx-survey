import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  localEnvironmentConfigResponseSchema,
  type UpdateLocalEnvironmentConfig,
} from "@interview/schemas";
import { env, reloadEnvFromProcess } from "../env";
import { resetOpenAIGateway } from "./model-gateway";

type EnvUpdates = Record<string, string>;

const EDITABLE_ENV_KEYS = [
  "OPENAI_API_KEY",
  "CUSTOMGPT_API_KEY",
  "CUSTOMGPT_PROJECT_ID",
  "CUSTOMGPT_API_BASE_URL",
  "OPENAI_MODEL_REALTIME",
  "OPENAI_MODEL_TRANSCRIPTION",
  "OPENAI_MODEL_TTS",
] as const;

function findWorkspaceRoot(startDir = process.cwd()) {
  let currentDir = resolve(startDir);

  while (true) {
    if (existsSync(resolve(currentDir, "pnpm-workspace.yaml"))) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return resolve(startDir);
    }

    currentDir = parentDir;
  }
}

export function resolveLocalEnvPath(startDir = process.cwd()) {
  return resolve(findWorkspaceRoot(startDir), ".env");
}

function getEnvPath() {
  return resolveLocalEnvPath();
}

function localEnvEditingEnabled() {
  return env.NODE_ENV !== "production";
}

function maskSecret(value: string | undefined) {
  if (!value) {
    return null;
  }

  const visible = value.slice(-4);
  return `configured (...${visible})`;
}

function encodeEnvValue(value: string) {
  if (!/[\s#"']/u.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function splitLinesPreservingNewline(value: string) {
  const hasTrailingNewline = /\r?\n$/u.test(value);
  const lines = value.replace(/\r\n/gu, "\n").split("\n");

  if (hasTrailingNewline) {
    lines.pop();
  }

  return { lines, hasTrailingNewline };
}

function mergeEnvFile(currentFile: string, updates: EnvUpdates) {
  const { lines, hasTrailingNewline } = splitLinesPreservingNewline(currentFile);
  const remaining = new Map(Object.entries(updates));
  const nextLines = lines.map((line) => {
    const match = line.match(/^(\s*)([A-Z0-9_]+)(\s*=\s*)(.*)$/u);
    if (!match) {
      return line;
    }

    const [, leading = "", key, separator = "="] = match;
    if (!key || !remaining.has(key)) {
      return line;
    }

    const value = remaining.get(key);
    remaining.delete(key);
    return `${leading}${key}${separator}${encodeEnvValue(value ?? "")}`;
  });

  for (const [key, value] of remaining.entries()) {
    nextLines.push(`${key}=${encodeEnvValue(value)}`);
  }

  return `${nextLines.join("\n")}${hasTrailingNewline ? "\n" : ""}`;
}

function buildEnvUpdates(input: UpdateLocalEnvironmentConfig) {
  const updates: EnvUpdates = {};

  const setIfPresent = (
    key: (typeof EDITABLE_ENV_KEYS)[number],
    value: string | undefined,
  ) => {
    const trimmed = value?.trim();
    if (trimmed) {
      updates[key] = trimmed;
    }
  };

  setIfPresent("OPENAI_API_KEY", input.openaiApiKey);
  setIfPresent("CUSTOMGPT_API_KEY", input.customGptApiKey);
  setIfPresent("CUSTOMGPT_PROJECT_ID", input.customGptProjectId);
  setIfPresent("CUSTOMGPT_API_BASE_URL", input.customGptApiBaseUrl);
  setIfPresent("OPENAI_MODEL_REALTIME", input.openaiRealtimeModel);
  setIfPresent("OPENAI_MODEL_TRANSCRIPTION", input.openaiTranscriptionModel);
  setIfPresent("OPENAI_MODEL_TTS", input.openaiTtsModel);

  return updates;
}

function applyRuntimeUpdates(updates: EnvUpdates) {
  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value;
  }

  reloadEnvFromProcess();
  resetOpenAIGateway();
}

export function getLocalEnvironmentConfig() {
  const enabled = localEnvEditingEnabled();

  return localEnvironmentConfigResponseSchema.parse({
    enabled,
    reason: enabled
      ? null
      : "Local environment editing is disabled in production.",
    envPath: getEnvPath(),
    openaiApiKey: {
      configured: Boolean(env.OPENAI_API_KEY),
      masked: maskSecret(env.OPENAI_API_KEY),
    },
    customGptApiKey: {
      configured: Boolean(env.CUSTOMGPT_API_KEY),
      masked: maskSecret(env.CUSTOMGPT_API_KEY),
    },
    customGptProjectId: env.CUSTOMGPT_PROJECT_ID ?? null,
    customGptApiBaseUrl: env.CUSTOMGPT_API_BASE_URL,
    openaiRealtimeModel: env.OPENAI_MODEL_REALTIME,
    openaiTranscriptionModel: env.OPENAI_MODEL_TRANSCRIPTION,
    openaiTtsModel: env.OPENAI_MODEL_TTS,
  });
}

export async function updateLocalEnvironmentConfig(
  input: UpdateLocalEnvironmentConfig,
) {
  if (!localEnvEditingEnabled()) {
    throw new Error("Local environment editing is disabled in production.");
  }

  const updates = buildEnvUpdates(input);
  if (Object.keys(updates).length === 0) {
    return getLocalEnvironmentConfig();
  }

  const envPath = getEnvPath();
  let currentFile = "";
  try {
    currentFile = await readFile(envPath, "utf8");
  } catch {
    currentFile = "";
  }

  await writeFile(envPath, mergeEnvFile(currentFile, updates), "utf8");
  applyRuntimeUpdates(updates);

  return getLocalEnvironmentConfig();
}
