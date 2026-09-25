# The clinic site, with no Node.js needed on the host.
#
#   docker compose up --build        # http://localhost:3000
#
# Two stages on the same base image, so the native SQLite driver compiled in
# the first runs in the second.

FROM node:22-bookworm-slim AS build
# Toolchain for better-sqlite3, which is compiled here from source rather
# than downloaded prebuilt: the binary then matches this image exactly.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# The engine first: web/ installs it from the parent directory.
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
COPY src ./src
# The engine only needs its TypeScript compiler to build; its own copy of the
# driver is never loaded, so its install scripts are skipped.
RUN npm ci --ignore-scripts --no-audit --no-fund && npm run build

COPY web/package.json web/package-lock.json web/.npmrc ./web/
RUN cd web && npm_config_build_from_source=true npm ci --no-audit --no-fund
COPY web ./web
RUN cd web && npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    CLINIC_DB=/data/clinic.db \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/web
COPY --from=build --chown=node:node /app/web/package.json /app/web/next.config.mjs ./
COPY --from=build --chown=node:node /app/web/node_modules ./node_modules
COPY --from=build --chown=node:node /app/web/.next ./.next
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/book').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# 0.0.0.0 inside the container; docker-compose.yml publishes it on the
# host's loopback only.
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
