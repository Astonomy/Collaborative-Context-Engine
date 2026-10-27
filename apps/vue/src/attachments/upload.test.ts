import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { uploadFile, validateFile } from "./upload";
import { attachmentFixture } from "./fixtures";
import { ApiClient } from "../data/api-client";
class UploadRequest {
  static latest: UploadRequest;
  constructor() {
    UploadRequest.latest = this;
  }
  status = 201;
  responseText = JSON.stringify(attachmentFixture());
  responseURL = "";
  timeout = 0;
  withCredentials = false;
  upload: { onprogress?: (event: ProgressEvent) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  ontimeout?: () => void;
  onabort?: () => void;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => this.onabort?.());
}
const target = {
  projectId: attachmentFixture().projectId,
  conversationId: attachmentFixture().conversationId,
};
const file = new File(["file"], "图像.png", { type: "image/png" });
beforeEach(() => vi.stubGlobal("XMLHttpRequest", UploadRequest));
afterEach(() => vi.unstubAllGlobals());
it("uses the API client's standalone origin and cookie policy for uploads", async () => {
  const client = new ApiClient(fetch, undefined, "https://api.example.test");
  const result = client.upload(target, file, "retry-id", vi.fn(), new AbortController().signal);
  await vi.waitFor(() => expect(UploadRequest.latest.open).toHaveBeenCalled());
  const xhr = UploadRequest.latest;
  expect(xhr.open).toHaveBeenCalledWith(
    "POST",
    `https://api.example.test/api/projects/${target.projectId}/conversations/${target.conversationId}/attachments`,
  );
  expect(xhr.withCredentials).toBe(true);
  xhr.onload?.();
  expect(await result).toEqual(attachmentFixture());
});
it("uses binary POST, scoped target, encoded filename, retry identity and real progress", async () => {
  const progress = vi.fn();
  const result = uploadFile(target, file, "retry-id", new AbortController().signal, progress);
  const xhr = UploadRequest.latest;
  expect(xhr.open).toHaveBeenCalledWith(
    "POST",
    `/api/projects/${target.projectId}/conversations/${target.conversationId}/attachments`,
  );
  expect(xhr.send).toHaveBeenCalledWith(file);
  expect(xhr.setRequestHeader).toHaveBeenCalledWith(
    "X-CCE-Filename",
    encodeURIComponent(file.name),
  );
  expect(xhr.setRequestHeader).toHaveBeenCalledWith("X-CCE-Client-Message-Id", "retry-id");
  xhr.upload.onprogress?.(
    new ProgressEvent("progress", { lengthComputable: true, loaded: 2, total: 4 }),
  );
  expect(progress).toHaveBeenCalledWith(50);
  xhr.onload?.();
  expect(await result).toEqual(attachmentFixture());
});
it.each(["network", "timeout", "invalid", "target", "redirect", "forbidden"])(
  "rejects %s upload without false success",
  async (failure) => {
    const result = uploadFile(target, file, "id", new AbortController().signal, vi.fn());
    const checked = expect(result).rejects.toBeInstanceOf(Error);
    const xhr = UploadRequest.latest;
    if (failure === "network") xhr.onerror?.();
    else if (failure === "timeout") xhr.ontimeout?.();
    else {
      if (failure === "invalid") xhr.responseText = "not json";
      if (failure === "target")
        xhr.responseText = JSON.stringify({
          ...attachmentFixture(),
          conversationId: attachmentFixture().projectId,
        });
      if (failure === "redirect") xhr.responseURL = "https://other.test/api";
      if (failure === "forbidden") {
        xhr.status = 403;
        xhr.responseText = JSON.stringify({
          error: { code: "FORBIDDEN", message: "Denied", details: {} },
        });
      }
      xhr.onload?.();
    }
    await checked;
  },
);
it("cancels transport on abort and rejects an already aborted request", async () => {
  const controller = new AbortController();
  const result = uploadFile(target, file, "id", controller.signal, vi.fn());
  const checked = expect(result).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await checked;
  expect(UploadRequest.latest.abort).toHaveBeenCalledOnce();
  await expect(uploadFile(target, file, "id", controller.signal, vi.fn())).rejects.toMatchObject({
    name: "AbortError",
  });
});
it("invalidates the session on 401 and tracks uploads in cancelAll", async () => {
  const unauthorized = vi.fn();
  const client = new ApiClient(fetch, unauthorized);
  const previous = UploadRequest.latest;
  const result = client.upload(target, file, "id", vi.fn(), new AbortController().signal);
  const checked = expect(result).rejects.toMatchObject({ status: 401 });
  await vi.waitFor(() => expect(UploadRequest.latest).not.toBe(previous));
  UploadRequest.latest.status = 401;
  UploadRequest.latest.responseText = "unauthorized";
  UploadRequest.latest.onload?.();
  await checked;
  expect(unauthorized).toHaveBeenCalledOnce();
  const canceled = client.upload(target, file, "id", vi.fn(), new AbortController().signal);
  const canceledCheck = expect(canceled).rejects.toMatchObject({ name: "AbortError" });
  client.cancelAll();
  await canceledCheck;
});
it("validates empty, over-limit and active filenames, treating MIME as a declaration", () => {
  expect(validateFile(new File([], "empty.bin"))).toContain("non-empty");
  const huge = new File(["x"], "huge.bin");
  Object.defineProperty(huge, "size", { value: 101 * 1024 * 1024 });
  expect(validateFile(huge)).toContain("100 MiB");
  expect(validateFile(new File(["x"], "photo.svg.png"))).toContain("active");
  expect(validateFile(new File(["x"], "weights.pkl"))).toBeNull();
});
