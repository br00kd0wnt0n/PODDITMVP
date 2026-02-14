FROM node:20-slim AS base

# Install ffmpeg for audio format conversion (AMR → WAV) and audio mixing
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# ── Build stage ──────────────────────────────
FROM base AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

COPY . .
RUN npm run build

# ── Production stage ─────────────────────────
FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Copy standalone build output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy prisma client (needed at runtime)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

EXPOSE 8080

CMD ["node", "server.js"]
