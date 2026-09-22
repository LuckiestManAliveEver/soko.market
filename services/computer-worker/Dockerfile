# Isolated computer-use worker (docs/architecture/computer-runtime.md). The only image in this
# deployment that loads a browser engine. Built from the monorepo root so pnpm workspace linking
# resolves @soko/computer-runtime; deployed as a private Render service (render.yaml
# soko-market-computer-worker, type: pserv) reachable only from services/api over the private
# network - never given a public route.
#
# Base image already bundles a compatible Chromium plus every OS-level dependency Playwright
# needs (fonts, codecs, sandboxing libs) - avoids re-deriving that list by hand, the same reason
# services/receipt-ocr-service pins a base image with its OCR engine's OS deps pre-solved.
FROM mcr.microsoft.com/playwright:v1.61.1-noble AS build

WORKDIR /repo
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/computer-runtime/package.json packages/computer-runtime/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY services/computer-worker/package.json services/computer-worker/package.json

# A minimal, offline-friendly install: only the workspace packages this image actually runs.
# --frozen-lockfile matches the root API's build command (render.yaml) so a lockfile drift fails
# the build loudly instead of silently resolving something untested.
RUN COREPACK_HOME=/tmp/corepack corepack pnpm install --frozen-lockfile --filter @soko/computer-worker...

COPY packages/computer-runtime packages/computer-runtime
COPY packages/shared-types packages/shared-types
COPY services/computer-worker services/computer-worker

RUN COREPACK_HOME=/tmp/corepack corepack pnpm --filter @soko/computer-runtime build \
  && COREPACK_HOME=/tmp/corepack corepack pnpm --filter @soko/computer-worker build

FROM mcr.microsoft.com/playwright:v1.61.1-noble
ENV NODE_ENV=production \
    COMPUTER_WORKER_PORT=8091 \
    COMPUTER_WORKER_HOST=0.0.0.0

WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/computer-runtime ./packages/computer-runtime
COPY --from=build /repo/services/computer-worker ./services/computer-worker

WORKDIR /repo/services/computer-worker
EXPOSE 8091
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8091/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
