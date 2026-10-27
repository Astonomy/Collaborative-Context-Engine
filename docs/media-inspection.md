# S3 media inspection backend

`GET /api/projects/{projectId}/attachments/{attachmentId}/inspection` returns an
authenticated, noncached, read-only inspection view. It uses the existing
project-scoped AttachmentService authorization and availability checks before
opening the original object. It does not create a processing job, mutate canonical
Attachment metadata, append semantic state, or generate a derivative file.
Its `status` describes this request, independently of persisted attachment events.

The response contains `filename`, `byteSize`, `downloadable`, `status`, `error`,
and `description`. Description contains MIME, MIME validation level, allowlisted
metadata, preview capability, thumbnail availability and poster strategy.
It never returns storage identities, raw EXIF, glTF JSON, URIs, or exception text.

| Source                                                    | Metadata / capability                                                        | Limitations and fallback                                                                                                                                                                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PNG, GIF, JPEG (baseline/extended/progressive frames)     | Header-validated MIME, width, height; `image-original`                       | No pixel decode or thumbnail generation. Invalid/oversized headers fail to download fallback. JPEG dimensions must occur within the prefix.                                                                                           |
| MP4 with supported ISO base-media brands                  | Header-validated MIME, `format: mp4`; `video-stream`, `poster: client-frame` | No codec dependency; duration and dimensions omitted. Poster strategy means an authorized client may capture a frame after playback, not an existing poster. Original bytes remain on the existing Range-capable `/content` endpoint. |
| GLB v2 / glTF 2.0                                         | Format and MIME; `3d-isolated` capability                                    | GLB JSON chunk or full glTF JSON must fit in 64 KiB. Format identification is not full mesh validation or a promise that rendering succeeds.                                                                                          |
| `.onnx`, `.safetensors`, `.pt`, `.pth`, `.pkl`, `.pickle` | `unverified-{extension}` format hint, octet-stream, download                 | Filename hint only. Never deserialize tensors, pickle, protobuf, or uploaded code.                                                                                                                                                    |
| Other or unsupported files                                | Filename, size, octet-stream, download                                       | No inline execution; no automatic fallback to a model runtime.                                                                                                                                                                        |

`mimeValidation: header` means signature and the required structural header fields
were checked against bytes, independently of filename and declared MIME. It is
not a complete-file validation or malware verdict. `unknown` always retains a
generic MIME. All capabilities concern untrusted content and grant no access on
their own. `downloadable: true` describes the fallback route, not a guarantee that
storage or authorization will still be available on a subsequent download.

`3d-isolated` is a descriptor for a future isolated renderer, not an instruction
to load an asset automatically. Such a renderer must prohibit external resource
requests, embedded scripts/custom executable extensions, and model execution,
and apply its own geometry/texture/runtime budgets. S3 never follows a glTF URI,
loads a mesh/texture, fetches a URL, or executes anything in server or browser.
No UI or renderer is added here.

## Resource and failure policy

- Read only the first 64 KiB using a storage range. Do not read the entire video/model.
- At most 65,536 stream chunks per request, preventing an endless empty-chunk loop.
- Two-second processing response deadline after initial authorization; at most four
  outstanding inspections per service instance. The deadline bounds response time,
  not cancellation of an already outstanding storage system call. Timed-out I/O
  retains its slot until completion, then closes its iterator. A stuck storage
  backend therefore yields `busy` rather than accumulating unbounded work.
- Parser CPU work is bounded by prefix size, forward-only scans and JSON nesting
  of at most 32. No decompression, codecs, subprocesses, or model runtimes.
- Image dimensions must each be at most 16,384, and at most 40 million pixels.
  These are header limits; clients must still handle decoding failures.
- Parser/storage failures yield `failed / inspection-failed`; deadline and capacity
  yield `failed / timeout` or `failed / busy`. No internal error text is returned.
  Authorization, missing-object and availability failures keep the existing HTTP
  error semantics. The original Attachment and streaming endpoint are unchanged.

## Dependency and deployment boundary

The application `MediaInspector` port and `MediaProcessingService` have no Node
parser imports. Browser consumers import the result schema/types from
`@cce/application/media-inspection`, not the application root barrel.
The adapter is `@cce/storage/media-server`, a separate Node export with
`browser: null`. It is not re-exported by a browser-safe entry point. Only the
server composition root creates `HeaderMediaInspector` and injects it into the
application service. No browser polyfills or new external dependencies are used.

Deployment uses the existing private local attachment storage configuration and
Node runtime. No ffmpeg, image framework, worker daemon, migration or new
environment variables are required. There is no persistent cache or generated
thumbnail object to back up or clean up.

## Validation

Adapter tests cover dimensions, signature handling, truncated/malformed input,
model format identification and generic fallback. Application tests cover bounded
ranges, authorization, failures, invalid adapter output, timeouts, concurrency and
unchanged evidence with real local storage. HTTP tests verify authentication,
scoping and the response contract. The browser-boundary regression traverses
runtime imports from every `use client` entry and the inspection contract, follows
workspace barrels, rejects Node builtins and unreviewed dependencies, and tests
transitive `node:zlib`, `node:fs`, `node:buffer` and server-adapter regressions.
The production build additionally validates third-party browser dependencies.
