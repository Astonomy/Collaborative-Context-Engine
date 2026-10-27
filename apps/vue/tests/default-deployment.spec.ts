import { expect, test } from "@playwright/test";

test("default entry, SPA reload, media CSP, missing assets and legacy rollback share one host", async ({
  page,
  request,
}) => {
  let hmrConnected = false;
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname !== "/vue/hmr") return;
    socket.on("framereceived", ({ payload }) => {
      if (payload.toString().includes('"type":"connected"')) hmrConnected = true;
    });
  });
  await page.goto("/");
  await expect(page).toHaveURL(/\/vue\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  if (process.env["CCE_E2E_PRODUCTION"] !== "1") {
    await expect.poll(() => hmrConnected).toBe(true);
  }
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  const response = await request.get("/vue/projects/project/conversations/conversation");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/html");
  if (process.env["CCE_E2E_PRODUCTION"] === "1") {
    const csp = response.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("media-src 'self'");
    expect(csp).toContain("worker-src 'self'");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["cache-control"]).toBe("no-store");
    for (const path of [
      "/vue/assets/missing.js",
      "/vue/assets/missing-worker.js",
      "/vue/bundle-report.json",
      "/vue/.vite/manifest.json",
    ]) {
      const missing = await request.get(path);
      expect(missing.status()).toBe(404);
      expect(missing.headers()["content-type"]).not.toContain("text/html");
    }
  }
  const unsupported = await request.post("/vue/projects", { data: {} });
  // Vite rejects unsupported methods with 404; the production route uses HTTP 405.
  expect(unsupported.status()).toBe(process.env["CCE_E2E_PRODUCTION"] === "1" ? 405 : 404);
  expect((await request.get("/api/no-such-endpoint")).status()).toBe(404);
  await page.goto("/legacy");
  await expect(page.getByRole("button", { name: "Continue securely", exact: true })).toBeVisible();
});

test("MCP remains authenticated and reachable at the default same-origin endpoint", async ({
  request,
}) => {
  const token = process.env["CCE_E2E_API_TOKEN"];
  if (!token) throw new Error("Requires the isolated PostgreSQL runner");
  const body = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
  const headers = { accept: "application/json, text/event-stream" };
  expect((await request.post("/mcp", { headers, data: body })).status()).toBe(401);
  const response = await request.post("/mcp", {
    headers: { ...headers, authorization: `Bearer ${token}` },
    data: body,
  });
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('"preview_conversation_import"');
});
