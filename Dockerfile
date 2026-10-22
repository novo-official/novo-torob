# syntax=docker/dockerfile:1
# Production-like image: Next.js standalone server + a persistent SQLite volume mounted at /data.
# The dataset database is NOT baked into the image: build it with the "importer" service.
FROM node:24-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
# NEXT_PUBLIC_* values are inlined at BUILD time (also the CSP img-src derived from the tile URL). Leave unset for the default; see docs/deployment-packet.md §7.
ARG NEXT_PUBLIC_MAP_TILE_URL
ARG NEXT_PUBLIC_MAP_TILE_ATTRIBUTION
ARG NEXT_PUBLIC_MAP_TILES_DISABLED
COPY . .
RUN npm run build

# One-shot tools (db:import / db:verify). Needs tsx + sources; never part of the runtime image.
FROM deps AS tools
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
ENV DATABASE_PATH=/data/app.sqlite
RUN mkdir -p /data && chown node:node /data
USER node
CMD ["npm", "run", "db:import", "--", "--zip", "/source/torob-dataset.zip"]

FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 DATABASE_PATH=/data/app.sqlite
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
VOLUME /data
EXPOSE 3000
# Liveness only (does not require the database). Readiness is /api/ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
