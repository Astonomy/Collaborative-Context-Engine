# ADR 0001: Primary language and runtime

- Status: Accepted
- Date: 2026-08-23

## Context

CCE needs one maintainable implementation for a Next.js web application, REST/SSE API, domain model, deterministic merge engine, provider adapters, workflow orchestration, and tests. Model serving can already be isolated behind an OpenAI-compatible HTTP API.

The candidates were scored from 0–10 with the weights required by the project brief.

| Criterion                     |   Weight | TypeScript |   Python | TypeScript + Python |
| ----------------------------- | -------: | ---------: | -------: | ------------------: |
| CCE architecture fit          |      20% |        9.5 |      7.0 |                 8.5 |
| One language for Web/API/Core |      20% |       10.0 |      6.5 |                 3.0 |
| Type safety and refactoring   |      15% |        9.5 |      7.0 |                 8.5 |
| AI/provider ecosystem         |      15% |        8.5 |     10.0 |                10.0 |
| Testing ecosystem             |      10% |        9.5 |      9.0 |                 7.5 |
| Readability and maintenance   |      10% |        9.0 |      8.5 |                 6.5 |
| Deployment simplicity         |       5% |        9.0 |      8.0 |                 5.0 |
| Performance and scaling       |       5% |        8.5 |      7.5 |                 8.5 |
| **Weighted score**            | **100%** |   **9.33** | **7.78** |            **7.15** |

## Decision

Use strict TypeScript as the only CCE application language on Node.js 24 LTS. Use pnpm workspaces and Next.js for the Web/API adapter. Python may run Qwen/vLLM as a separate model-runtime process behind HTTP; it does not enter the core repository.

TypeScript 6.0.3 is pinned instead of the newer TypeScript 7 because the selected typescript-eslint release officially supports TypeScript only below 6.1. This is a deliberate compatibility choice rather than use of an unsupported latest compiler.

## Rejected alternatives

- Python would improve direct access to training/inference libraries, but CCE does not host model inference in its core and would lose the strongest single-language Web story and refactoring safety.
- A TypeScript/Python application split adds contracts, deployments, tracing, duplicated tooling, and cross-language changes without an MVP requirement.

## Revisit when

- CCE must execute model training/inference in-process rather than through a provider boundary.
- A required, production-critical library has no viable JavaScript API or service boundary.
- TypeScript tooling cannot meet measured correctness or throughput requirements.

## References

- [Node.js release policy](https://nodejs.org/en/about/previous-releases)
- [typescript-eslint supported TypeScript versions](https://typescript-eslint.io/users/dependency-versions/)
- [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16)
