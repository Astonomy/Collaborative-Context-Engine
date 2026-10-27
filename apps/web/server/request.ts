import type { NextRequest } from "next/server";
import type { User } from "@cce/domain";
import { authenticateRequest as authenticate } from "../../api/server/request";
import { getWebRuntime } from "./runtime";
export * from "../../api/server/request";
export function authenticateRequest(request: NextRequest): Promise<User> {
  return authenticate(request, getWebRuntime());
}
