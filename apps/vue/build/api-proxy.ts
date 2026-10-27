import type { ProxyOptions } from "vite";

export function forwardedOrigin(
  origin: string | undefined,
  host: string | undefined,
  target: string,
): string | undefined {
  if (origin === undefined) return undefined;
  // Vite's loopback dev/preview listener is HTTP. Reject foreign/opaque origins
  // before translating to the standalone API's upstream Request URL.
  return host !== undefined && origin === `http://${host}` ? new URL(target).origin : "null";
}

export function apiProxy(target: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    configure(proxy) {
      proxy.on("proxyReq", (outgoing, incoming) => {
        const origin = forwardedOrigin(incoming.headers.origin, incoming.headers.host, target);
        if (origin !== undefined) outgoing.setHeader("origin", origin);
      });
    },
  };
}
