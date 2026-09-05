const sentenceSegmenter = new Intl.Segmenter("en", { granularity: "sentence" });
const citationPattern = /\[\d{1,3}(?:\s*[-,\u2013\u2014]\s*\d{1,3})*\]/g;

function sourceSentences(paragraph: string) {
  const citations = Array.from(paragraph.matchAll(citationPattern), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  const sentences: string[] = [];
  let start = 0;

  for (const segment of sentenceSegmenter.segment(paragraph)) {
    let end = segment.index + segment.segment.length;
    // ICU can split "claim.[1] Question?" inside the citation. Keep a trailing
    // citation (including one separated by spaces) with its preceding claim.
    for (const citation of citations) {
      if (citation.end <= end) continue;
      if (citation.start <= end || /^[ \t]*$/.test(paragraph.slice(end, citation.start))) {
        end = citation.end;
      } else {
        break;
      }
    }
    // Keep an immediately adjacent closing emphasis marker with its opener,
    // rather than assigning it to the following question's segment.
    for (const marker of ["**", "__", "~~", "*", "_", "`"] as const) {
      if (
        paragraph.startsWith(marker, end) &&
        (paragraph.slice(start, end).split(marker).length - 1) % 2 === 1
      ) {
        end += marker.length;
        break;
      }
    }
    if (end <= start) continue;
    const sentence = paragraph.slice(start, end).trim();
    start = end;
    if (!sentence) continue;
    // Closing Markdown emphasis can be a separate ICU segment. Reattach it
    // before deciding whether to retain the preceding sentence.
    if (/^[*_~`]+$/.test(sentence) && sentences.length > 0) {
      sentences[sentences.length - 1] += sentence;
    } else {
      sentences.push(sentence);
    }
  }
  return sentences;
}

/** Remove provider-authored questions without truncating source evidence. */
export function stripQuestionSentences(answer: string) {
  return answer
    .split(/\n{2,}/)
    .map((paragraph) => {
      // Preserve complete source sentences, including decimal evidence and
      // abbreviations. A punctuation-excluding match dropped "70.3% versus
      // 52.1%" down to "1%"; splitting on every period also strands fragments
      // of questions such as "How does the U.S. guidance apply?".
      return sourceSentences(paragraph)
        .filter(
          (sentence) => !/\?(?:[\s"'\u201d\u2019)\]*_~`]|\[\d{1,3}(?:\s*[-,\u2013\u2014]\s*\d{1,3})*\])*$/.test(sentence),
        )
        .join(" ")
        .trim();
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
