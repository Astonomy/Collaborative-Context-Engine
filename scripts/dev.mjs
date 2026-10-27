import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const children = [];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
}
function launch(directory, args, env) {
  const child = spawn(process.execPath, args, {
    cwd: fileURLToPath(new URL(directory, root)),
    env: { ...process.env, ...env },
    stdio: "inherit",
    windowsHide: true,
  });
  children.push(child);
  child.once("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.once("exit", (code) => stop(code ?? 1));
}
launch("apps/vue/", ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"], {
  VITE_APP_BASE: "/vue/",
  CCE_API_PROXY_TARGET: `http://127.0.0.1:${process.env.PORT ?? "3000"}`,
});
launch(
  "apps/web/",
  [
    "--import",
    "../../scripts/load-root-environment.mts",
    "node_modules/next/dist/bin/next",
    "dev",
    "--webpack",
  ],
  { CCE_VUE_DEV_SERVER: "1" },
);
process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
