import { log } from "./util/log.js";
import { db } from "./store/db.js";
import { startSocket, setMessageHandler } from "./whatsapp/socket.js";
import { handleMessage } from "./whatsapp/router.js";
import { scheduleAllGroups } from "./scheduler/cron.js";
import { startTick } from "./scheduler/tick.js";

async function main(): Promise<void> {
  log.info("AINewsBot starting…");

  // Initialize lowdb up-front so the file exists before anything reads it.
  await db();

  // Wire WhatsApp message handler before connecting.
  setMessageHandler((m) => void handleMessage(m));
  await startSocket();

  // Schedule per-group digest crons + the reminder tick loop.
  await scheduleAllGroups();
  startTick();

  log.info("AINewsBot ready.");
}

main().catch((err) => {
  log.error({ err: String(err) }, "fatal");
  process.exit(1);
});

// Graceful shutdown — let PM2 restart cleanly.
process.on("SIGINT", () => {
  log.info("SIGINT — exiting");
  process.exit(0);
});
process.on("SIGTERM", () => {
  log.info("SIGTERM — exiting");
  process.exit(0);
});
process.on("unhandledRejection", (err) => {
  log.error({ err: String(err) }, "unhandledRejection");
});
