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
    label: "/research/mvp-audit/",
    sourceParts: ["research", "mvp-audit.html"],
    targetParts: ["research", "mvp-audit"],
  },
  {
    label: "/research/source-library/",
    sourceParts: ["research", "source-library.html"],
    targetParts: ["research", "source-library"],
  },
];

for (const route of staticRoutes) {
  const htmlPath = path.join(
    nextOutput,
    "server",
    "app",
    ...route.sourceParts,
  );
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
fs.cpSync(path.join(nextOutput, "static"), path.join(target, "_next", "static"), {
  recursive: true,
});

for (const route of staticRoutes) {
  const htmlPath = path.join(
    nextOutput,
    "server",
    "app",
    ...route.sourceParts,
  );
  const routeDir = path.join(target, ...route.targetParts);
  fs.mkdirSync(routeDir, { recursive: true });
  fs.copyFileSync(htmlPath, path.join(routeDir, "index.html"));
}

fs.writeFileSync(
  path.join(target, "index.html"),
  '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=/mvp/customgpt-survey/"><title>PulseRx Survey</title><a href="/mvp/customgpt-survey/">Open survey</a>',
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
