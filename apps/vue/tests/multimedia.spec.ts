import { readFile, mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { attachmentResponseSchema, messageListResponseSchema } from "@cce/api-contracts";
import {
  attachmentFixture,
  glbFixture,
  inspectionFixture,
  pngFixture,
} from "../src/attachments/fixtures";
import { ids, now, user, project, member, conversation } from "../src/migration-fixtures";

declare global {
  interface Window {
    s8Resources: {
      urlsCreated: number;
      urlsRevoked: number;
      workersCreated: number;
      workersTerminated: number;
    };
  }
}

test("image, Range video, isolated model and inert file render after scoped uploads", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const counters = { urlsCreated: 0, urlsRevoked: 0, workersCreated: 0, workersTerminated: 0 };
    window.s8Resources = counters;
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => {
      counters.urlsCreated++;
      return create(object);
    };
    URL.revokeObjectURL = (url) => {
      counters.urlsRevoked++;
      revoke(url);
    };
    const OriginalWorker = Worker;
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        counters.workersCreated++;
      }
      override terminate(): void {
        counters.workersTerminated++;
        super.terminate();
      }
    };
  });
  const timings: Record<string, number> = {};
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const video = await readFile(new URL("./fixtures/preview.mp4", import.meta.url));
  const fixtures = [
    {
      name: "pixel.png",
      bytes: Buffer.from(pngFixture),
      mime: "image/png",
      preview: "image-original",
    },
    { name: "clip.mp4", bytes: video, mime: "video/mp4", preview: "video-stream" },
    {
      name: "triangle.glb",
      bytes: Buffer.from(glbFixture()),
      mime: "model/gltf-binary",
      preview: "3d-isolated",
    },
    {
      name: "weights.pkl",
      bytes: Buffer.from("inert bytes"),
      mime: "application/octet-stream",
      preview: "download",
    },
  ] as const;
  const messages: unknown[] = [];
  const contentRequests: { filename: string; range: string | undefined }[] = [];
  const loadedModels: string[] = [];
  page.on("request", (request) => {
    if (/ModelPreview|model-worker|model-geometry/.test(request.url()))
      loadedModels.push(request.url());
  });
  const uploaded = new Map<
    string,
    { fixture: (typeof fixtures)[number]; attachment: ReturnType<typeof attachmentFixture> }
  >();
  await page.context().route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/session") return route.fulfill({ json: { user } });
    if (path === `/api/projects/${ids.project}`)
      return route.fulfill({ json: { project, member } });
    if (path === `/api/projects/${ids.project}/conversations/${ids.conversation}`)
      return route.fulfill({ json: conversation });
    if (path.endsWith("/messages"))
      return route.fulfill({
        json: messageListResponseSchema.parse(messages).map((message) => ({
          ...message,
          attachments: [...uploaded.values()]
            .map((entry) => entry.attachment)
            .filter((attachment) => attachment.messageId === message.id),
        })),
      });
    if (path.endsWith("/attachments") && request.method() === "GET")
      return route.fulfill({ json: [...uploaded.values()].map((entry) => entry.attachment) });
    if (request.method() === "POST" && path.endsWith("/attachments")) {
      expect(path).toBe(
        `/api/projects/${ids.project}/conversations/${ids.conversation}/attachments`,
      );
      const name = decodeURIComponent(request.headers()["x-cce-filename"] ?? "");
      const fixture = fixtures.find((entry) => entry.name === name);
      if (!fixture) throw new Error("Unexpected fixture");
      expect(request.postDataBuffer()).toEqual(fixture.bytes);
      const number = uploaded.size + 100;
      const attachment = attachmentResponseSchema.parse({
        ...attachmentFixture(),
        id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
        messageId: `00000000-0000-4000-8000-${String(number + 100).padStart(12, "0")}`,
        projectId: ids.project,
        conversationId: ids.conversation,
        originalFilename: name,
        byteSize: fixture.bytes.length,
        detectedMimeType: fixture.mime,
      });
      uploaded.set(attachment.id, { fixture, attachment });
      messages.push({
        id: attachment.messageId,
        projectId: ids.project,
        conversationId: ids.conversation,
        sequence: messages.length + 1,
        clientMessageId: request.headers()["x-cce-client-message-id"],
        role: "user",
        deliveryState: "completed",
        content: "Uploaded file",
        attachments: [attachment],
        author: { type: "human", userId: ids.user },
        providerMessageId: null,
        errorCode: null,
        createdAt: now,
        completedAt: now,
      });
      return route.fulfill({ status: 201, json: attachment });
    }
    const record = [...uploaded.values()].find((entry) => path.includes(entry.attachment.id));
    if (record && path.endsWith("/" + record.attachment.id))
      return route.fulfill({ json: record.attachment });
    if (record && path.endsWith("/inspection")) {
      const inspection = inspectionFixture(record.fixture.preview, record.fixture.bytes.length);
      if (record.fixture.preview === "download")
        inspection.description.metadata.format = "unverified-pkl";
      return route.fulfill({ json: inspection });
    }
    if (record && path.endsWith("/content")) {
      const range = request.headers()["range"];
      contentRequests.push({ filename: record.fixture.name, range });
      const start = range ? Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0) : 0;
      const end = record.fixture.bytes.length - 1;
      return route.fulfill({
        status: range ? 206 : 200,
        body: record.fixture.bytes.subarray(start),
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": 'attachment; filename="attachment"',
          "accept-ranges": "bytes",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; sandbox",
          ...(range ? { "content-range": `bytes ${start}-${end}/${end + 1}` } : {}),
        },
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`/vue/projects/${ids.project}/conversations/${ids.conversation}`);
  for (const fixture of fixtures) {
    await page
      .getByLabel("Choose attachment")
      .setInputFiles({ name: fixture.name, mimeType: fixture.mime, buffer: fixture.bytes });
    await page.getByRole("button", { name: "Upload attachment", exact: true }).click();
    await expect(
      page.getByRole("region", { name: `Attachment ${fixture.name}`, exact: true }),
    ).toBeVisible();
  }
  const image = page.getByRole("region", { name: "Attachment pixel.png", exact: true });
  await image.scrollIntoViewIfNeeded();
  const imageStart = performance.now();
  await expect
    .poll(() =>
      image
        .locator("img")
        .evaluate((element) => element instanceof HTMLImageElement && element.naturalWidth),
    )
    .toBe(1);
  timings["imageReadyMs"] = performance.now() - imageStart;
  const movie = page.getByRole("region", { name: "Attachment clip.mp4", exact: true });
  await movie.scrollIntoViewIfNeeded();
  const videoStart = performance.now();
  await expect
    .poll(() =>
      movie
        .locator("video")
        .evaluate((element) => element instanceof HTMLVideoElement && element.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  timings["videoReadyMs"] = performance.now() - videoStart;
  expect(
    contentRequests.some(
      (entry) => entry.filename === "clip.mp4" && entry.range?.startsWith("bytes="),
    ),
  ).toBe(true);
  await movie.locator("video").evaluate(async (element) => {
    if (element instanceof HTMLVideoElement) await element.play();
  });
  await expect
    .poll(() =>
      movie
        .locator("video")
        .evaluate((element) => element instanceof HTMLVideoElement && element.currentTime),
    )
    .toBeGreaterThan(0);
  const model = page.getByRole("region", { name: "Attachment triangle.glb", exact: true });
  await model.scrollIntoViewIfNeeded();
  const modelStart = performance.now();
  await expect(model.getByText(/1 triangles/)).toBeVisible();
  timings["modelReadyMs"] = performance.now() - modelStart;
  expect(loadedModels.length).toBeGreaterThan(0);
  const before = await model
    .locator("canvas")
    .evaluate((canvas) => (canvas instanceof HTMLCanvasElement ? canvas.toDataURL() : ""));
  await model.locator("canvas").press("ArrowRight");
  expect(
    await model
      .locator("canvas")
      .evaluate((canvas) => (canvas instanceof HTMLCanvasElement ? canvas.toDataURL() : "")),
  ).not.toBe(before);
  await expect(model.locator("canvas")).toBeVisible();
  const generic = page.getByRole("region", { name: "Attachment weights.pkl", exact: true });
  await generic.scrollIntoViewIfNeeded();
  await expect(generic.getByText("Model file", { exact: true })).toBeVisible();
  expect(contentRequests.some((entry) => entry.filename === "weights.pkl")).toBe(false);
  for (let cycle = 0; cycle < 3; cycle++) {
    await model.scrollIntoViewIfNeeded();
    await expect(model.getByText(/1 triangles/)).toBeVisible();
  }
  const original = [...uploaded.values()][0];
  if (!original) throw new Error("Missing image fixture");
  for (let index = 0; index < 5; index++) {
    const attachment = attachmentResponseSchema.parse({
      ...original.attachment,
      id: crypto.randomUUID(),
      originalFilename: "extra-" + index + ".png",
    });
    uploaded.set(attachment.id, { fixture: original.fixture, attachment });
  }
  await page.reload();
  const collection = page.locator(".is-collected");
  const reveal = collection.locator(".attachment-collection-reveal");
  await expect(reveal).toHaveCSS("visibility", "hidden");
  await collection.hover();
  await expect(reveal).toHaveCSS("opacity", "1");
  await expect(collection.locator("img")).toHaveCount(6);
  await page.getByRole("heading", { name: conversation.title, exact: true }).hover();
  await expect(reveal).toHaveCSS("visibility", "hidden");
  await collection.focus();
  await expect(reveal).toHaveCSS("opacity", "1");
  const fullLink = collection.getByRole("link", {
    name: "View full content pixel.png",
    exact: true,
  });
  await expect(fullLink).toHaveAttribute("target", "_blank");
  const href = await fullLink.getAttribute("href");
  if (!href) throw new Error("Missing full preview URL");
  const popupReady = page.waitForEvent("popup");
  await fullLink.click();
  const popup = await popupReady;
  await expect(popup).toHaveURL(new URL(href, page.url()).href);
  await expect(popup.locator(".attachment-view img")).toBeVisible();
  await expect(popup.locator(".attachment-view .attachment-open")).toHaveCount(0);
  await popup.close();
  const client = await page.context().newCDPSession(page);
  await client.send("HeapProfiler.collectGarbage");
  const beforeHeap = await client.send("Runtime.getHeapUsage");
  const beforeResources = await page.evaluate(() => ({ ...window.s8Resources }));
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page.locator(".attachment-card")).toHaveCount(0);
  const afterResources = await page.evaluate(() => ({ ...window.s8Resources }));
  expect(afterResources.urlsRevoked).toBe(afterResources.urlsCreated);
  expect(afterResources.workersTerminated).toBe(afterResources.workersCreated);
  await client.send("HeapProfiler.collectGarbage");
  const afterHeap = await client.send("Runtime.getHeapUsage");
  if (process.env["CCE_VUE_MEDIA_PREVIEW"] === "1") {
    const folder = new URL("../../../docs/verification/", import.meta.url);
    await mkdir(folder, { recursive: true });
    await writeFile(
      new URL("s8-media.json", folder),
      JSON.stringify(
        {
          production: true,
          timings,
          beforeHeap,
          afterHeap,
          beforeResources,
          afterResources,
          contentRequests,
          loadedModels,
        },
        null,
        2,
      ),
    );
  }
  await page.goBack();
  await page.goto(`/vue/projects/${ids.project}/conversations/${ids.conversation}`);
  await page.locator(".is-collected").hover();
  for (const fixture of fixtures) {
    await expect(
      page.getByRole("region", { name: `Attachment ${fixture.name}`, exact: true }),
    ).toBeVisible();
  }
  expect(errors).toEqual([]);
});
