# syntax=docker/dockerfile:1.7
FROM node:24.19.0-bookworm-slim AS toolchain
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
WORKDIR /workspace
FROM toolchain AS dependency-cache
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch --frozen-lockfile
FROM toolchain AS dependencies
COPY --from=dependency-cache /pnpm/store /pnpm/store
COPY . .
RUN pnpm install --frozen-lockfile
FROM dependencies AS api-builder
RUN pnpm build:api
RUN pnpm --filter @cce/api deploy --legacy --prod /opt/cce-api
FROM dependencies AS frontend-builder
# These are public build parameters. No server env file or credentials are used.
ARG VITE_APP_BASE=/
ARG VITE_CCE_API_BASE_URL=
ENV VITE_APP_BASE=$VITE_APP_BASE
ENV VITE_CCE_API_BASE_URL=$VITE_CCE_API_BASE_URL
RUN pnpm build:frontend
FROM node:24.19.0-bookworm-slim AS api
LABEL org.opencontainers.image.title="CCE API"
LABEL org.opencontainers.image.licenses="Apache-2.0"
ENV NODE_ENV=production
ENV CCE_API_HOST=0.0.0.0
ENV CCE_API_PORT=3001
WORKDIR /workspace
COPY --from=api-builder /opt/cce-api ./
# Persistent volume is initialized with ownership for the unprivileged API user.
RUN mkdir -p /var/lib/cce/attachments && chown node:node /var/lib/cce/attachments
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
 CMD node -e "fetch('http://127.0.0.1:'+(process.env.CCE_API_PORT||'3001')+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
# Workspace exports currently use TypeScript; the existing tsx loader resolves them.
CMD ["node", "--import", "tsx", "dist/apps/api/main.js"]
FROM api AS migrator
HEALTHCHECK NONE
ENTRYPOINT ["node", "--import", "tsx", "node_modules/@cce/database/src/cli/migrate.ts"]
CMD []
FROM nginx:stable-alpine AS frontend
COPY deployment/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-builder /workspace/apps/vue/dist/index.html /usr/share/nginx/html/index.html
COPY --from=frontend-builder /workspace/apps/vue/dist/assets /usr/share/nginx/html/assets
COPY LICENSE /usr/share/nginx/html/LICENSE
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
 CMD wget -q -O /dev/null http://127.0.0.1/frontend-health || exit 1
# Historical target name now resolves to the independent API process.
FROM api AS runner
