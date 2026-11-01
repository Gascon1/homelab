# syntax=docker/dockerfile:1
# Build context: rack/. web/ and server/ both import ../shared (the State contract), so each stage copies it
# next to its own folder to keep the same relative paths as the repo.

FROM node:26-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY shared/ /src/shared/
COPY web/ ./
RUN npm run build

FROM node:26-alpine AS server
WORKDIR /src/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY shared/ /src/shared/
COPY server/ ./
RUN npm run build

FROM node:26-alpine
# deploy.sh prunes old rack images by this label (CI sets it too; this covers RACK_SOURCE=build)
LABEL org.opencontainers.image.source=https://github.com/Gascon1/homelab
# Runs as root on purpose: it must read the root-owned Docker socket mounted read-only by compose.
ENV NODE_ENV=production PORT=4000 RACK_WEB_DIR=/app/web
WORKDIR /app
COPY --from=server /src/server/dist/server.mjs /app/server.mjs
COPY --from=web /src/web/dist /app/web
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "/app/server.mjs", "--healthcheck"]
CMD ["node", "/app/server.mjs"]
