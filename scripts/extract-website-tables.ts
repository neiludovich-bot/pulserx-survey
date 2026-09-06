import { load } from "cheerio";
import type { AnyNode } from "domhandler";
import { websiteTableSchema, type WebsiteTable } from "../packages/schemas/src/website-index";
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Preserve source cells and spans, never reconstruct values from flattened text. */
export function extractWebsiteTables(html: string) {
  const $ = load(html);
  $("script,style,noscript,nav,header,footer,form,[role=dialog]").remove();
  const root = $("main").length ? $("main").first() : $("body");
  const result: WebsiteTable[] = [];
  let heading = clean(root.find("h1").first().text());
  let active: WebsiteTable | null = null;
  let headingLevel = 1;
  let activeLevel = 1;
  let activeScope: AnyNode | undefined;
  root.find("h2,h3,h4,h5,table,p,li").each((_index, el) => {
    const node = $(el);
    if (node.parents("table").length) return;
    if (active && activeScope && !node.parents().toArray().some(parent => parent === activeScope)) active = null;
    if (/^h[2-5]$/.test(el.tagName)) {
      heading = clean(node.text()); headingLevel = Number(el.tagName[1]);
      if (active && headingLevel > activeLevel) active.notes.push(heading); else active = null;
      return;
    }
    if (node.is("p,li")) {
      if (node.is("li") && node.find("p,li").length) return;
      const text = clean(node.text());
      if (active && text) active.notes.push(text);
      return;
    }
    const rows = node.find("tr").toArray().map(row => $(row).children("th,td").toArray().map(cell => ({
      text: clean($(cell).text()), header: cell.tagName === "th",
      rowSpan: Number($(cell).attr("rowspan") ?? 1), colSpan: Number($(cell).attr("colspan") ?? 1),
    }))).filter(row => row.length);
    const tableHeading = rows[0]?.length === 1 ? rows[0][0].text : "";
    const title = clean(node.find("caption").text()) || [heading, tableHeading && !heading.includes(tableHeading) ? tableHeading : ""].filter(Boolean).join(": ");
    const parsed = websiteTableSchema.safeParse({ title, rows, notes: [] });
    active = parsed.success && rows.some(row => row.some(cell => /\d/.test(cell.text))) ? parsed.data : null;
    if (active) {
      result.push(active); activeLevel = headingLevel;
      activeScope = node.parents().toArray().find(parent => $(parent).children("h1,h2,h3,h4,h5").length > 0 || $(parent).find("p").toArray().some(p => !$(p).parents("table").length));
    }
  });
  return result.slice(0, 24).map(table => websiteTableSchema.parse(table));
}
