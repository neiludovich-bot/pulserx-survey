import { AsyncLocalStorage } from "node:async_hooks";

type ModelCallTimingContext = Readonly<{ callGroupId: string }>;
const timingContext = new AsyncLocalStorage<ModelCallTimingContext | null>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Callers generate a fresh technical UUID per request, never a session ID. */
export function withModelCallTimingContext<T>(context: ModelCallTimingContext, callback: () => T): T {
  const safe = uuid.test(context.callGroupId) ? Object.freeze({ callGroupId: context.callGroupId }) : null;
  return timingContext.run(safe, callback);
}

export function getModelCallTimingContext(): ModelCallTimingContext | null {
  return timingContext.getStore() ?? null;
}
