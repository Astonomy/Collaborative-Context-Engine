import { ApplicationError } from "@cce/application";
import { NextResponse } from "next/server";
import { z } from "zod";

import { apiRoute } from "../../../server/request";
import { getWebRuntime } from "../../../server/runtime";

export const dynamic = "force-dynamic";

const healthResponseSchema = z
  .object({
    status: z.literal("ok"),
    database: z.literal("available"),
  })
  .strict();

export function GET(): Promise<Response> {
  return apiRoute(async () => {
    try {
      await getWebRuntime().pool.query("select 1 as healthy");
    } catch {
      throw new ApplicationError("DEPENDENCY_UNAVAILABLE", "Database health check failed.");
    }
    return NextResponse.json(healthResponseSchema.parse({ status: "ok", database: "available" }), {
      headers: { "cache-control": "no-store" },
    });
  });
}
