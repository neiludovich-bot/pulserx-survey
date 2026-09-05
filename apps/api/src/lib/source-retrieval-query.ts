import { Prisma } from "@prisma/client";

const SEARCH_STOP_WORDS = new Set("a an and are as at be can could do does for from how i in is it me my of on or please show tell that the their there these this to us was we were what when where which with would you your about approved available clinical current describe discuss documented evidence explain information known material materials question regarding source sources support supports supported".split(" "));

export function sourceContentSearchTerms(query: string, surveySlug: string) {
  // Prefer a supplied expansion over its acronym. No clinical aliases or
  // facts are inferred here; the moderator supplies the resolved question.
  const expanded = query.replace(/\b[A-Z][A-Z0-9]{1,8}\s*\(([^)]+)\)/g, "$1").replace(/\([A-Z][A-Z0-9]{1,8}\)/g, "");
  return [...new Set(expanded.toLowerCase().split(/[^a-z0-9]+/).filter(
    (term) => term.length >= 2 && term !== surveySlug && !SEARCH_STOP_WORDS.has(term),
  ))].slice(0, 16);
}

/** Rank the approved content before applying the bounded candidate limit. */
export function sourceContentSearchSql(query: string, surveySlug: string) {
  const terms = sourceContentSearchTerms(query, surveySlug);
  if (!terms.length) return null;
  return Prisma.sql`
    WITH search AS (
      SELECT websearch_to_tsquery('english', ${terms.join(" OR ")}) AS any_terms,
             websearch_to_tsquery('english', ${terms.join(" ")}) AS all_terms
    )
    SELECT chunk.id
    FROM source_chunks AS chunk
    JOIN source_documents AS document ON document.id = chunk.source_document_id
    CROSS JOIN search
    WHERE chunk.survey_slug = ${surveySlug}
      AND document.survey_slug = ${surveySlug}
      AND document.status = 'ACTIVE'
      AND to_tsvector('english', chunk.content) @@ search.any_terms
    ORDER BY (to_tsvector('english', chunk.content) @@ search.all_terms) DESC,
             ts_rank_cd(to_tsvector('english', chunk.content), search.any_terms) DESC,
             document.priority DESC, chunk.position ASC, chunk.id ASC
    LIMIT 80
  `;
}
