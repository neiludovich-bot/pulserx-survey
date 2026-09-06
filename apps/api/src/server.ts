import { buildApp } from "./app";
import { env } from "./env";

import { startWebsiteRefreshWorker } from "./lib/website-refresh-service";

const app = buildApp();
let stopRefresh: (() => void) | undefined;
app.addHook("onClose", async () => stopRefresh?.());

async function start() {
  try {
    await app.listen({
      host: env.HOST,
      port: env.PORT
    });
    stopRefresh = startWebsiteRefreshWorker(error => app.log.error(error));
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void start();
