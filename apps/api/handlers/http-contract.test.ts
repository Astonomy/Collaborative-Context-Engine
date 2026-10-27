import {
  ApplicationError,
  ConversationService,
  ProjectService,
  SessionService,
  type ChatEvent,
} from "@cce/application";
import {
  apiErrorResponseSchema,
  conversationResponseSchema,
  messageResponseSchema,
  projectListResponseSchema,
  projectResponseSchema,
} from "@cce/api-contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { createStandaloneServer } from "../http-server";
import {
  createFixture,
  idsFrom,
  seedConversation,
  uuid,
} from "../../../tests/unit/application/fixtures";
import { SessionCookieCodec } from "../server/session-cookie";
import { createHandlers as projectHandlers } from "./projects/route";
import { createHandlers as projectDetailHandlers } from "./projects/[projectId]/route";
import { createHandlers as conversationHandlers } from "./projects/[projectId]/conversations/route";
import { createHandlers as conversationDetailHandlers } from "./projects/[projectId]/conversations/[conversationId]/route";
import { createHandlers as messageHandlers } from "./projects/[projectId]/conversations/[conversationId]/messages/route";
import { createHandlers as chatHandlers } from "./projects/[projectId]/conversations/[conversationId]/chat/route";
import { createHandlers as sessionHandlers } from "./session/route";
import { GET as nextProjects } from "../../web/app/api/projects/route";
import { GET as nextConversation } from "../../web/app/api/projects/[projectId]/conversations/[conversationId]/route";

// The reusable handler graph must load and execute without the Next runtime.
vi.mock("next/server", () => {
  throw new Error("Next runtime entered the HTTP contract");
});
vi.mock("../../web/server/runtime", () => ({ getWebRuntime: () => services }));
const token = "contract-test-api-token-at-least-24-characters";
function harness(role: "owner" | "viewer" = "owner") {
  const fixture = createFixture(role);
  fixture.unitOfWork.seedUser(fixture.user, fixture.hasher.sha256(token));
  const seeded = seedConversation(fixture);
  return {
    ...fixture,
    ...seeded,
    projects: new ProjectService(fixture.unitOfWork, idsFrom(100), fixture.clock),
    conversations: new ConversationService(fixture.unitOfWork, idsFrom(200), fixture.clock),
    sessions: new SessionService(fixture.unitOfWork, fixture.hasher),
    sessionCookie: new SessionCookieCodec("contract-session-secret-with-at-least-32-bytes"),
    secureCookies: true,
    attachments: { list: vi.fn().mockResolvedValue([]) },
  };
}
let services: ReturnType<typeof harness>;
beforeEach(() => {
  services = harness();
});
function request(
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${token}` },
) {
  return new Request("https://cce.example/api", {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function context(conversationId = services.conversation.id, projectId = services.project.id) {
  return { params: { projectId, conversationId } };
}
async function failure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const payload = apiErrorResponseSchema.parse(await response.json());
  expect(payload.error.code).toBe(code);
  expect(payload.error.details?.["requestId"]).toBe(response.headers.get("x-request-id"));
}

describe("framework-neutral project/conversation HTTP contract", () => {
  it("rechecks downgraded membership despite the existing cookie and forged owner headers", async () => {
    const cookie = `cce_session=${services.sessionCookie.seal(token)}`;
    const handlers = conversationHandlers(() => services);
    const params = { params: { projectId: services.project.id } };
    expect((await handlers.POST(request("POST", { title: "Allowed" }), params)).status).toBe(201);
    await services.unitOfWork.run((repositories) =>
      repositories.projects.updateMemberRole({ ...services.member, role: "viewer" }),
    );
    for (const credential of [{ authorization: `Bearer ${token}` }, { cookie }]) {
      await failure(
        await handlers.POST(
          request(
            "POST",
            { title: "Denied" },
            {
              ...credential,
              origin: "https://cce.example",
              "x-cce-role": "owner",
              "x-cce-actor": uuid(999),
              "x-cce-approval": "approved",
            },
          ),
          params,
        ),
        403,
        "FORBIDDEN",
      );
    }
  });
  it("serves the same validated API to a standard fetch client and Next adapters", async () => {
    const direct = await projectHandlers(() => services).GET(request());
    const next = await nextProjects(request());
    expect(direct.status).toBe(200);
    expect(projectListResponseSchema.parse(await direct.json())).toEqual(await next.json());
    const plain = await conversationDetailHandlers(() => services).GET(request(), context());
    const adapted = await nextConversation(request(), {
      params: Promise.resolve(context().params),
    });
    expect(conversationResponseSchema.parse(await plain.json())).toEqual(await adapted.json());
  });
  it("creates a project and conversation through the existing use cases", async () => {
    const created = await projectHandlers(() => services).POST(
      request("POST", { name: "New project" }),
    );
    expect(created.status).toBe(201);
    const project = projectResponseSchema.parse(await created.json());
    expect(
      services.unitOfWork
        .view()
        .commits.some((c) => c.projectId === project.id && c.kind === "genesis"),
    ).toBe(true);
    const conversation = await conversationHandlers(() => services).POST(
      request("POST", { title: "New conversation" }),
      { params: { projectId: project.id } },
    );
    expect(conversation.status).toBe(201);
    expect(conversationResponseSchema.parse(await conversation.json()).projectId).toBe(project.id);
  });
  it("authenticates before validating a malformed body", async () => {
    await failure(
      await projectHandlers(() => services).POST(request("POST", {}, {})),
      401,
      "UNAUTHENTICATED",
    );
    await failure(
      await projectHandlers(() => services).POST(request("POST", {})),
      400,
      "VALIDATION",
    );
  });
  it("enforces actual application RBAC and object scope", async () => {
    services = harness("viewer");
    await failure(
      await conversationHandlers(() => services).POST(request("POST", { title: "Denied" }), {
        params: { projectId: services.project.id },
      }),
      403,
      "FORBIDDEN",
    );
    const other = await services.projects.create({ name: "Other", actorUserId: services.user.id });
    await failure(
      await conversationDetailHandlers(() => services).GET(
        request(),
        context(services.conversation.id, other.id),
      ),
      404,
      "NOT_FOUND",
    );
  });
  it("preserves unknown-resource and archived-conversation conflict responses", async () => {
    const handlers = conversationDetailHandlers(() => services);
    await failure(
      await handlers.GET(request(), { params: { ...context().params, conversationId: uuid(999) } }),
      404,
      "NOT_FOUND",
    );
    expect((await handlers.PATCH(request("PATCH", { archive: true }), context())).status).toBe(200);
    await failure(
      await handlers.PATCH(request("PATCH", { title: "Changed" }), context()),
      409,
      "CONFLICT",
    );
  });
  it("retains idempotent message writes and rejects conflicting retries without appending", async () => {
    const handlers = messageHandlers(() => services);
    const body = { clientMessageId: uuid(900), content: "Stable evidence" };
    const first = await handlers.POST(request("POST", body), context());
    expect(first.status).toBe(201);
    const message = messageResponseSchema.parse(await first.json());
    const retry = await handlers.POST(request("POST", body), context());
    expect(messageResponseSchema.parse(await retry.json()).id).toBe(message.id);
    await failure(
      await handlers.POST(request("POST", { ...body, content: "Different evidence" }), context()),
      409,
      "CONFLICT",
    );
    expect(
      services.unitOfWork.view().messages.filter((m) => m.clientMessageId === body.clientMessageId),
    ).toHaveLength(1);
  });
  it("preserves project validation and request headers", async () => {
    const response = await projectDetailHandlers(() => services).GET(request(), {
      params: { projectId: "invalid" },
    });
    await failure(response, 400, "VALIDATION");
  });
});

describe("authentication and session wire compatibility", () => {
  it("sets and clears the same encrypted, secure, strict, eight-hour cookie", async () => {
    const handlers = sessionHandlers(() => services);
    const login = await handlers.POST(
      request("POST", { apiToken: token }, { origin: "https://cce.example" }),
    );
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie") ?? "";
    for (const attribute of [
      "cce_session=v1.",
      "Path=/",
      "Max-Age=28800",
      "HttpOnly",
      "Secure",
      "SameSite=strict",
    ])
      expect(cookie).toContain(attribute);
    const cookiePair = cookie.split(";")[0] ?? "";
    expect((await handlers.GET(request("GET", undefined, { cookie: cookiePair }))).status).toBe(
      200,
    );
    const logout = await handlers.DELETE(
      request("DELETE", undefined, { origin: "https://cce.example" }),
    );
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("requires matching Origin for cookie mutations but retains bearer precedence", async () => {
    const cookie = `cce_session=${services.sessionCookie.seal(token)}`;
    const handlers = projectHandlers(() => services);
    await failure(
      await handlers.POST(request("POST", { name: "Denied" }, { cookie })),
      403,
      "FORBIDDEN",
    );
    expect(
      (
        await handlers.POST(
          request("POST", { name: "Allowed" }, { cookie, origin: "https://cce.example" }),
        )
      ).status,
    ).toBe(201);
    await failure(
      await handlers.GET(request("GET", undefined, { cookie, authorization: "Basic invalid" })),
      401,
      "UNAUTHENTICATED",
    );
    expect(
      (
        await handlers.POST(
          request(
            "POST",
            { name: "Bearer" },
            { cookie: "cce_session=invalid", authorization: `Bearer ${token}` },
          ),
        )
      ).status,
    ).toBe(201);
  });
  it("rejects expired and malformed cookies", async () => {
    for (const value of [services.sessionCookie.seal(token, 1), "invalid", "%ZZ"]) {
      await failure(
        await projectHandlers(() => services).GET(
          request("GET", undefined, { cookie: `cce_session=${value}` }),
        ),
        401,
        "UNAUTHENTICATED",
      );
    }
  });
});

describe("POST SSE contract", () => {
  const body = { clientMessageId: uuid(901), content: "Hello" };
  it("serves ordered SSE and rejects unauthenticated requests over standalone HTTP with Next unavailable", async () => {
    const chat = {
      async *chat(): AsyncIterable<ChatEvent> {
        yield { type: "text_delta", text: "one" };
        throw new ApplicationError("DEPENDENCY_UNAVAILABLE", "Model unavailable");
      },
    };
    const handlers = chatHandlers(() => ({ ...services, chat }));
    const server = createStandaloneServer((request) => handlers.POST(request, context()));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing listener");
      const url = `http://127.0.0.1:${address.port}/api/chat`;
      const init = { method: "POST", body: JSON.stringify(body) };
      const denied = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
      expect(denied.status).toBe(401);
      const response = await fetch(url, {
        ...init,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
      });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toMatch(/^event: text_delta\n/);
      expect(text).toContain('event: error\ndata: {"error":{"code":"DEPENDENCY_UNAVAILABLE"');
    } finally {
      await server.shutdown();
    }
  });
  it("retains event framing, order, cache headers and closes the iterator", async () => {
    const closed = vi.fn();
    const chat = {
      async *chat(): AsyncIterable<ChatEvent> {
        try {
          yield { type: "text_delta", text: "one" };
          yield { type: "text_delta", text: "two" };
        } finally {
          closed();
        }
      },
    };
    const response = await chatHandlers(() => ({ ...services, chat })).POST(
      request("POST", body),
      context(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(await response.text()).toBe(
      'event: text_delta\ndata: {"type":"text_delta","text":"one"}\n\nevent: text_delta\ndata: {"type":"text_delta","text":"two"}\n\n',
    );
    expect(closed).toHaveBeenCalledOnce();
  });
  it("keeps pre-first-event failure as JSON and post-first-event failure as an SSE error", async () => {
    const error = new ApplicationError("FORBIDDEN", "Denied");
    const before = {
      async *chat(): AsyncIterable<ChatEvent> {
        throw error;
      },
    };
    await failure(
      await chatHandlers(() => ({ ...services, chat: before })).POST(
        request("POST", body),
        context(),
      ),
      403,
      "FORBIDDEN",
    );
    const after = {
      async *chat(): AsyncIterable<ChatEvent> {
        yield { type: "text_delta", text: "one" };
        throw error;
      },
    };
    const response = await chatHandlers(() => ({ ...services, chat: after })).POST(
      request("POST", body),
      context(),
    );
    const text = await response.text();
    expect(text).toContain('event: error\ndata: {"error":{"code":"FORBIDDEN"');
    expect(text).toContain(response.headers.get("x-request-id"));
  });
  it("propagates consumer cancellation to the use case and closes it once", async () => {
    const closed = vi.fn();
    let observed: AbortSignal | undefined;
    const chat = {
      async *chat(input: { signal?: AbortSignal }): AsyncIterable<ChatEvent> {
        observed = input.signal;
        try {
          yield { type: "text_delta", text: "one" };
          await new Promise<void>((resolve) =>
            input.signal?.addEventListener("abort", () => resolve(), { once: true }),
          );
        } finally {
          closed();
        }
      },
    };
    const response = await chatHandlers(() => ({ ...services, chat })).POST(
      request("POST", body),
      context(),
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    await reader?.read();
    await reader?.cancel();
    expect(observed?.aborted).toBe(true);
    expect(closed).toHaveBeenCalledOnce();
  });
});
