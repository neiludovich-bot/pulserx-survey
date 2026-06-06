const fs = require("fs");
const path = require("path");

const root = process.cwd();
const nextOutput = path.join(root, "apps", "web", ".next");
const publicDir = path.join(root, "apps", "web", "public");
const target = path.join(root, ".next");

if (!fs.existsSync(nextOutput)) {
  throw new Error(`Next build output not found at ${nextOutput}`);
}

const mvpHtml = path.join(
  nextOutput,
  "server",
  "app",
  "mvp",
  "customgpt-survey.html",
);

if (!fs.existsSync(mvpHtml)) {
  throw new Error(`Static MVP page not found at ${mvpHtml}`);
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

const mvpDir = path.join(target, "mvp", "customgpt-survey");
fs.mkdirSync(mvpDir, { recursive: true });
fs.copyFileSync(mvpHtml, path.join(mvpDir, "index.html"));

fs.writeFileSync(
  path.join(target, "index.html"),
  '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=/mvp/customgpt-survey/"><title>PulseRx Survey</title><a href="/mvp/customgpt-survey/">Open survey</a>',
);

fs.writeFileSync(
  path.join(target, ".htaccess"),
  "DirectoryIndex index.html\nOptions -Indexes\n",
);

console.log(
  `Prepared static Hostinger output at ${path.relative(root, target)} with /mvp/customgpt-survey/.`,
);
