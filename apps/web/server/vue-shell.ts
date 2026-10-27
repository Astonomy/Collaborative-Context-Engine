import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function vueShell(
  request: Request,
  directory = join(process.cwd(), "public", "vue"),
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  // Missing assets must remain 404s, never a successful HTML response to a module request.
  if (pathname.startsWith("/vue/assets/") || pathname.split("/").at(-1)?.includes(".")) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const html = await readFile(join(directory, "index.html"), "utf8");
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return new Response("Browser assets unavailable. Build CCE before starting the server.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
