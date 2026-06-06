import { resolve } from "node:path";
import { demoStudyDefinition } from "./demo-study";
import { OpenAIResponsesGateway, FileDebugTraceStore, replaySampleAnswerWithOpenAI } from "./openai-workflows";
import { compileStudy } from "./study-compiler";

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to run the OpenAI replay script.");
  }

  const compiledStudy = compileStudy(demoStudyDefinition);
  const debugDir = resolve(process.cwd(), process.env.OPENAI_DEBUG_DIR ?? ".debug/openai");
  const sampleAnswer =
    process.argv.slice(2).join(" ").trim() ||
    "We are a B2B SaaS company, and finance plus product marketing usually make pricing calls together.";

  const gateway = new OpenAIResponsesGateway(
    apiKey,
    {
      analysisModel: process.env.OPENAI_MODEL_ANALYSIS ?? "gpt-5.4-mini",
      decisionModel: process.env.OPENAI_MODEL_DECISION ?? "gpt-5.4-mini",
      phrasingModel: process.env.OPENAI_MODEL_PHRASING ?? "gpt-5.4-mini"
    },
    new FileDebugTraceStore(debugDir)
  );

  const result = await replaySampleAnswerWithOpenAI({
    compiledStudy,
    gateway,
    sampleAnswer
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
