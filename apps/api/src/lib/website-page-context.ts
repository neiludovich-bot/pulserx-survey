/** A source-owned, contiguous page window, preserving complete paragraphs and
 * their qualifications. Search chunks locate pages; they are not the only text
 * that may support the page's figures. No generated medical text is added. */
export function websitePageContext(content: string, matchedText: string, broad: boolean, query = "") {
  const blocks = [...content.matchAll(/\S[\s\S]*?(?=\n\s*\n|$)/g)]
    .map(match => ({ text: match[0].trimEnd(), start: match.index!, end: match.index! + match[0].trimEnd().length }));
  if (!blocks.length) return null;
  // Indexed chunks may have a repeated document title before their passage.
  const anchors = matchedText.split(/\n\s*\n/).filter(text => text.length > 40);
  // Acronym definitions in a footer can outrank the actual results in search.
  // Anchor explicit endpoint requests to the first substantive endpoint passage,
  // accepting the website's median/radiographic prefixes and Unicode hyphens.
  // This chooses source text only; it does not rewrite the participant's intent.
  const endpoints = [
    /\b(?:pfs|psf|mpfs|rpfs)\b|progression[\s\p{Pd}]*free\s+survival/iu,
    /\b(?:os|mos)\b|overall\s+survival/iu,
    /\b(?:mfs|mmfs)\b|metastasis[\s\p{Pd}]*free\s+survival/iu,
    /\borr\b|(?:objective|overall)\s+response\s+rate/iu,
  ].filter(pattern => pattern.test(query));
  const endpointBlock = endpoints.length ? blocks.find(block =>
    (block.text.match(/\b[\w()-]{2,12}=/g)?.length ?? 0) < 3 &&
    !/\bet al\b|^references\s*:/i.test(block.text) && endpoints.some(pattern => pattern.test(block.text))
  ) : undefined;
  const anchor = broad ? 0 : endpointBlock?.start ?? anchors.map(text => content.indexOf(text)).find(index => index >= 0) ?? 0;
  const first = broad ? 0 : Math.max(0, blocks.findIndex(block => block.end >= Math.max(0, anchor - 1800)));
  let last = first;
  while (last + 1 < blocks.length && blocks[last + 1].end - blocks[first].start <= 6500) last++;
  if (blocks[last].end - blocks[first].start > 11000) return null;
  const start = blocks[first].start; const end = blocks[last].end;
  return { start, end, text: content.slice(start, end) };
}
