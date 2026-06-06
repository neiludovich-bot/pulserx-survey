const fs = require("fs");
const path = require("path");

const root = process.cwd();
const source = path.join(root, "apps", "web", ".next");
const target = path.join(root, ".next");

if (!fs.existsSync(source)) {
  throw new Error(`Next build output not found at ${source}`);
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });
console.log(`Copied ${path.relative(root, source)} to ${path.relative(root, target)} for Hostinger.`);
