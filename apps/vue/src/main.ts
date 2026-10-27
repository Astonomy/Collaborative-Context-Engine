import { createApp, shallowRef, watch } from "vue";
import App from "./App.vue";
import { readBrowserConfig } from "./config";
import { appContextKey } from "./context";
import { createSession } from "./data/session";
import { errorMessage } from "./errors";
import { appRouter } from "./router";
import "./styles/base.css";

function start(): void {
  const config = readBrowserConfig({ VITE_APP_BASE: import.meta.env["VITE_APP_BASE"] });
  const session = createSession();
  const fatal = shallowRef<string | null>(null);
  const report = (error: unknown): void => {
    fatal.value = errorMessage(error);
  };
  const router = appRouter(session, config.base, report);
  const app = createApp(App);
  app.provide(appContextKey, { session, fatal });
  app.config.errorHandler = report;
  window.addEventListener("error", (event) => report(event.error));
  window.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    report(event.reason);
  });
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    fatal.value = "A new version may be available. Reload to continue.";
  });
  watch(session.user, (user, previous) => {
    if (!user && previous) void router.replace({ name: "login" });
  });
  app.use(router);
  app.mount("#app");
}

try {
  start();
} catch {
  const root = document.getElementById("app");
  if (root)
    root.textContent = "CCE configuration is invalid. Contact the deployment administrator.";
}
