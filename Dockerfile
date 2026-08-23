# syntax=docker/dockerfile:1.7

FROM node:24.19.0-bookworm-slim AS toolchain

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable && corepack prepare pnpm@11.22.0 --activate

WORKDIR /workspace

FROM toolchain AS dependency-cache

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch --frozen-lockfile

FROM toolchain AS builder

COPY --from=dependency-cache /pnpm/store /pnpm/store
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm build
RUN mkdir -p apps/web/public

# Build this target separately for a one-shot, release-scoped migration job:
# docker build --target migrator -t cce-migrator .
FROM builder AS migrator

ENV NODE_ENV=production
WORKDIR /workspace/packages/database
USER node
ENTRYPOINT ["node", "--import", "tsx", "./src/cli/migrate.ts"]

FROM node:24.19.0-bookworm-slim AS runner

LABEL org.opencontainers.image.title="Collaborative Context Engine"
LABEL org.opencontainers.image.licenses="Apache-2.0"

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

WORKDIR /app

COPY --from=builder --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /workspace/apps/web/public ./apps/web/public
COPY --from=builder --chown=node:node /workspace/LICENSE ./LICENSE

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'3000')+'/api/health').then(response=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
