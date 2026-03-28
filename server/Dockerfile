# Grimoire Pro — Production Dockerfile
# Multi-stage build: compile TypeScript → slim runtime image
# Railway auto-detects Dockerfiles and uses them for deployment.

# ─── Stage 1: Build ───
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# ─── Stage 2: Runtime ───
FROM node:20-slim AS runtime
WORKDIR /app

# Security: run as non-root user
RUN addgroup --system app && adduser --system --ingroup app app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled JS and SQL schema (needed for migrations)
COPY --from=builder /app/dist ./dist
COPY src/db/schema.sql ./dist/db/schema.sql

USER app
EXPOSE 3000

# Health check for Railway/Docker
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1))"

CMD ["node", "dist/index.js"]
