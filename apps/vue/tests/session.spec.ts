import { randomUUID } from "node:crypto";
import { expect, test } from "./real-browser";
import { projectResponseSchema } from "@cce/api-contracts";

test("real cookie login, project reads, reload bootstrap and logout through the same-origin proxy", async ({
  page,
  context,
  baseURL,
}) => {
  const token = process.env["CCE_E2E_API_TOKEN"] ?? process.env["CCE_SEED_API_TOKEN"];
  if (!token || !baseURL)
    throw new Error("Set CCE_E2E_API_TOKEN or CCE_SEED_API_TOKEN for the PostgreSQL-backed API.");
  const health = await context.request.get("/api/health");
  expect(health.status()).toBe(200);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/vue/projects");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("API token").fill(token);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  const cookie = (await context.cookies()).find((entry) => entry.name === "cce_session");
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/" });
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
      cookie: document.cookie,
    })),
  ).toEqual({ local: 0, session: 0, cookie: "" });

  const name = `Vue foundation ${randomUUID()}`;
  await page.getByLabel("New project").fill(name);
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/projects") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create project" }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const payload: unknown = await response.json();
  const project = projectResponseSchema.parse(payload);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Conversations", exact: true }).click();
  await expect(page.getByText("No conversations yet.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByLabel("New conversation").fill("S6 real evidence");
  await page.getByRole("button", { name: "Create conversation" }).click();
  await expect(page.getByRole("heading", { name: "S6 real evidence" })).toBeVisible();
  await page.getByLabel("Conversation title").fill("S6 renamed evidence");
  await page.getByRole("button", { name: "Rename conversation" }).click();
  await expect(page.getByRole("heading", { name: "S6 renamed evidence" })).toBeVisible();
  await page.getByRole("button", { name: "Archive conversation" }).click();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await page.getByLabel("Project name", { exact: true }).fill(name + " renamed");
  await page.getByRole("button", { name: "Rename project" }).click();
  await expect(page.getByRole("heading", { name: name + " renamed", exact: true })).toBeVisible();
  const wrongOrigin = await context.request.post("/api/session", {
    headers: { origin: "https://other.example" },
    data: { apiToken: token },
  });
  expect(wrongOrigin.status()).toBe(403);

  // Archive this test's own project through the existing API; preserve immutable history.
  expect(
    await page.evaluate(
      async (projectId) =>
        (
          await fetch(`/api/projects/${projectId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ archive: true }),
          })
        ).status,
      project.id,
    ),
  ).toBe(200);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect((await context.request.get("/api/session")).status()).toBe(401);
  await page.goto("/vue/projects");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("unknown browser routes show a navigable not-found state", async ({ page }) => {
  await page.goto("/vue/no-such-page");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to projects" })).toBeVisible();
});
