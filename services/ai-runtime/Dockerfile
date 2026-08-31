FROM ollama/ollama:0.32.3 AS ollama

FROM node:22.19.0-bookworm-slim AS build
ENV COREPACK_DEFAULT_TO_LATEST=0
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY services/ai-runtime/package.json services/ai-runtime/package.json
RUN pnpm install --frozen-lockfile --filter @soko/ai-runtime...
COPY packages/shared-types packages/shared-types
COPY services/ai-runtime services/ai-runtime
RUN pnpm --filter @soko/ai-runtime build

FROM node:22.19.0-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV AI_RUNTIME_HOST=0.0.0.0
ENV AI_RUNTIME_PORT=4002
ENV OLLAMA_HOST=127.0.0.1:11434
ENV OLLAMA_BASE_URL=http://127.0.0.1:11434
ENV OLLAMA_NO_CLOUD=true
ENV MODEL_STORAGE_PATH=/var/lib/soko-models
ENV OLLAMA_MODELS=/var/lib/soko-models/ollama
WORKDIR /app
COPY --from=ollama /bin/ollama /usr/bin/ollama
COPY --from=ollama /usr/lib/ollama /usr/lib/ollama
# node:*-slim ships no CA bundle at all, so the Go-built ollama binary (which reads the OS trust
# store, unlike Node's own bundled certs) cannot verify TLS for `ollama pull` against the model
# registry. Reuse the CA bundle from the same Ollama image the binary was built for.
COPY --from=ollama /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /workspace/package.json /workspace/pnpm-workspace.yaml ./
COPY --from=build /workspace/node_modules node_modules
COPY --from=build /workspace/packages/shared-types packages/shared-types
COPY --from=build /workspace/services/ai-runtime services/ai-runtime
RUN chmod +x services/ai-runtime/scripts/start-inference.sh \
  && mkdir -p /var/lib/soko-models/ollama \
  && chown -R node:node /app /var/lib/soko-models
USER node
EXPOSE 4002
CMD ["bash", "services/ai-runtime/scripts/start-inference.sh"]
