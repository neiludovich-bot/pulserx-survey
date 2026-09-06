import { describe, expect, it } from "vitest";
import { conversationRuntimeForNewSession } from "./conversation-runtime-policy";

describe("new-session runtime rollout", () => {
  it.each(["nubeqa", "brukinsa", "padcev"])("uses the shared runtime for new production %s sessions", slug => {
    expect(conversationRuntimeForNewSession(slug, undefined, { NODE_ENV: "production" })).toBe("conversation_v2");
  });
  it("preserves an explicit rollback and opt-in evaluation", () => {
    expect(conversationRuntimeForNewSession("nubeqa", undefined, { NODE_ENV: "production", MVP_CONVERSATION_RUNTIME: "current" })).toBe("current");
    expect(conversationRuntimeForNewSession("nubeqa", "current", { NODE_ENV: "production" })).toBe("current");
    expect(conversationRuntimeForNewSession("nubeqa", "conversation_v2", { NODE_ENV: "test" })).toBe("conversation_v2");
  });
  it("keeps development and unrelated survey workflows on their existing runtime", () => {
    expect(conversationRuntimeForNewSession("nubeqa", undefined, { NODE_ENV: "development" })).toBe("current");
    expect(conversationRuntimeForNewSession("data", "conversation_v2", { NODE_ENV: "production" })).toBe("current");
  });
});
