# S7 Vue attachment presentation

The browser presentation layer is `src/attachments`. `rendererFor` uses the public
Attachment DTO and the runtime-validated S3 inspection capability to select an
ordered registry entry. Filename and declared MIME never enable a renderer.
`AttachmentRenderer` owns visibility, inspection and a local error boundary;
`FileCard` always preserves metadata and the authorized download action.

## Contract integration

- Upload uses the existing raw binary `POST /api/projects/{p}/conversations/{c}/attachments`
  with `X-CCE-Filename` and `X-CCE-Client-Message-Id`. It creates a new message;
  the UI does not imply that a file modifies an existing message or pending chat.
- The returned DTO is runtime validated and checked against the captured project
  and conversation. The refreshed server message list is joined by returned
  `messageId`, never by message position, role or text. Retrying the same selected
  file retains its client message ID, including after an ambiguous connection failure.
- Picker and drag/drop accept one file per upload. Size/active-filename validation,
  XHR byte progress, a distinct validating/saving state, server errors, cancellation
  and explicit retry are exposed. Server policy remains authoritative.
- Session invalidation, component disposal and target changes abort active uploads.
  Canceling a transport does not undo a completed server transaction.
- Inspection uses the existing `/attachments/{id}/inspection`; content uses
  `/attachments/{id}/content`. The local Zod projection matches the S3 response
  without importing the application runtime into the Vue browser graph.

**Existing contract limitation:** neither message DTOs nor a list endpoint expose
attachment bindings. This integration displays DTOs returned by uploads in the
current conversation view. Refreshing or leaving that view loses those in-memory
DTOs, although the server evidence remains persisted. Restoring historical
attachment cards requires upstream DTO discovery. No IDs are inferred from message
text and no new backend endpoint, database schema, or browser persistence is added.
The existing MessageList attachment slot can receive canonical DTOs when provided.

## Render and fallback behavior

| Media                      | Rendering                                                                                                                                           | Fallback and loading policy                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image                      | PNG/JPEG/GIF with `image-original` and header-validated dimensions; native image, natural aspect ratio, alt text, keyboard button and modal preview | S3 has no derivative thumbnails. Only originals at most 256 KiB and one million pixels are used as small list images after visibility. Larger images show a placeholder and fetch only on click. Preview caps are 20 MiB / 40 million pixels. Unsupported, oversized or failed images retain the file card.                                                                                                                                                          |
| Video                      | `video-stream` MP4; native controls, keyboard focus, playsinline and direct authenticated Range-capable URL                                         | No video element/source before click, no autoplay, `preload=metadata` after click. Initial poster is a labelled placeholder because S3 supplies no poster asset. The first decoded client frame becomes a bounded JPEG poster when available. Close/unmount pauses and clears the source. Codec/read failures retain download.                                                                                                                                       |
| 3D                         | `3d-isolated` GLB v2 / self-contained glTF 2.0; interactive static wireframe, drag/arrow rotation, zoom and reset buttons                           | Viewer dynamic import and worker creation occur only after click. Parse in a disposable worker; render numeric triangles in canvas. At most 8 MiB input, 64 KiB JSON, 20,000 triangles, 256 node visits and bounded depth; two-second worker deadline. No external resources, extensions, skins, morph targets, sparse accessors or animation. Materials/textures are not rendered. Unsupported geometry, parser/worker/canvas/import failures retain the file card. |
| ML / non-previewable model | Filename, detected type, size and download; inspection format hints label a model card                                                              | Never deserialize or execute model weights, pickle, uploaded code or model runtimes. Large 3D assets also use a model metadata card.                                                                                                                                                                                                                                                                                                                                 |
| Generic                    | Escaped filename/type/size, file icon and download                                                                                                  | Missing/failed/unknown inspection stays generic. HTML/SVG are never rendered inline.                                                                                                                                                                                                                                                                                                                                                                                 |

Inspection starts on intersection, with a keyboard-accessible explicit check if
IntersectionObserver is unavailable. The existing 100-message page limit bounds
the list DOM. No model bytes, parser worker or viewer module loads merely because
a model appears in the list. Loading and local failure states do not take down the
conversation. Dialog Escape/close and media close restore focus to the trigger.

## Security and deployment

All uploaded text uses Vue interpolation; no `v-html`, uploaded markup, eval,
dynamic code import or external model URI resolution is used. Content paths derive
from validated IDs, not filenames or uploaded URLs. Downloads remain on the
existing server-authorized, inert content endpoint. Image reads enforce actual
byte limits before making an allowlisted Blob. Image and poster object URLs are
revoked on disposal. Video uses streaming rather than a full-file Blob.

The worker accepts bytes only and returns bounded numeric geometry; it receives
no server/storage credentials or URLs and has no resource-loading implementation.
This is a parser execution boundary, not a claim that Web Workers have an opaque
origin. Unmount, error, timeout and completion terminate the parser worker.
Canvas drawing has no continuous animation loop or retained GPU resources.

No dependencies, migrations, storage configuration or Next UI changes are needed.
Deploy the emitted worker asset with the Vue build and allow same-origin workers
in any deployment CSP (`worker-src 'self'`). Images/posters require `img-src blob:`;
video requires same-origin media. Existing same-origin `/api` proxy/authentication
and byte-range handling remain required. No CDN viewer or storage secret is used.

## Verification

Commands from the repository root:

```text
pnpm --filter @cce/vue test:coverage
pnpm --filter @cce/vue typecheck
pnpm --filter @cce/vue lint
pnpm exec prettier --check apps/vue
pnpm --filter @cce/vue build
pnpm --filter @cce/vue test:media
```

For the same browser test against the production build, set
`CCE_VUE_MEDIA_PREVIEW=1` before `test:media`. This test uses the real Vue app and
Chromium with mocked fixed REST contracts, not a live storage/database service.
It covers scoped binary upload, correct message placement, actual PNG decoding,
MP4 Range requests and playback, client-frame poster, model lazy loading, worker
parsing, keyboard rotation, cleanup and inert ML-file behavior.

131 Vue tests pass. Configured TypeScript coverage (including attachment modules)
is 97.11% statements, 88.45% branches, 95.65% functions and 99.76% lines. SFC behavior
is covered by mounted component tests and Chromium. Backend PostgreSQL tests and
migrations are not rerun for this Vue-only change.

`src/attachments/fixtures.ts` contains representative PNG, glTF and GLB fixtures.
`tests/fixtures/preview.mp4` is an original one-second 64×48 solid-color test video,
generated with `ffmpeg -f lavfi -i color=c=teal:s=64x48:d=1 -c:v libx264
-pix_fmt yuv420p -movflags +faststart preview.mp4`; ffmpeg is not a runtime or test
dependency. The generic/ML fixture is inert text. Malicious resource references,
bad indices/bounds/chunks, extension payloads, graph cycles, limits, upload failures
and stale/unauthorized responses are exercised in unit tests.

## Bundle impact

Measured against the Vue build taken at the start of S7, using gzip level 9:

| Asset                | Raw bytes | gzip-9 bytes | When loaded              |
| -------------------- | --------: | -----------: | ------------------------ |
| Initial JS before S7 |   193,565 |       62,030 | App startup              |
| Initial JS after S7  |   195,776 |       62,885 | App startup              |
| Conversation route   |    19,967 |        7,005 | Conversation navigation  |
| Upload module        |     2,300 |        1,261 | Conversation/upload code |
| 3D viewer            |     3,668 |        1,859 | Explicit 3D preview      |
| Model parser worker  |    78,460 |       20,732 | Explicit 3D preview      |
| Current CSS          |     3,313 |        1,225 | App startup              |

Initial JS grows by 2,211 raw / **855 gzip bytes**. The viewer plus parser add
22,591 gzip bytes on demand; model content is additional and bounded separately.
No third-party viewer library is added. `dist/bundle-report.json` reports main
chunks; the worker is emitted as a separate asset, so its size above is measured
from the emitted file rather than omitted from the total preview cost.
