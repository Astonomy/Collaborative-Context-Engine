import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { readAuthorizationHeader } from "./cce-auth-headers.mjs";

// The input is an explicitly authorized invocation capture, never a transcript discovery path.
export async function uploadAttachments(
  capture,
  { environment = process.env, fetcher = fetch } = {},
) {
  const base = new URL(environment.CCE_API_URL ?? "http://localhost:3001");
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/" ||
    (base.protocol !== "https:" &&
      !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))
  )
    throw new Error("CCE_API_URL must be an HTTPS origin or a loopback HTTP origin.");
  if (
    !capture ||
    !/^[0-9a-f-]{36}$/iu.test(capture.projectId ?? "") ||
    !Array.isArray(capture.messages)
  )
    throw new Error("An authorized capture with projectId and messages is required.");
  const authorization = readAuthorizationHeader(environment);
  const messages = [];
  for (const message of capture.messages) {
    const { localAttachments = [], ...source } = message;
    if (!Array.isArray(localAttachments)) throw new Error("localAttachments must be an array.");
    const attachmentIds = [...(source.attachmentIds ?? [])];
    for (const file of localAttachments) {
      if (
        typeof file.path !== "string" ||
        typeof file.mimeType !== "string" ||
        !/^[0-9a-f-]{36}$/iu.test(file.uploadId ?? "")
      )
        throw new Error("Each authorized file requires path, mimeType and a stable uploadId.");
      const info = await stat(file.path);
      if (!info.isFile() || info.size === 0 || info.size > 100 * 1024 * 1024)
        throw new Error("Attachment must be a non-empty file no larger than 100 MiB.");
      const bytes = await readFile(file.path);
      const response = await fetcher(
        new URL(`/api/projects/${capture.projectId}/imports/attachments`, base),
        {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: authorization,
            "content-type": file.mimeType,
            "x-cce-filename": encodeURIComponent(basename(file.path)),
            "x-cce-upload-id": file.uploadId,
          },
          body: bytes,
        },
      );
      if (!response.ok)
        throw new Error(
          `CCE attachment upload failed (HTTP ${response.status}). No conversation submitted.`,
        );
      const uploaded = await response.json();
      if (!/^[0-9a-f-]{36}$/iu.test(uploaded.attachmentId ?? ""))
        throw new Error("CCE returned an invalid attachment ID.");
      attachmentIds.push(uploaded.attachmentId);
    }
    messages.push({ ...source, ...(attachmentIds.length ? { attachmentIds } : {}) });
  }
  return { ...capture, messages };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv[2]) throw new Error("Pass the explicitly authorized capture JSON path.");
    const capture = JSON.parse(await readFile(process.argv[2], "utf8"));
    process.stdout.write(JSON.stringify(await uploadAttachments(capture)));
  } catch {
    process.stderr.write(
      "CCE attachment upload failed; no conversation submitted. Check the input, environment and API status.\n",
    );
    process.exitCode = 1;
  }
}
