import {
  createSessionBodySchema,
  deleteSessionResponseSchema,
  sessionResponseSchema,
  type SessionResponse,
} from "@cce/api-contracts";
import { shallowRef, type ShallowRef } from "vue";
import { ApiClient, ApiError } from "./api-client";

export interface Session {
  user: ShallowRef<SessionResponse["user"] | null>;
  ready: ShallowRef<boolean>;
  client: ApiClient;
  bootstrap: () => Promise<void>;
  login: (apiToken: string) => Promise<void>;
  logout: () => Promise<void>;
}

export function createSession(transport: typeof fetch = fetch): Session {
  const user = shallowRef<SessionResponse["user"] | null>(null);
  const ready = shallowRef(false);
  let generation = 0;
  let bootstrapRequest: Promise<void> | undefined;
  const invalidate = (): void => {
    generation++;
    user.value = null;
    ready.value = true;
    client.cancelAll();
  };
  const client = new ApiClient(transport, invalidate);
  const bootstrap = (): Promise<void> => {
    if (ready.value) return Promise.resolve();
    if (bootstrapRequest) return bootstrapRequest;
    const current = generation;
    bootstrapRequest = client
      .json("/api/session", sessionResponseSchema)
      .then((session) => {
        if (current === generation) {
          user.value = session.user;
          ready.value = true;
        }
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          ready.value = true;
          return;
        }
        throw error;
      })
      .finally(() => {
        bootstrapRequest = undefined;
      });
    return bootstrapRequest;
  };
  const login = async (apiToken: string): Promise<void> => {
    const body = createSessionBodySchema.parse({ apiToken });
    invalidate();
    const current = generation;
    const session = await client.json("/api/session", sessionResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (current === generation) user.value = session.user;
  };
  const logout = async (): Promise<void> => {
    invalidate();
    await client.json("/api/session", deleteSessionResponseSchema, { method: "DELETE" });
  };
  return { user, ready, client, bootstrap, login, logout };
}
