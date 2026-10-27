import { randomUUID } from "node:crypto";
import {
  agentRunResponseSchema,
  messageListResponseSchema,
  projectResponseSchema,
} from "@cce/api-contracts";
import { test, expect } from "./real-browser";

declare global {
  interface Window {
    __cceChatResponseBody?: Promise<string>;
  }
}

test("B C H: browser evidence, real SSE completion, reviewed commit and reloaded context", async ({
  page,
}) => {
  const token = process.env["CCE_E2E_API_TOKEN"];
  if (!token) throw new Error("Requires isolated PostgreSQL runner");
  // Install before ApiClient captures fetch at application startup.
  // The UI cancels its reader on the terminal event. Capture a second reader
  // of the real response before consumption; Chromium may discard the body of
  // the cancelled request from Network.getResponseBody. No request is mocked.
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (new URL(response.url).pathname.endsWith("/chat"))
        window.__cceChatResponseBody = response.clone().text();
      return response;
    };
  });
  await page.goto("/vue/projects");
  await page.getByLabel("API token").fill(token);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("New project").fill(`S14 ${randomUUID()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("link", { name: "Conversations", exact: true }).click();
  await page.getByLabel("New conversation").fill("S14 persisted evidence");
  await page.getByRole("button", { name: "Create conversation" }).click();
  await expect(page.getByRole("heading", { name: "S14 persisted evidence" })).toBeVisible();
  const conversationURL = page.url();
  const evidence = "Set database.engine to PostgreSQL as the canonical project database.";
  await page.getByLabel("Message", { exact: true }).fill(evidence);
  const streamResponse = page.waitForResponse(
    (response) => response.url().endsWith("/chat") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const stream = await streamResponse;
  expect(stream.status()).toBe(200);
  expect(stream.headers()["content-type"]).toContain("text/event-stream");
  await expect
    .poll(() => page.evaluate(() => window.__cceChatResponseBody !== undefined))
    .toBe(true);
  const events = await page.evaluate(() => window.__cceChatResponseBody);
  for (const type of ["user_persisted", "assistant_started", "text_delta", "completed"])
    expect(events).toContain(`event: ${type}`);
  await expect(
    page.getByText("No canonical database context was supplied.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Extract context", exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByText(evidence, { exact: true })).toBeVisible();
  await expect(
    page.getByText("No canonical database context was supplied.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/CCE assistant · streaming/)).toHaveCount(0);
  await page.getByRole("button", { name: "Extract context", exact: true }).click();
  await expect(page.getByRole("region", { name: "Delta preview" })).toContainText(
    "database.engine",
  );
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  await page
    .getByLabel("Review rationale")
    .fill("Explicit evidence verified by the project owner.");
  await page.getByRole("button", { name: "Accept proposed", exact: true }).click();
  await page.getByRole("button", { name: "Commit reviewed changes", exact: true }).click();
  await expect(page.getByText("ContextCommit v1 is now canonical HEAD.")).toBeVisible();
  await page.getByRole("link", { name: "Context", exact: true }).click();
  await page.reload();
  await expect(page.getByText("database.engine", { exact: true })).toBeVisible();
  await expect(page.getByText('"PostgreSQL"', { exact: true })).toBeVisible();

  await page.goto(conversationURL);
  await page.getByLabel("Agent objective").fill("Extract context from the persisted evidence");
  const agentResponse = page.waitForResponse(
    (response) => response.url().endsWith("/agents/runs") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Run agent", exact: true }).click();
  const response = await agentResponse;
  expect(response.ok()).toBe(true);
  const agent = agentRunResponseSchema.parse(await response.json());
  const result = page.getByRole("region", { name: "Agent result" });
  await expect(result).toContainText(agent.run.status.replaceAll("_", " "));
  const apiPath = new URL(conversationURL).pathname
    .replace(/^\/vue/, "/api")
    .split("/conversations/")[0];
  await expect
    .poll(async () => {
      const persisted = await page.request.get(`${apiPath}/agents/runs/${agent.run.id}`);
      expect(persisted.ok()).toBe(true);
      return agentRunResponseSchema.parse(await persisted.json()).run.status;
    })
    .toMatch(/^(completed|failed|cancelled)$/);
  await expect(result).toContainText("completed");
  await page.reload();
  const persisted = await page.request.get(`${apiPath}/agents/runs/${agent.run.id}`);
  expect(agentRunResponseSchema.parse(await persisted.json()).run.status).toBe("completed");
  const messages = await page.request.get(
    new URL(conversationURL).pathname.replace(/^\/vue/, "/api") + "/messages",
  );
  expect(
    messageListResponseSchema
      .parse(await messages.json())
      .some((message) => message.content === evidence),
  ).toBe(true);
});

test("G: unauthorized project API failure is presented in Vue", async ({ page, request }) => {
  const owner = process.env["CCE_E2E_API_TOKEN"];
  const outsider = process.env["CCE_E2E_VIEWER_API_TOKEN"];
  if (!owner || !outsider) throw new Error("Requires isolated identities");
  const response = await request.post("/api/projects", {
    headers: { authorization: `Bearer ${owner}` },
    data: { name: `Private S14 ${randomUUID()}` },
  });
  expect(response.status()).toBe(201);
  const project = projectResponseSchema.parse(await response.json());
  await page.goto("/vue/projects");
  await page.getByLabel("API token").fill(outsider);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  const denied = page.waitForResponse((entry) =>
    entry.url().endsWith(`/api/projects/${project.id}`),
  );
  await page.goto(`/vue/projects/${project.id}`);
  expect((await denied).status()).toBe(404);
  await expect(page.getByRole("alert")).toContainText(
    "This resource was not found or is not accessible.",
  );
  await expect(page.getByRole("heading", { name: project.name, exact: true })).toHaveCount(0);
});
