import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const generatedDirectories = ["coverage", "playwright-report", "test-results"];

await Promise.all(
  generatedDirectories.map((directory) =>
    rm(resolve(process.cwd(), directory), { recursive: true, force: true }),
  ),
);

