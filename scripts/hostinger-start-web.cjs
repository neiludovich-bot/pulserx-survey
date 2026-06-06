const { spawn } = require("child_process");
const path = require("path");

const root = process.cwd();
const webCwd = path.join(root, "apps", "web");
const port = process.env.PORT || "3000";

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(
  command,
  ["next", "start", "--hostname", "0.0.0.0", "--port", port],
  {
    cwd: webCwd,
    env: process.env,
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
