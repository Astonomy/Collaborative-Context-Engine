pnpm install --frozen-lockfile
docker compose up -d --wait
pnpm --filter @cce/database migrate
pnpm --filter @cce/database seed
pnpm dev
