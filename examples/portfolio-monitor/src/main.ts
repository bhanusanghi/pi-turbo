import { readConfig } from "./config.js";
import { createApplication } from "./application.js";

const config = readConfig();
// Do not log arbitrary provider/connection errors: they may contain credentials or request payloads.
const onError = (error: unknown) => console.error(JSON.stringify({ level: "error", event: "background_operation_failed", type: error instanceof Error ? error.name : "Error" }));
const application = createApplication(config, { onError, logger: true });
process.once("SIGINT", () => { void application.close().catch(onError); });
process.once("SIGTERM", () => { void application.close().catch(onError); });
try {
  await application.start();
} catch (error) {
  onError(error);
  process.exitCode = 1;
}
