# ADR 0006: Pin ESLint 9 for the current Next.js toolchain

- Status: Accepted
- Date: 2026-08-23

## Context

CCE treats lint as a zero-warning correctness gate. The repository uses the type-aware
typescript-eslint configuration and the Next.js 16 Core Web Vitals/TypeScript configurations. At the
time of this baseline, the selected Next.js ESLint plugin graph declares peer compatibility with ESLint
9 but not ESLint 10.

Installing ESLint 10 would therefore require ignoring or overriding peer contracts. That would make
local and CI dependency resolution disagree with the supported combination and could hide rule/runtime
incompatibilities. Choosing the latest major independently is less valuable than a reproducible,
supported lint gate.

## Decision

Pin `eslint` and `@eslint/js` to 9.39.5. Keep `eslint-config-next` and typescript-eslint pinned through
the lockfile, install with `--frozen-lockfile`, and fail on every lint warning. Do not use
`--legacy-peer-deps`, forced peer overrides, or broad rule disables to adopt ESLint 10 prematurely.

This is a compatibility pin, not a permanent rejection of ESLint 10. Security fixes on the supported
ESLint 9 line may be adopted with an intentional lockfile update and the full quality gate.

## Revisit when

Upgrade the complete lint stack together after the selected Next.js and typescript-eslint releases
declare ESLint 10 support. The upgrade must pass frozen installation, formatting, type-aware lint,
typecheck, unit/coverage, integration, E2E, and production build without peer overrides.
