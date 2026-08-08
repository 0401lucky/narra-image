ARG NODE_BASE_IMAGE=node:24-alpine
ARG GO_BASE_IMAGE=golang:1.25-alpine

FROM ${NODE_BASE_IMAGE} AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/narra_image?schema=public"
ENV AUTH_SECRET="docker-build-secret-4f2a1c9e7b6d5a0f8e3d2c1b0a9f8e7d"
ENV APP_URL="https://narra-build.invalid"
ENV BUILTIN_PROVIDER_BASE_URL="https://example.com/v1"
ENV BUILTIN_PROVIDER_API_KEY="docker-build-demo-key"

RUN pnpm build

FROM ${GO_BASE_IMAGE} AS worker-builder

WORKDIR /src/worker

COPY worker/go.mod worker/go.sum ./
RUN go mod download

COPY worker/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/narra-worker ./cmd/worker
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/narra-prompt-sync ./cmd/prompt-sync
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/narra-rollback-preflight ./cmd/rollback-preflight

FROM base AS runner

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/contracts ./contracts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=worker-builder /out/narra-worker ./narra-worker
COPY --from=worker-builder /out/narra-prompt-sync ./narra-prompt-sync
COPY --from=worker-builder /out/narra-rollback-preflight ./narra-rollback-preflight

EXPOSE 3000

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
  CMD wget -qO- http://127.0.0.1:3000/api/healthz >/dev/null || exit 1

CMD ["node", "scripts/start-prod.mjs"]
