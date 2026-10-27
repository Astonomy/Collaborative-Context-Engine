import { expect, it } from "vitest";
import { attachmentFixture, inspectionFixture } from "./fixtures";
import { formatBytes, rendererFor } from "./presentation";

it.each([
  ["image-original", "image"],
  ["video-stream", "video"],
  ["3d-isolated", "model"],
  ["download", "file"],
] as const)("selects %s from capability, not filename or declared MIME", (preview, kind) => {
  expect(
    rendererFor(
      attachmentFixture({ originalFilename: "misleading.exe", declaredMimeType: "text/html" }),
      inspectionFixture(preview),
    ),
  ).toBe(kind);
});
it("fails closed for absent/failed/mismatched inspection and active MIME", () => {
  const a = attachmentFixture();
  expect(rendererFor(a, null)).toBe("file");
  expect(rendererFor(a, { ...inspectionFixture(), status: "failed" })).toBe("file");
  expect(rendererFor(a, inspectionFixture("image-original", 100))).toBe("file");
  const svg = inspectionFixture();
  svg.description.mimeType = "image/svg+xml";
  expect(rendererFor(a, svg)).toBe("file");
  svg.description.mimeType = "image/png";
  svg.description.mimeValidation = "unknown";
  expect(rendererFor(a, svg)).toBe("file");
});
it("renders ML model metadata without execution and caps previews", () => {
  const ml = inspectionFixture("download");
  ml.description.metadata.format = "unverified-pkl";
  expect(rendererFor(attachmentFixture(), ml)).toBe("model-file");
  expect(
    rendererFor(
      attachmentFixture({ byteSize: 30_000_000 }),
      inspectionFixture("image-original", 30_000_000),
    ),
  ).toBe("file");
  expect(
    rendererFor(
      attachmentFixture({ byteSize: 30_000_000 }),
      inspectionFixture("3d-isolated", 30_000_000),
    ),
  ).toBe("model-file");
  expect([formatBytes(68), formatBytes(1024), formatBytes(1048576)]).toEqual([
    "68 B",
    "1.0 KiB",
    "1.0 MiB",
  ]);
});
