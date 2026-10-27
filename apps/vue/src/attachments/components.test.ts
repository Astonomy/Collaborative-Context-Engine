import { attachmentResponseSchema } from "@cce/api-contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, type Component } from "vue";
import AttachmentRenderer from "./AttachmentRenderer.vue";
import AttachmentCollection from "./AttachmentCollection.vue";
import AttachmentUpload from "./AttachmentUpload.vue";
import { ApiClient } from "../data/api-client";
import { attachmentFixture, inspectionFixture, pngFixture } from "./fixtures";
const cleanups: (() => void)[] = [];
const revoked = vi.fn();
const created = vi.fn(() => "blob:preview");
const paused = vi.fn();
function mount(component: Component, props: Record<string, unknown>) {
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp({ render: () => h(component, props) });
  app.mount(root);
  cleanups.push(() => app.unmount());
  return root;
}
function button(root: Element, label: string): HTMLButtonElement {
  const result = [...root.querySelectorAll("button")].find((entry) =>
    entry.textContent?.includes(label),
  );
  if (!result) throw new Error("Missing button: " + label);
  return result;
}
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
}
beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(paused);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(pngFixture)));
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: created,
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoked });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("displays images directly without allocating object URLs", async () => {
  const root = mount(AttachmentRenderer, {
    attachment: attachmentFixture(),
    capability: inspectionFixture(),
    client: new ApiClient(),
  });
  await settle();
  expect(root.querySelector("img")?.alt).toBe("sample.png");
  expect(fetch).not.toHaveBeenCalled();
  expect(root.querySelector("img")?.src).toContain("/content");
  expect(created).not.toHaveBeenCalled();
  const link = root.querySelector<HTMLAnchorElement>(".attachment-open");
  expect(link?.target).toBe("_blank");
  expect(link?.rel).toContain("noopener");
  cleanups.splice(0).forEach((fn) => fn());
  expect(revoked).not.toHaveBeenCalled();
});
it("displays video immediately without autoplay and releases it", async () => {
  const root = mount(AttachmentRenderer, {
    attachment: attachmentFixture(),
    capability: inspectionFixture("video-stream"),
    client: new ApiClient(),
  });
  await settle();
  const video = root.querySelector("video");
  expect(video?.controls).toBe(true);
  expect(video?.autoplay).toBe(false);
  expect(video?.preload).toBe("metadata");
  cleanups.splice(0).forEach((fn) => fn());
  expect(paused).toHaveBeenCalled();
  expect(video?.getAttribute("src")).toBeNull();
});
it.each([5, 6])("collects only more than five attachments (%s)", (count) => {
  const root = mount(AttachmentCollection, {
    attachments: Array.from({ length: count }, () =>
      attachmentResponseSchema.parse({ ...attachmentFixture(), id: crypto.randomUUID() }),
    ),
    client: new ApiClient(vi.fn().mockRejectedValue(new Error("offline"))),
  });
  expect(root.querySelector(".attachment-collection")?.classList.contains("is-collected")).toBe(
    count > 5,
  );
  expect(root.querySelectorAll(".attachment-card")).toHaveLength(count);
});
it("ML files and untrusted filenames render as inert text with download fallback", async () => {
  const inspection = inspectionFixture("download");
  inspection.description.metadata.format = "unverified-pkl";
  const root = mount(AttachmentRenderer, {
    attachment: attachmentFixture({ originalFilename: '<svg onload="alert(1)">.pkl' }),
    capability: inspection,
    client: new ApiClient(),
  });
  await settle();
  expect(root.textContent).toContain("Model file");
  expect(root.querySelector("svg")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  expect(root.querySelector("a")?.hasAttribute("download")).toBe(true);
});
it.each(["image-original", "video-stream"] as const)(
  "%s failures preserve metadata and download",
  async (preview) => {
    const root = mount(AttachmentRenderer, {
      attachment: attachmentFixture(),
      capability: inspectionFixture(preview),
      client: new ApiClient(),
    });
    await settle();

    root
      .querySelector(preview === "video-stream" ? "video" : "img")
      ?.dispatchEvent(new Event("error"));
    await settle();
    expect(root.textContent).toContain("Preview unavailable");
    expect(root.querySelector("a")).not.toBeNull();
    expect(root.querySelector("video, img")).toBeNull();
  },
);
it("inspection errors fall back without propagating into conversation", async () => {
  const root = mount(AttachmentRenderer, {
    attachment: attachmentFixture(),
    client: new ApiClient(vi.fn().mockRejectedValue(new Error("offline"))),
  });
  await settle();
  expect(root.textContent).toContain("Preview unavailable");
});
function select(root: Element, file: File) {
  const input = root.querySelector("input");
  if (!input) throw new Error("Missing input");
  Object.defineProperty(input, "files", {
    configurable: true,
    value: { length: 1, item: () => file },
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
it("validates picker input, reports progress, retries with stable identity and emits server binding", async () => {
  const client = new ApiClient();
  const uploaded = vi.fn();
  const upload = vi
    .spyOn(client, "upload")
    .mockImplementationOnce(async (_target, _file, _id, progress) => {
      progress(42);
      throw new Error("Connection failed");
    })
    .mockResolvedValueOnce(attachmentFixture());
  const target = {
    projectId: attachmentFixture().projectId,
    conversationId: attachmentFixture().conversationId,
  };
  const root = mount(AttachmentUpload, { client, target, disabled: false, onUploaded: uploaded });
  select(root, new File(["x"], "unsafe.svg"));
  await settle();
  expect(root.textContent).toContain("cannot be uploaded");
  expect(upload).not.toHaveBeenCalled();
  select(root, new File([pngFixture], "image.png", { type: "image/png" }));
  await settle();
  button(root, "Upload attachment").click();
  await settle();
  expect(root.textContent).toContain("Connection failed");
  button(root, "Retry upload").click();
  await settle();
  expect(upload.mock.calls[0]?.[2]).toBe(upload.mock.calls[1]?.[2]);
  expect(upload.mock.calls[0]?.[0]).toEqual(target);
  expect(uploaded).toHaveBeenCalledWith(attachmentFixture());
  expect(root.textContent).toContain("saved as a new message");
});
it("disabled uploads do not accept files and unmount aborts an active upload", async () => {
  const client = new ApiClient();
  const upload = vi.spyOn(client, "upload").mockImplementation(() => new Promise(() => undefined));
  const target = {
    projectId: attachmentFixture().projectId,
    conversationId: attachmentFixture().conversationId,
  };
  const disabled = mount(AttachmentUpload, { client, target, disabled: true });
  select(disabled, new File(["x"], "file.bin"));
  await settle();
  expect(button(disabled, "Upload attachment").disabled).toBe(true);
  const root = mount(AttachmentUpload, { client, target, disabled: false });
  select(root, new File(["x"], "file.bin"));
  await settle();
  button(root, "Upload attachment").click();
  await settle();
  expect(upload.mock.calls[0]?.[4].aborted).toBe(false);
  cleanups.splice(0).forEach((fn) => fn());
  expect(upload.mock.calls[0]?.[4].aborted).toBe(true);
});
