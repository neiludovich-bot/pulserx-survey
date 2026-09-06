import { readFile } from "node:fs/promises";
import { prepareWebsiteIndex } from "../apps/api/src/lib/website-index-service";
for (const path of process.argv.slice(2)) {
  const { snapshot, pages } = prepareWebsiteIndex(JSON.parse(await readFile(path, "utf8")));
  console.log(JSON.stringify({ bot: snapshot.surveySlug, pages: pages.length, chunks: pages.reduce((n, p) => n + p.chunks.length, 0), assets: pages.reduce((n, p) => n + p.assets.length, 0), issues: snapshot.issues, truncated: snapshot.truncated }));
}
