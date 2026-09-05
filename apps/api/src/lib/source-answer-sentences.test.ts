import { describe, expect, it } from "vitest";
import { stripQuestionSentences } from "./source-answer-sentences";

describe("source answer sentence cleanup", () => {
  it.each([
    ["The rate was 70.3%.[1] What do you think?", "The rate was 70.3%.[1]"],
    ["The rate was 70.3%. [1] What do you think?", "The rate was 70.3%. [1]"],
    ["The rate was 70.3%.[1][2] What do you think?", "The rate was 70.3%.[1][2]"],
    ["The rate was 70.3%. **What do you think?**", "The rate was 70.3%."],
    ["The rate was 70.3%.[1] **What do you think?**", "The rate was 70.3%.[1]"],
    ["**The rate was 70.3%.** What do you think?", "**The rate was 70.3%.**"],
    ["The rate was 70.3%. What do you think?[2]", "The rate was 70.3%."],
    ["The rate was 70.3%. How does the U.S. guidance apply?", "The rate was 70.3%."],
  ])("retains complete claims for %s", (answer, expected) => {
    expect(stripQuestionSentences(answer)).toBe(expected);
  });
});
