# One image with everything: API server + admin website + driver web app.
# Build:  docker build -t bread-sales .

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
RUN npm ci --no-audit --no-fund
COPY server/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    PUBLIC_DIR=/app/public
WORKDIR /app
COPY --from=server /build/server/package.json ./
COPY --from=server /build/server/node_modules ./node_modules
COPY --from=server /build/server/dist ./dist
COPY --from=server /build/server/migrations ./migrations
COPY --from=admin /build/admin-web/dist ./public/admin
COPY --from=driver /build/driver-app/dist ./public/driver
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health > /dev/null || exit 1
CMD ["node", "dist/index.js"]
