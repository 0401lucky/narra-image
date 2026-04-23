FROM node:24-alpine AS base

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
ENV AUTH_SECRET="docker-build-secret-for-build-stage"
ENV APP_URL="http://localhost:3000"
ENV BUILTIN_PROVIDER_BASE_URL="https://example.com/v1"
ENV BUILTIN_PROVIDER_API_KEY="demo-key"

RUN pnpm build

FROM base AS runner

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000

CMD ["sh", "-c", "pnpm exec prisma db push --skip-generate && pnpm start"]
