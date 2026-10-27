import { z } from "zod";

const baseSchema = z.string().regex(/^\/(?:[a-zA-Z0-9_-]+\/)*$/);

export function readBrowserConfig(input: Readonly<Record<string, unknown>>): { base: string } {
  return { base: baseSchema.parse(input["VITE_APP_BASE"] ?? "/vue/") };
}
