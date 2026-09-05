import { resolve } from "node:path";
import {
  FileDebugTraceStore,
  OpenAIResponsesGateway
} from "@interview/engine";
import { env } from "../env";

let gateway: OpenAIResponsesGateway | null | undefined;

export function resetOpenAIGateway() {
  gateway = undefined;
}

export function getOptionalOpenAIGateway() {
  if (gateway !== undefined) {
    return gateway;
  }

  if (!env.OPENAI_API_KEY) {
    gateway = null;
    return gateway;
  }

  gateway = new OpenAIResponsesGateway(
    env.OPENAI_API_KEY,
    {
      analysisModel: env.OPENAI_MODEL_ANALYSIS,
      decisionModel: env.OPENAI_MODEL_DECISION,
      phrasingModel: env.OPENAI_MODEL_PHRASING,
      sourceModel: env.OPENAI_MODEL_SOURCE
    },
    new FileDebugTraceStore(resolve(process.cwd(), env.OPENAI_DEBUG_DIR))
  );

  return gateway;
}
