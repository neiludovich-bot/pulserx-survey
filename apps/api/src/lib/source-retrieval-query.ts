import { Prisma } from "@prisma/client";

const SEARCH_STOP_WORDS = new Set("a an and are as at be can could do does for from how i in is it me my of on or please show tell that the their there these this to us was we were what when where which with would you your about approved available clinical current describe describes described discuss discusses discussed document documented evidence explain explains explained information known list lists listed material materials mention mentions mentioned note notes noted question regarding report reports reported source sources support supports supported".split(" "));

// Search vocabulary only, not clinical facts or an inferred answer. Shared by
// every bot so ordinary shorthand can find the website's spelled-out wording.
const SEARCH_ALIASES: Record<string, string> = {
  ddi: "drug interactions", ddis: "drug interactions",
  ae: "adverse events reactions", aes: "adverse events reactions",
  se: "side effects adverse reactions safety", ses: "side effects adverse reactions safety",
  pfs: "progression free survival", rpfs: "radiographic progression free survival",
  os: "overall survival", mfs: "metastasis free survival",
};

export function sourceContentSearchTerms(query: string, surveySlug: string) {
  // Prefer a supplied expansion over its acronym. No clinical aliases or
  // facts are inferred here; the moderator supplies the resolved question.
  const expanded = query.replace(/\b[A-Z][A-Z0-9]{1,8}\s*\(([^)]+)\)/g, "$1").replace(/\([A-Z][A-Z0-9]{1,8}\)/g, "")
    .replace(/\bside[ -]effects?\b/gi, "side effects adverse reactions safety");
  const terms = expanded.toLowerCase().replace(/\b(ae|ddi|se)['’]s\b/g, "$1s").split(/[^a-z0-9]+/).filter(
    (term) => term.length >= 2 && term !== surveySlug && !SEARCH_STOP_WORDS.has(term),
  );
  // Preserve a follow-up at the end of a mixed reaction + question message.
  return [...new Set(terms.slice(-24).flatMap(term => (SEARCH_ALIASES[term] ?? term).split(" ")))];
}

/** Rank the approved content before applying the bounded candidate limit. */
export function sourceContentSearchSql(query: string, surveySlug: string, context?: string | null, websiteOnly = false) {
  const documentFilter = websiteOnly ? Prisma.sql`AND document.url NOT ILIKE '%.pdf%'` : Prisma.empty;
  const terms = sourceContentSearchTerms(query, surveySlug);
  const normalized = query.toLowerCase().replace(/-/g, " ");
  const phrases = [...new Set(Object.entries(SEARCH_ALIASES).filter(([alias, phrase]) => new RegExp(`\\b${alias}\\b`, "i").test(query) || normalized.includes(phrase)).flatMap(([, phrase]) => phrase === "side effects adverse reactions safety" ? ["side effects", "adverse reactions"] : phrase === "adverse events reactions" ? ["adverse events", "adverse reactions"] : phrase === "drug interactions" ? [phrase, "drug drug interactions"] : [phrase]))];
  const phrasePriority = phrases.length ? Prisma.sql`(to_tsvector('english', chunk.content) @@ websearch_to_tsquery('english', ${phrases.map(phrase => `"${phrase}"`).join(" OR ")})) DESC,` : Prisma.empty;
  const contextTerms = sourceContentSearchTerms(context ?? "", surveySlug).slice(0, 12);
  if (!terms.length && !contextTerms.length) return null;
  if (contextTerms.length) {
    return Prisma.sql`
      WITH search AS (
        SELECT websearch_to_tsquery('english', ${[...new Set([...terms, ...contextTerms])].join(" OR ")}) AS any_terms,
               websearch_to_tsquery('english', ${(terms.length ? terms : contextTerms).join(" OR ")}) AS current_terms,
               websearch_to_tsquery('english', ${contextTerms.join(" OR ")}) AS context_terms
      )
      SELECT chunk.id
      FROM source_chunks AS chunk
      JOIN source_documents AS document ON document.id = chunk.source_document_id
      CROSS JOIN search
      WHERE chunk.survey_slug = ${surveySlug}
        AND document.survey_slug = ${surveySlug}
        AND document.status = 'ACTIVE'
        ${documentFilter}
        AND to_tsvector('english', chunk.content) @@ search.any_terms
      ORDER BY (to_tsvector('english', chunk.content) @@ search.current_terms) DESC,
               ${websiteOnly ? Prisma.sql`ts_rank_cd(to_tsvector('english', regexp_replace(coalesce(document.url, ''), '[^a-zA-Z0-9]+', ' ', 'g')), search.current_terms) DESC,` : Prisma.empty}
               ${phrasePriority}
               ts_rank_cd(to_tsvector('english', chunk.content), search.current_terms) DESC,
               ts_rank_cd(to_tsvector('english', chunk.content), search.context_terms) DESC,
               document.priority DESC, chunk.position ASC, chunk.id ASC
      LIMIT 80
    `;
  }
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
      ${documentFilter}
      AND to_tsvector('english', chunk.content) @@ search.any_terms
    ORDER BY ${websiteOnly ? Prisma.sql`ts_rank_cd(to_tsvector('english', regexp_replace(coalesce(document.url, ''), '[^a-zA-Z0-9]+', ' ', 'g')), search.any_terms) DESC,` : Prisma.empty}
             ${phrasePriority} (to_tsvector('english', chunk.content) @@ search.all_terms) DESC,
             ts_rank_cd(to_tsvector('english', chunk.content), search.any_terms) DESC,
             document.priority DESC, chunk.position ASC, chunk.id ASC
    LIMIT 80
  `;
}
