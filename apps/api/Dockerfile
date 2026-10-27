# syntax=docker/dockerfile:1
# Build context: repository root (docker build -f apps/api/Dockerfile .)
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @axo/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @axo/api build && pnpm deploy --filter @axo/api --prod /out

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
RUN mkdir -p .data && chown -R node:node /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4000/health || exit 1
CMD ["node", "dist/index.js"]
