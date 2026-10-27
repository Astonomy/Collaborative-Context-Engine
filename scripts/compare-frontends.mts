import { chromium } from "@playwright/test";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { ids, now, user, project, member, conversation } from "../apps/vue/src/migration-fixtures";
import { messageListResponseSchema } from "@cce/api-contracts";

const browser = await chromium.launch();
const samples: unknown[] = [];
try {
  for (const frontend of ["next", "vue"]) {
    for (const count of [0, 20, 1000]) {
      const messages = messageListResponseSchema.parse(
        Array.from({ length: count }, (_, index) => ({
          id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
          clientMessageId: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
          projectId: ids.project,
          conversationId: ids.conversation,
          sequence: index + 1,
          role: "user",
          content: `Audit ${index} ${"x".repeat(200)}`,
          author: { type: "human", userId: ids.user },
          providerMessageId: null,
          errorCode: null,
          completedAt: now,
          deliveryState: "completed",
          createdAt: now,
        })),
      );
      for (let run = 0; run < 5; run++) {
        console.log(frontend, count, run);
        const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
        const page = await context.newPage();
        await page.addInitScript(
          ({ count, frontend }) => {
            const observer = new MutationObserver(() => {
              const ready = count
                ? document.querySelectorAll(".message").length ===
                  (frontend === "vue" ? Math.min(count, 100) : count)
                : [...document.querySelectorAll("button")].some(
                    (button) =>
                      button.textContent?.trim() ===
                      (frontend === "vue" ? "Sign in" : "Continue securely"),
                  );
              if (!ready) return;
              observer.disconnect();
              requestAnimationFrame(() =>
                requestAnimationFrame(() => performance.mark("s8-application-render")),
              );
            });
            observer.observe(document, { childList: true, subtree: true });
          },
          { count, frontend },
        );
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/api/**", async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const path = new URL(route.request().url()).pathname;
          if (path === "/api/session")
            return route.fulfill({
              status: count ? 200 : 401,
              json: count
                ? { user }
                : {
                    error: { code: "UNAUTHENTICATED", message: "Sign in", requestId: "benchmark" },
                  },
            });
          let json: unknown;
          if (path === "/api/projects") json = [{ project, member }];
          else if (path === `/api/projects/${ids.project}`) json = { project, member };
          else if (path.endsWith("/conversations")) json = [conversation];
          else if (path.endsWith(`/conversations/${ids.conversation}`)) json = conversation;
          else if (path.endsWith("/messages")) json = messages;
          else if (path.endsWith("/context")) json = { commitId: ids.genesis, items: [] };
          else if (/\/(attachments|commits|merge-requests)$/.test(path)) json = [];
          else throw new Error(`Unhandled benchmark route: ${path}`);
          await route.fulfill({ json });
        });
        const base = frontend === "next" ? "http://127.0.0.1:3107" : "http://127.0.0.1:4173";
        const path =
          frontend === "next"
            ? "/legacy"
            : count
              ? `/vue/projects/${ids.project}/conversations/${ids.conversation}`
              : "/vue/projects";
        await page.goto(base + path);
        if (count)
          await page
            .locator(".message")
            .last()
            .waitFor()
            .catch(async (error: unknown) => {
              console.error(await page.locator("body").innerText(), errors);
              throw error;
            });
        else
          await page
            .getByRole("button", {
              name: frontend === "next" ? "Continue securely" : "Sign in",
              exact: true,
            })
            .waitFor();
        const readyMs = await page.evaluate(() => performance.now());
        await page.waitForFunction(
          () => performance.getEntriesByName("s8-application-render").length > 0,
        );
        const client = await context.newCDPSession(page);
        await client.send("HeapProfiler.collectGarbage");
        const heap = await client.send("Runtime.getHeapUsage");
        const dom = await client.send("Memory.getDOMCounters");
        const timing = await page.evaluate(() => ({
          firstApplicationRenderMs:
            performance.getEntriesByName("s8-application-render")[0]?.startTime,
          fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime,
          resources: performance.getEntriesByType("resource").map((entry) => ({
            url: entry.name,
            start: entry.startTime,
            duration: entry.duration,
          })),
          elements: document.querySelectorAll("*").length,
          messages: document.querySelectorAll(".message").length,
        }));
        if (count) {
          if (frontend === "vue")
            await page.getByRole("link", { name: "Context", exact: true }).click();
          else await page.getByRole("button", { name: "Canonical context", exact: true }).click();
          await page.getByRole("heading", { name: "Canonical context", exact: true }).waitFor();
          await page.getByText(/No canonical items yet/).waitFor();
        } else await page.goto("about:blank");
        await client.send("HeapProfiler.collectGarbage");
        const afterHeap = await client.send("Runtime.getHeapUsage");
        samples.push({ frontend, count, run, readyMs, heap, dom, afterHeap, ...timing, errors });
        await context.close();
      }
    }
  }
  async function chunks(
    directory: string,
  ): Promise<{ file: string; bytes: number; gzip9: number }[]> {
    const result = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) result.push(...(await chunks(path)));
      else if (entry.name.endsWith(".js")) {
        const bytes = await readFile(path);
        result.push({
          file: path.replaceAll("\\", "/"),
          bytes: bytes.length,
          gzip9: gzipSync(bytes, { level: 9 }).length,
        });
      }
    }
    return result;
  }
  const next = await chunks("apps/web/.next/static");
  const vue = await chunks("apps/vue/dist/assets");
  const html = await readFile("apps/web/.next/server/app/index.html", "utf8");
  const htmlScripts = [
    ...new Set(
      [...html.matchAll(/<script[^>]*src="([^"]+\.js)"[^>]*>/g)].map((match) => ({
        url: match[1],
        nomodule: /nomodule/i.test(match[0]),
      })),
    ),
  ];
  await mkdir("docs/verification", { recursive: true });
  await writeFile(
    "docs/verification/s8-performance.json",
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        node: process.version,
        browser: browser.version(),
        apiDelayMs: 100,
        samples,
        next,
        vue,
        htmlScripts,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
