import { readFile, writeFile } from "node:fs/promises";
import { websiteIndexSnapshotSchema } from "../packages/schemas/src/website-index";
import { extractWebsiteTables } from "./extract-website-tables";
import { download } from "./index-medical-website";

// Refresh only already indexed HTML pages containing tables. Retain original
// page evidence only if every table text cell still occurs in that snapshot.
const [input, output] = process.argv.slice(2);
const snapshot=websiteIndexSnapshotSchema.parse(JSON.parse(await readFile(input,"utf8")));
const pages=[];
for (const page of snapshot.pages.filter(p=>p.sourceType==="URL")) {
  const response=await download(snapshot.surveySlug, page.url);
  if (!/html/i.test(response.type) || response.url !== page.url) throw new Error(`Indexed page location or type changed: ${page.url}`);
  const tables=extractWebsiteTables(response.bytes.toString("utf8"));
  if (!tables.length) continue;
  const normalize=(s:string)=>s.replace(/\s+/g," ").trim();
  const content=normalize(page.content);
  if (tables.some(t=>t.rows.flat().some(c=>c.text && !content.includes(normalize(c.text))))) throw new Error(`Website table has changed since index: ${page.url}; refresh full page before import`);
  pages.push({...page,tables});
  console.log(`${page.url}: ${tables.length} tables`);
}
if (!pages.length) throw new Error("No indexed website tables found");
await writeFile(output,JSON.stringify(websiteIndexSnapshotSchema.parse({...snapshot,fetchedAt:new Date().toISOString(),pages}),null,2));
