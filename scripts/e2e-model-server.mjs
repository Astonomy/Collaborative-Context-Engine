import { createServer } from "node:http";

const port = Number.parseInt(process.env.MODEL_E2E_PORT ?? "8000", 10);
const provider = "qwen-vllm";

function completion(model, content) {
  return {
    id: "cce-e2e-completion",
    provider,
    model,
    choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 6,
      prompt_tokens_details: { cached_tokens: 0 },
    },
  };
}

function structuredContent(body) {
  const name = body.response_format?.json_schema?.name;
  if (name === "context_delta_extraction") {
    const userMessage = [...body.messages].reverse().find((message) => message.role === "user");
    const input = JSON.parse(userMessage?.content ?? "{}");
    const evidenceMessage = input.messages?.[0];
    const evidenceMessageId = evidenceMessage?.id;
    const databaseEngine = /\bmysql\b/i.test(evidenceMessage?.content ?? "")
      ? "MySQL"
      : "PostgreSQL";
    return JSON.stringify({
      changes: [
        {
          operation: "add",
          proposal: {
            kind: "fact",
            key: "database.engine",
            value: databaseEngine,
            scope: { tags: ["database"] },
            confidence: 1,
            evidenceMessageIds: [evidenceMessageId],
          },
        },
      ],
    });
  }
  if (name === "cce_agent_specialty_selection") {
    return JSON.stringify({ specialty: "extractor", reason: "Deterministic E2E selection" });
  }
  if (name === "cce_agent_context_delta_draft") {
    return JSON.stringify({ changes: [] });
  }
  return JSON.stringify({ ok: true });
}

function canonicalDatabaseEngine(body) {
  const systemContent = body.messages?.find((message) => message.role === "system")?.content;
  if (typeof systemContent !== "string") {
    return null;
  }
  const contextStart = systemContent.indexOf("\n");
  if (contextStart < 0) {
    return null;
  }
  try {
    const context = JSON.parse(systemContent.slice(contextStart + 1));
    const item = context.facts?.find(
      (candidate) =>
        candidate.key === "database.engine" &&
        candidate.authority === "authoritative" &&
        candidate.lifecycle === "active",
    );
    return typeof item?.value === "string" ? item.value : null;
  } catch {
    return null;
  }
}

function writeSse(response, body) {
  const model = body.model;
  const databaseEngine = canonicalDatabaseEngine(body);
  const content =
    databaseEngine === null
      ? "No canonical database context was supplied."
      : `Canonical context includes ${databaseEngine}.`;
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
  });
  response.write(
    `data: ${JSON.stringify({
      id: "cce-e2e-stream",
      provider,
      model,
      choices: [{ delta: { content }, finish_reason: null }],
    })}\n\n`,
  );
  response.write(
    `data: ${JSON.stringify({
      id: "cce-e2e-stream",
      provider,
      model,
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 6,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Not found" } }));
    return;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_000_000) {
      response.writeHead(413);
      response.end();
      return;
    }
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (body.stream === true) {
      writeSse(response, body);
      return;
    }
    const content =
      body.response_format?.type === "json_schema"
        ? structuredContent(body)
        : "Deterministic E2E completion.";
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(completion(body.model, content)));
  } catch {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Invalid request" } }));
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`CCE deterministic model server listening on ${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
