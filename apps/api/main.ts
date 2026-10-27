import { resolve } from "node:path";
import { startStandaloneApi } from "./http-server";
import { getServerRuntime } from "./server/runtime";
const server = startStandaloneApi();
let closing = false;
const shutdown = (): void => {
  if (closing) return;
  closing = true;
  void server
    .shutdown()
    .then(() => getServerRuntime(resolve(process.cwd(), "apps/api")).close())
    .catch((error: unknown) => {
      console.error("Standalone API shutdown failed", error);
      process.exitCode = 1;
    });
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
