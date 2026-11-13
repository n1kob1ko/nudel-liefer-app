# Nightly master-data backup for Railway (NUD-200, NUD-202, docs/deploy-railway.md).
# Railway service: root directory / (the repository), Dockerfile path
# deploy/railway/backup/Dockerfile, cron schedule "23 2 * * *". Runs `pnpm backup:db` and exits.
#
# pg_dump must not be older than the server, so the client comes from the PostgreSQL project's
# own repository in the server's major version (keep PG_MAJOR in step with the database service).
FROM node:22-bookworm-slim

ARG PG_MAJOR=18
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
      https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends "postgresql-client-${PG_MAJOR}" \
 && apt-get purge -y curl \
 && rm -rf /var/lib/apt/lists/*
ENV PATH="/usr/lib/postgresql/${PG_MAJOR}/bin:${PATH}"

RUN npm install -g pnpm@12.14.0
WORKDIR /app

# The job needs tsx, pg and the S3 client; the lockfile decides their versions. Install scripts
# are skipped: no Prisma client and no browser download are needed for a dump.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.json ./
COPY scripts ./scripts
COPY src/lib/s3-url-style.ts ./src/lib/s3-url-style.ts

# The dump is written to a temporary file first; it holds personal data and never stays in the image.
USER node
CMD ["pnpm", "backup:db"]
