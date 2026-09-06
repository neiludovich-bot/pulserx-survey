import { z } from "zod";
import { moderatorEvidenceSelectionInputSchema, moderatorEvidenceSelectionModelResultSchema, moderatorContextualEvidenceSelectionModelResultSchema } from "./moderator";

export const sourceEvidenceSpanRangeSchema = z.object({
  startSpan: z.number().int().min(0).max(11999),
  endSpan: z.number().int().min(0).max(11999),
}).strict();
export const sourceEvidenceSpansInputSchema = moderatorEvidenceSelectionInputSchema.extend({
  candidates: z.array(moderatorEvidenceSelectionInputSchema.shape.candidates.element.omit({ text: true }).extend({
    spans: z.array(z.object({ index: z.number().int().min(0).max(11999), text: z.string().min(1).max(12000) }).strict()).max(12000),
  }).strict()).max(24),
}).strict();
const spanSelection = moderatorEvidenceSelectionModelResultSchema.shape.selections.element.omit({ supportExcerpt: true }).extend({ supportSpanRange: sourceEvidenceSpanRangeSchema }).strict();
const contextualSpanSelection = moderatorContextualEvidenceSelectionModelResultSchema.shape.selections.element.omit({ supportExcerpt: true }).extend({ supportSpanRange: sourceEvidenceSpanRangeSchema }).strict();
export const sourceEvidenceSpanSelectionModelResultSchema = moderatorEvidenceSelectionModelResultSchema.extend({ selections: z.array(spanSelection).max(3) }).strict();
export const contextualSourceEvidenceSpanSelectionModelResultSchema = moderatorContextualEvidenceSelectionModelResultSchema.extend({ selections: z.array(contextualSpanSelection).max(3) }).strict();
export type SourceEvidenceSpanSelectionModelResult = z.infer<typeof sourceEvidenceSpanSelectionModelResultSchema>;
export type SourceEvidenceSpanRange = z.infer<typeof sourceEvidenceSpanRangeSchema>;

// Source selection and a concise explanation share one response boundary.
// Citations are attached by the application from these owned source IDs.
export const websiteAnswerModelResultSchema = sourceEvidenceSpanSelectionModelResultSchema.extend({
  version: z.literal(1),
  paragraphs: z.array(z.object({
    text: z.string().trim().min(1).max(1400),
    sourceIds: z.array(z.string().min(1)).min(1).max(3),
  }).strict()).max(3),
  unavailableReason: z.enum(["not_in_sources", "ambiguous_request"]).nullable(),
}).strict();
export type WebsiteAnswerModelResult = z.infer<typeof websiteAnswerModelResultSchema>;
export const websiteAnswerInputSchema = sourceEvidenceSpansInputSchema.extend({
  repairFeedback: z.enum(["invalid_output", "unsupported_number", "too_verbose"]).nullable(),
}).strict();
