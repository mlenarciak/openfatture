FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS build
WORKDIR /build
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/domain/package.json ./packages/domain/package.json
COPY infra/package.json ./infra/package.json
COPY apps/sdi-gateway/package.json ./apps/sdi-gateway/package.json
RUN npm ci --workspace=@openfatture/sdi-gateway --include-workspace-root=false --ignore-scripts
COPY apps/sdi-gateway/src ./apps/sdi-gateway/src
RUN npm exec --workspace=@openfatture/sdi-gateway --no -- esbuild src/server.ts --bundle --platform=node --target=node24 --format=cjs --outfile=/artifact/server.cjs

FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS runtime
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /artifact/server.cjs ./server.cjs
USER node
EXPOSE 8080
CMD ["node", "server.cjs"]
