import { cp } from "node:fs/promises";

const web = new URL("../apps/web/", import.meta.url);
const runtime = new URL(".next/standalone/apps/web/", web);
await cp(new URL(".next/static/", web), new URL(".next/static/", runtime), { recursive: true });
await cp(new URL("public/", web), new URL("public/", runtime), { recursive: true });
