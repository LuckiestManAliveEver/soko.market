FROM node:20.19.0-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates gnupg postgresql-client \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /tmp/soko-backups \
  && chown -R node:node /app /tmp/soko-backups

COPY --chown=node:node infra/backup/*.mjs ./

USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "require('node:fs').stat('/tmp/soko-backups/scheduler-heartbeat',(e,s)=>{if(e||Date.now()-s.mtimeMs>90000)process.exit(1)})"]
CMD ["node", "backup-scheduler.mjs"]
