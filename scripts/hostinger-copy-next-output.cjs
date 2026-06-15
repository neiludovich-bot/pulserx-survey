const fs = require("fs");
const path = require("path");

const root = process.cwd();
const nextOutput = path.join(root, "apps", "web", ".next");
const publicDir = path.join(root, "apps", "web", "public");
const target = path.join(root, ".next");

if (!fs.existsSync(nextOutput)) {
  throw new Error(`Next build output not found at ${nextOutput}`);
}

const staticRoutes = [
  {
    label: "/mvp/customgpt-survey/",
    sourceParts: ["mvp", "customgpt-survey.html"],
    targetParts: ["mvp", "customgpt-survey"],
  },
  {
    label: "/surveys/padcev/",
    sourceParts: ["surveys", "padcev.html"],
    targetParts: ["surveys", "padcev"],
  },
  {
    label: "/surveys/brukinsa/",
    sourceParts: ["surveys", "brukinsa.html"],
    targetParts: ["surveys", "brukinsa"],
  },
  {
    label: "/surveys/data/",
    sourceParts: ["surveys", "data.html"],
    targetParts: ["surveys", "data"],
  },
  {
    label: "/admin/",
    sourceParts: ["admin.html"],
    targetParts: ["admin"],
  },
  {
    label: "/admin/import/",
    sourceParts: ["admin", "import.html"],
    targetParts: ["admin", "import"],
  },
  {
    label: "/admin/source-library/",
    sourceParts: ["admin", "source-library.html"],
    targetParts: ["admin", "source-library"],
  },
  {
    label: "/admin/surveys/data/",
    sourceParts: ["admin", "surveys", "data.html"],
    targetParts: ["admin", "surveys", "data"],
  },
  {
    label: "/admin/surveys/padcev/",
    sourceParts: ["admin", "surveys", "padcev.html"],
    targetParts: ["admin", "surveys", "padcev"],
  },
  {
    label: "/admin/surveys/brukinsa/",
    sourceParts: ["admin", "surveys", "brukinsa.html"],
    targetParts: ["admin", "surveys", "brukinsa"],
  },
  {
    label: "/research/import/",
    sourceParts: ["research", "import.html"],
    targetParts: ["research", "import"],
  },
  {
    label: "/research/mvp-audit/",
    sourceParts: ["research", "mvp-audit.html"],
    targetParts: ["research", "mvp-audit"],
  },
];

for (const route of staticRoutes) {
  const htmlPath = path.join(nextOutput, "server", "app", ...route.sourceParts);
  if (!fs.existsSync(htmlPath)) {
    throw new Error(`Static page ${route.label} not found at ${htmlPath}`);
  }
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

if (fs.existsSync(publicDir)) {
  fs.cpSync(publicDir, target, { recursive: true });
}

fs.mkdirSync(path.join(target, "_next"), { recursive: true });
fs.cpSync(
  path.join(nextOutput, "static"),
  path.join(target, "_next", "static"),
  {
    recursive: true,
  },
);

for (const route of staticRoutes) {
  const htmlPath = path.join(nextOutput, "server", "app", ...route.sourceParts);
  const routeDir = path.join(target, ...route.targetParts);
  fs.mkdirSync(routeDir, { recursive: true });
  fs.copyFileSync(htmlPath, path.join(routeDir, "index.html"));
}

fs.writeFileSync(
  path.join(target, "index.html"),
  '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=/mvp/customgpt-survey/"><title>PulseRx Survey</title><a href="/mvp/customgpt-survey/">Open survey</a>',
);

fs.mkdirSync(path.join(target, "research"), { recursive: true });
fs.writeFileSync(
  path.join(target, "research", "index.html"),
  `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PulseRx Research</title>
<style>
  body{margin:0;background:#edf3f2;color:#071716;font:16px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  main{max-width:760px;margin:10vh auto;padding:40px;background:#fff;border:1px solid #dbe4e2;border-radius:8px;box-shadow:0 24px 80px rgba(10,32,30,.12)}
  p{color:#52615f} a{display:inline-block;margin:8px 8px 0 0;padding:11px 16px;border:1px solid #cfdad8;border-radius:999px;color:#124d45;text-decoration:none;font-weight:700}
  a.primary{background:#124d45;color:#fff;border-color:#124d45}
</style>
<main>
  <p style="text-transform:uppercase;letter-spacing:.08em;font-size:12px;font-weight:800;color:#52615f">Researcher Console</p>
  <h1>PulseRx Survey Admin</h1>
  <p>The secure backend now lives at /admin. Use it to manage survey guides, sources, assets, and launch status.</p>
  <a class="primary" href="/admin/">Open Admin Console</a>
  <a href="/admin/import/">Import / Update Survey</a>
  <a href="/admin/source-library/">Source Library</a>
  <a href="/surveys/data/">Open Data Survey</a>
  <a href="/surveys/padcev/">Open PADCEV Survey</a>
  <a href="/surveys/brukinsa/">Open BRUKINSA Survey</a>
</main>`,
);

fs.writeFileSync(
  path.join(target, ".htaccess"),
  "DirectoryIndex index.html\nOptions -Indexes\n",
);

console.log(
  `Prepared static Hostinger output at ${path.relative(root, target)} with ${staticRoutes
    .map((route) => route.label)
    .join(", ")}.`,
);
