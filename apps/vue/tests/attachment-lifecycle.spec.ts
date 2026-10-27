import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request as playwrightRequest } from "@playwright/test";
import { expect, test } from "./real-browser";
import {
  attachmentListResponseSchema,
  conversationResponseSchema,
  messageListResponseSchema,
  messageResponseSchema,
  projectResponseSchema,
} from "@cce/api-contracts";
import { pngFixture, glbFixture } from "../src/attachments/fixtures";

test("PostgreSQL upload, metadata, previews, reload, scoped download and logout revocation", async ({
  page,
  context,
  baseURL,
}) => {
  const token = process.env["CCE_E2E_API_TOKEN"];
  if (!token || !baseURL) throw new Error("Requires isolated PostgreSQL runner");
  const api = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { authorization: `Bearer ${token}` },
  });
  try {
    const origin = new URL(baseURL).origin;
    expect(
      (
        await context.request.post("/api/session", {
          headers: { origin },
          data: { apiToken: token },
        })
      ).status(),
    ).toBe(200);
    const project = projectResponseSchema.parse(
      await (
        await api.post("/api/projects", {
          headers: { origin },
          data: { name: `S8 attachments ${randomUUID()}` },
        })
      ).json(),
    );
    const other = projectResponseSchema.parse(
      await (
        await api.post("/api/projects", {
          headers: { origin },
          data: { name: `S8 other ${randomUUID()}` },
        })
      ).json(),
    );
    const conversation = conversationResponseSchema.parse(
      await (
        await api.post(`/api/projects/${project.id}/conversations`, {
          headers: { origin },
          data: { title: "Persisted attachments" },
        })
      ).json(),
    );
    const path = `/api/projects/${project.id}/conversations/${conversation.id}/attachments`;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/vue/projects/${project.id}/conversations/${conversation.id}`);
    const fixtures = [
      { name: "pixel.png", mimeType: "image/png", buffer: Buffer.from(pngFixture) },
      {
        name: "pixel.jpg",
        mimeType: "image/jpeg",
        buffer: await readFile(new URL("./fixtures/preview.jpg", import.meta.url)),
      },
      {
        name: "clip.mp4",
        mimeType: "video/mp4",
        buffer: await readFile(new URL("./fixtures/preview.mp4", import.meta.url)),
      },
      { name: "triangle.glb", mimeType: "model/gltf-binary", buffer: Buffer.from(glbFixture()) },
      {
        name: "weights.pkl",
        mimeType: "application/octet-stream",
        buffer: Buffer.from("inert weights"),
      },
      {
        name: "unsafe.txt",
        mimeType: "text/html",
        buffer: Buffer.from("<script>window.s8Executed=true</script>"),
      },
    ];
    for (const fixture of fixtures) {
      await page.getByLabel("Choose attachment", { exact: true }).setInputFiles(fixture);
      await page.getByRole("button", { name: "Upload attachment", exact: true }).click();
      await expect(
        page.getByRole("region", { name: `Attachment ${fixture.name}`, exact: true }),
      ).toBeVisible();
    }
    const browserRange = page.waitForResponse(
      (response) =>
        response.url().endsWith("/content") &&
        response.request().headers()["range"] !== undefined &&
        response.status() === 206,
    );
    await page.reload();
    for (const fixture of fixtures)
      await expect(
        page.getByRole("region", { name: `Attachment ${fixture.name}`, exact: true }),
      ).toBeVisible();
    const listing = await api.get(path);
    expect(listing.status()).toBe(200);
    const raw: unknown = await listing.json();
    const attachments = attachmentListResponseSchema.parse(raw);
    expect(attachments).toHaveLength(fixtures.length);
    const conversationPath = `/api/projects/${project.id}/conversations/${conversation.id}`;
    const detail = conversationResponseSchema.parse(await (await api.get(conversationPath)).json());
    expect(detail.attachments.map((a) => a.id)).toEqual(attachments.map((a) => a.id));
    const messages = messageListResponseSchema.parse(
      await (await api.get(`${conversationPath}/messages`)).json(),
    );
    for (const attachment of attachments) {
      const message = messages.find((m) => m.id === attachment.messageId);
      expect(message?.attachments.map((a) => a.id)).toEqual([attachment.id]);
    }
    // Identical display text is ordinary evidence, never an attachment binding.
    const text = messageResponseSchema.parse(
      await (
        await api.post(`${conversationPath}/messages`, {
          data: { clientMessageId: randomUUID(), content: "Attachment: pixel.png" },
        })
      ).json(),
    );
    const afterText = messageListResponseSchema.parse(
      await (await api.get(`${conversationPath}/messages`)).json(),
    );
    expect(afterText.find((m) => m.id === text.id)?.attachments).toEqual([]);
    for (const attachment of attachments) {
      const content = `/api/projects/${project.id}/attachments/${attachment.id}/content`;
      const download = await api.get(content);
      expect(download.status()).toBe(200);
      expect(download.headers()["content-type"]).toBe(
        ["image/png", "image/jpeg", "video/mp4"].includes(attachment.detectedMimeType)
          ? attachment.detectedMimeType
          : "application/octet-stream",
      );
      expect(download.headers()["content-disposition"]).toContain(
        ["image/png", "image/jpeg", "video/mp4"].includes(attachment.detectedMimeType)
          ? "inline;"
          : "attachment;",
      );
      expect(download.headers()["x-content-type-options"]).toBe("nosniff");
      expect(download.headers()["cache-control"]).toContain("no-store");
      expect(await download.body()).toEqual(
        fixtures.find((f) => f.name === attachment.originalFilename)?.buffer,
      );
      expect(
        (await api.get(`/api/projects/${other.id}/attachments/${attachment.id}/content`)).status(),
      ).toBe(404);
    }
    expect(
      (
        await api.get(`/api/projects/${other.id}/conversations/${conversation.id}/attachments`)
      ).status(),
    ).toBe(404);
    expect(
      (await api.get(`/api/projects/${project.id}/attachments/${randomUUID()}/content`)).status(),
    ).toBe(404);
    expect(
      (await api.get(`/api/projects/${project.id}/attachments/${randomUUID()}`)).status(),
    ).toBe(404);
    expect((await api.get(`/api/projects/${project.id}/attachments/forged-id`)).status()).toBe(400);
    for (const headers of [
      { "x-cce-filename": encodeURIComponent("../../evil.html"), "content-type": "text/plain" },
      { "x-cce-filename": "safe.txt", "content-type": "not-a-mime" },
    ])
      expect(
        (
          await api.post(path, {
            headers: { ...headers, origin, "x-cce-client-message-id": randomUUID() },
            data: Buffer.from("data"),
          })
        ).status(),
      ).toBe(422);
    const image = page.getByRole("region", { name: "Attachment pixel.png", exact: true });
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        image
          .locator("img")
          .evaluate((element) => element instanceof HTMLImageElement && element.naturalWidth),
      )
      .toBe(1);
    const jpeg = page.getByRole("region", { name: "Attachment pixel.jpg", exact: true });
    await jpeg.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        jpeg
          .locator("img")
          .evaluate((element) => element instanceof HTMLImageElement && element.naturalWidth),
      )
      .toBe(1);
    const video = page.getByRole("region", { name: "Attachment clip.mp4", exact: true });

    await video.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        video
          .locator("video")
          .evaluate((element) => element instanceof HTMLVideoElement && element.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    await video.locator("video").evaluate(async (element: HTMLVideoElement) => {
      element.muted = true;
      await element.play();
    });
    await expect
      .poll(() =>
        video.locator("video").evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeGreaterThan(0);
    await video.locator("video").evaluate((element: HTMLVideoElement) => {
      element.pause();
      element.currentTime = element.duration / 2;
    });
    await expect
      .poll(() =>
        video
          .locator("video")
          .evaluate(
            (element: HTMLVideoElement) =>
              !element.seeking && Math.abs(element.currentTime - element.duration / 2) < 0.1,
          ),
      )
      .toBe(true);
    expect((await browserRange).headers()["content-range"]).toMatch(/^bytes /);
    const model = page.getByRole("region", { name: "Attachment triangle.glb", exact: true });
    await model.scrollIntoViewIfNeeded();
    await expect(model.getByText(/1 triangles/)).toBeVisible();
    await expect(model.locator("canvas")).toBeVisible();
    expect(await page.evaluate(() => "s8Executed" in window)).toBe(false);
    expect(errors).toEqual([]);
    const first = attachments[0];
    if (!first) throw new Error("Missing attachment");
    const outsider = process.env["CCE_E2E_VIEWER_API_TOKEN"];
    if (!outsider) throw new Error("Missing isolated outsider identity");
    for (const suffix of ["", "/inspection", "/content"]) {
      expect(
        (
          await api.get(`/api/projects/${project.id}/attachments/${first.id}${suffix}`, {
            headers: { authorization: `Bearer ${outsider}` },
          })
        ).status(),
      ).toBe(404);
    }
    const clip = attachments.find((a) => a.detectedMimeType === "video/mp4");
    if (!clip) throw new Error("Missing video");
    const content = `/api/projects/${project.id}/attachments/${clip.id}/content`;
    const range = await api.get(content, { headers: { range: "bytes=0-3" } });
    expect(range.status()).toBe(206);
    expect(range.headers()["content-type"]).toBe("video/mp4");
    expect(range.headers()["content-range"]).toBe(`bytes 0-3/${clip.byteSize}`);
    expect(range.headers()["accept-ranges"]).toBe("bytes");
    expect(range.headers()["content-length"]).toBe("4");
    expect((await range.body()).length).toBe(4);
    expect(
      (
        await api.get(content, {
          headers: { range: "bytes=0-3", authorization: `Bearer ${outsider}` },
        })
      ).status(),
    ).toBe(404);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
    expect((await context.request.get(content)).status()).toBe(401);
    expect((await context.request.get(path)).status()).toBe(401);
  } finally {
    await api.dispose();
  }
});
