# LiveSerial — single container: Next.js standalone server + migrations on start.
# Configuration is environment variables only (see .env.example / README).

FROM node:22-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ── Dependencies (+ prisma generate via postinstall) ──
FROM base AS deps
# Build-time placeholders only: prisma.config.ts reads DATABASE_URL, but nothing
# connects to a database while building. Real values come at runtime.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# ── Build ──
FROM deps AS builder
ENV NEXT_TELEMETRY_DISABLED=1 \
    BETTER_AUTH_SECRET=build-time-placeholder-not-used-at-runtime
COPY . .
RUN npm run build

# ── Prisma CLI for `migrate deploy` at start (the standalone output doesn't include it) ──
FROM base AS migrator
WORKDIR /migrate
RUN npm init -y >/dev/null \
  && npm install --no-audit --no-fund --omit=dev prisma@7.10.1 dotenv@18.0.10
COPY prisma.config.ts ./
COPY prisma ./prisma

# ── Runtime ──
FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=migrator /migrate /migrate
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["docker-entrypoint.sh"]
