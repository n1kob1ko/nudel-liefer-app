# Cron dispatcher for Railway (NUD-202): Node 22 plus one file, see dispatch.mts.
# Railway service: root directory /deploy/railway/cron, cron schedule "*/5 * * * *".
FROM node:22-alpine
WORKDIR /app
COPY dispatch.mts ./
USER node
# Node 22 runs the .mts file directly (type stripping, on by default since 22.18).
CMD ["node", "--disable-warning=ExperimentalWarning", "dispatch.mts"]
