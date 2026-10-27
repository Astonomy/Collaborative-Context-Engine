import { vueShell } from "../../../server/vue-shell";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return vueShell(request);
}
