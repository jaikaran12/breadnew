# One image with everything: API server + admin website + driver web app + SQLite database file.
# Only needed to run on your own server instead of Cloudflare. Build:  docker build -t bread-sales .

FROM node:22-alpine AS admin
WORKDIR /build/admin-web
COPY admin-web/package.json admin-web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY admin-web/ ./
RUN npm run build

FROM node:22-alpine AS driver
WORKDIR /build/driver-app
COPY driver-app/package.json driver-app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY driver-app/ ./
RUN npm run build

FROM node:22-alpine AS server
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
# --ignore-scripts: the Cloudflare tools (dev only) bring programs that do not run on Alpine; not needed here.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY server/ ./
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    PUBLIC_DIR=/app/public \
    DATABASE_PATH=/app/data/bread.sqlite
WORKDIR /app
COPY --from=server /build/server/package.json ./
COPY --from=server /build/server/node_modules ./node_modules
COPY --from=server /build/server/dist ./dist
COPY --from=server /build/server/migrations ./migrations
COPY --from=admin /build/admin-web/dist ./public/admin
COPY --from=driver /build/driver-app/dist ./public/driver
# The SQLite database file lives here: keep this folder on a volume.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health > /dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/index.js"]
