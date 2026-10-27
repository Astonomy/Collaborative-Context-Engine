import { createApplicationRuntime, type ApplicationRuntime } from "@cce/server-runtime";
import { z } from "zod";
import { SessionCookieCodec } from "./session-cookie";

const httpEnvironmentSchema = z.object({
  CCE_SESSION_SECRET: z.string().min(32).max(4_096),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export interface ServerRuntime extends ApplicationRuntime {
  readonly sessionCookie: SessionCookieCodec;
  readonly secureCookies: boolean;
}

export function createServerRuntime(
  environment: Readonly<Record<string, string | undefined>>,
  workingDirectory = process.cwd(),
): ServerRuntime {
  const parsed = httpEnvironmentSchema.parse(environment);
  const sessionCookie = new SessionCookieCodec(parsed.CCE_SESSION_SECRET);
  return {
    ...createApplicationRuntime(environment, workingDirectory),
    sessionCookie,
    secureCookies: parsed.NODE_ENV === "production",
  };
}

let runtimeSingleton: ServerRuntime | undefined;

export function getServerRuntime(workingDirectory = process.cwd()): ServerRuntime {
  runtimeSingleton ??= createServerRuntime(process.env, workingDirectory);
  return runtimeSingleton;
}
