import vue from "@vitejs/plugin-vue";
import { defineConfig, loadEnv } from "vite";
import { z } from "zod";
import { browserBoundary } from "./build/browser-boundary.ts";
import { readBrowserConfig } from "./src/config.ts";
import { apiProxy } from "./build/api-proxy.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, ["VITE_", "CCE_API_PROXY_TARGET"]);
  const config = readBrowserConfig(env);
  const target = z
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash
      );
    })
    .parse(env["CCE_API_PROXY_TARGET"] ?? "http://localhost:3001");
  const proxy = { "/api": apiProxy(target), "/mcp": apiProxy(target) };
  return {
    base: config.base,
    plugins: [vue(), browserBoundary()],
    server: { port: 5173, strictPort: true, proxy, hmr: { path: "hmr" } },
    preview: { port: 4173, strictPort: true, proxy },
    build: { manifest: true, sourcemap: false, chunkSizeWarningLimit: 250 },
  };
});
