import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const command = process.argv[2];
if (!["dev", "build"].includes(command)) throw new Error("Expected dev or build.");
// Never load the repository's server .env into the frontend build process.
const child = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", ...(command === "build" ? ["build"] : ["--host", "127.0.0.1"])],
  {
    cwd: fileURLToPath(new URL("../apps/vue/", import.meta.url)),
    env: { ...process.env, VITE_APP_BASE: process.env.VITE_APP_BASE ?? "/" },
    stdio: "inherit",
    windowsHide: true,
  },
);
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
process.once("SIGINT", () => child.kill("SIGTERM"));
process.once("SIGTERM", () => child.kill("SIGTERM"));
