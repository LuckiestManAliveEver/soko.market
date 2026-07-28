FROM node:20.19.0-bookworm-slim AS build

ENV COREPACK_DEFAULT_TO_LATEST=0
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages/business-core/package.json packages/business-core/package.json
COPY packages/event-core/package.json packages/event-core/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/sync-core/package.json packages/sync-core/package.json
COPY packages/tool-core/package.json packages/tool-core/package.json
COPY services/api/package.json services/api/package.json
RUN pnpm install --frozen-lockfile --filter @soko/api...

COPY packages packages
COPY services/api services/api
RUN pnpm --filter @soko/api... build

FROM node:20.19.0-bookworm-slim AS runtime

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=4000
WORKDIR /app

COPY --from=build /workspace/package.json /workspace/pnpm-workspace.yaml ./
COPY --from=build /workspace/node_modules node_modules
COPY --from=build /workspace/packages/business-core/package.json packages/business-core/package.json
COPY --from=build /workspace/packages/business-core/dist packages/business-core/dist
COPY --from=build /workspace/packages/event-core/package.json packages/event-core/package.json
COPY --from=build /workspace/packages/event-core/dist packages/event-core/dist
COPY --from=build /workspace/packages/shared-types/package.json packages/shared-types/package.json
COPY --from=build /workspace/packages/shared-types/dist packages/shared-types/dist
COPY --from=build /workspace/packages/sync-core/package.json packages/sync-core/package.json
COPY --from=build /workspace/packages/sync-core/dist packages/sync-core/dist
COPY --from=build /workspace/packages/tool-core/package.json packages/tool-core/package.json
COPY --from=build /workspace/packages/tool-core/dist packages/tool-core/dist
COPY --from=build /workspace/services/api/package.json services/api/package.json
COPY --from=build /workspace/services/api/node_modules services/api/node_modules
COPY --from=build /workspace/services/api/dist services/api/dist
COPY --from=build /workspace/services/api/scripts services/api/scripts
COPY infra/db/migrations infra/db/migrations

RUN chown -R node:node /app
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "services/api/dist/index.js"]
