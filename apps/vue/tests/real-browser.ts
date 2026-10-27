import { expect, test as base } from "@playwright/test";

export { expect };
export const test = base.extend<{ browserEvidence: void }>({
  browserEvidence: [
    async ({ context }, use, testInfo) => {
      const network: string[] = [];
      const logs: string[] = [];
      const forbidden: string[] = [];
      context.on("request", (request) => {
        const url = new URL(request.url());
        network.push(`${request.method()} ${url.origin}${url.pathname}`);
        if (url.port === "3000") forbidden.push(request.url());
      });
      context.on("response", (response) => {
        network.push(`${response.status()} ${new URL(response.url()).pathname}`);
      });
      context.on("page", (page) => {
        page.on("console", (message) => logs.push(`${message.type()}: ${message.text()}`));
        page.on("pageerror", (error) => logs.push(error.stack ?? error.message));
      });
      try {
        await use();
      } finally {
        await testInfo.attach("network", { body: network.join("\n"), contentType: "text/plain" });
        await testInfo.attach("browser-logs", { body: logs.join("\n"), contentType: "text/plain" });
        expect(forbidden, "Browser requests must never reach Next.js :3000").toEqual([]);
      }
    },
    { auto: true },
  ],
});
