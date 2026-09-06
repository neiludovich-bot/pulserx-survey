import { readFile } from "node:fs/promises";
const snapshot = JSON.parse(await readFile(process.argv[2], "utf8"));
for (const issue of snapshot.issues.filter((i: { reason: string }) => i.reason.includes("Redirect"))) {
  const result = await fetch(issue.url, { redirect: "manual", signal: AbortSignal.timeout(15000) });
  console.log(JSON.stringify({ url: issue.url, status: result.status, location: result.headers.get("location") }));
}
