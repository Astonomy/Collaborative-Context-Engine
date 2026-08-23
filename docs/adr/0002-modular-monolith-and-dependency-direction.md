# ADR 0002: Modular monolith and dependency direction

- Status: Accepted
- Date: 2026-08-23

## Decision

Build one deployable Next.js application with independently tested workspace packages:

```text
apps/web -> application -> domain
                         -> context-engine -> domain
database -> application ports
model-provider -> application ports
agents -> application use cases
```

Transport code owns HTTP/cookies/SSE. Application owns use cases, RBAC, idempotency, ports, and transaction boundaries. Domain owns invariants. Context Engine owns pure semantic algorithms. Infrastructure implements inward-facing ports.

No microservice, event bus, cache, graph database, standalone vector database, or general Agent framework is introduced for the MVP.

## Rationale

This preserves testable boundaries and provider independence without paying distributed-system costs. A package is a code boundary, not a deployment boundary.

## Revisit when

Measured scaling, fault-isolation, regulatory, or ownership requirements require an independently deployable component.
