import { ApplicationError } from "@cce/application";
import { z } from "zod";

import { apiRoute } from "../../server/request";
import type { HttpServices } from "../../server/services";

const healthResponseSchema = z
  .object({
    status: z.literal("ok"),
    database: z.literal("available"),
  })
  .strict();

export function createHandlers(getRuntime: () => Pick<HttpServices, "pool">): {
  GET: () => Promise<Response>;
} {
  function GET(): Promise<Response> {
    return apiRoute(async () => {
      try {
        await getRuntime().pool.query("select 1 as healthy");
      } catch {
        throw new ApplicationError("DEPENDENCY_UNAVAILABLE", "Database health check failed.");
      }
      return Response.json(healthResponseSchema.parse({ status: "ok", database: "available" }), {
        headers: { "cache-control": "no-store" },
      });
    });
  }

  return { GET };
}
