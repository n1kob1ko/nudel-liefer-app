/**
 * Pure helpers of the database backup (NUD-094, NUD-200): configuration, object names, retention
 * and the PG* environment for the child processes. No I/O here, so everything is unit-tested.
 */

export type BackupConfig = {
  /** Direct (unpooled) connection string of the database to dump; a read-only role is enough. */
  databaseUrl: string;
  /** A folder on the machine that runs the backup (the server). At least one destination is set. */
  localDir?: string;
  /** The off-site bucket: the copy that survives the loss of the server. */
  s3?: {
    endpoint?: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
  /** Key prefix inside the backup bucket, always ends with `/` (or is empty). */
  prefix: string;
  retentionWeeks: number;
  /** The newest N backups are never pruned, however old (a stalled schedule must not empty the bucket). */
  keepNewest: number;
};

export const DEFAULT_RETENTION_WEEKS = 8;
export const DEFAULT_KEEP_NEWEST = 4;

type Env = Record<string, string | undefined>;

/** Reads the BACKUP_* variables. Error messages name variables, never values. */
export function readBackupConfig(
  env: Env,
): { ok: true; config: BackupConfig } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const need = (name: string) => {
    const value = env[name]?.trim();
    if (!value) errors.push(`${name} is not set`);
    return value ?? "";
  };
  // On the server the backup runs next to the app and may use the app's own connection.
  const databaseUrl = (
    env.BACKUP_DATABASE_URL ||
    env.DATABASE_URL_UNPOOLED ||
    env.DATABASE_URL ||
    ""
  ).trim();
  if (!databaseUrl) errors.push("BACKUP_DATABASE_URL (or DATABASE_URL) is not set");
  if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl)) {
    errors.push("BACKUP_DATABASE_URL must start with postgresql://");
  }
  if (databaseUrl && /-pooler\./.test(databaseUrl)) {
    errors.push(
      "BACKUP_DATABASE_URL is a pooled Neon URL: use the direct connection (no -pooler in the host name)",
    );
  }
  const localDir = env.BACKUP_LOCAL_DIR?.trim().replace(/(?!^)\/+$/, "") || undefined;
  if (localDir && !localDir.startsWith("/")) {
    errors.push("BACKUP_LOCAL_DIR must be an absolute path");
  }
  // The bucket is optional, but never half-configured: one BACKUP_S3_* variable asks for all.
  const wantsS3 = [
    "BACKUP_S3_ENDPOINT",
    "BACKUP_S3_BUCKET",
    "BACKUP_S3_ACCESS_KEY_ID",
    "BACKUP_S3_SECRET_ACCESS_KEY",
  ].some((name) => env[name]?.trim());
  const bucket = wantsS3 ? need("BACKUP_S3_BUCKET") : "";
  const accessKeyId = wantsS3 ? need("BACKUP_S3_ACCESS_KEY_ID") : "";
  const secretAccessKey = wantsS3 ? need("BACKUP_S3_SECRET_ACCESS_KEY") : "";
  const endpoint = env.BACKUP_S3_ENDPOINT?.trim() || undefined;
  if (endpoint && !/^https?:\/\//.test(endpoint)) {
    errors.push("BACKUP_S3_ENDPOINT must be an http(s) URL");
  }
  if (!localDir && !wantsS3) {
    errors.push(
      "no backup destination: set BACKUP_LOCAL_DIR (a folder on this machine) and/or the BACKUP_S3_* variables (a bucket)",
    );
  }
  const retention = env.BACKUP_RETENTION_WEEKS?.trim();
  let retentionWeeks = DEFAULT_RETENTION_WEEKS;
  if (retention) {
    if (!/^\d+$/.test(retention) || Number(retention) < 1 || Number(retention) > 520) {
      errors.push("BACKUP_RETENTION_WEEKS must be a whole number between 1 and 520");
    } else retentionWeeks = Number(retention);
  }
  let prefix = (env.BACKUP_PREFIX ?? "db/").trim().replace(/^\/+/, "");
  if (prefix && !prefix.endsWith("/")) prefix += "/";
  if (prefix.includes("..")) errors.push("BACKUP_PREFIX must not contain '..'");
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    config: {
      databaseUrl,
      localDir,
      s3: wantsS3
        ? {
            endpoint,
            region: env.BACKUP_S3_REGION?.trim() || "auto",
            bucket,
            accessKeyId,
            secretAccessKey,
          }
        : undefined,
      prefix,
      retentionWeeks,
      keepNewest: DEFAULT_KEEP_NEWEST,
    },
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `nudel-20261018T022300Z.dump` (UTC, sorts chronologically). */
export function backupFileName(now: Date): string {
  const d = now;
  return `nudel-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(
    d.getUTCHours(),
  )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z.dump`;
}

const NAME = /^nudel-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.dump$/;

/** Time encoded in the file name of a backup key below `prefix`; null for any other key. */
export function parseBackupTime(key: string, prefix: string): Date | null {
  if (!key.startsWith(prefix)) return null;
  const match = NAME.exec(key.slice(prefix.length));
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number) as number[];
  const date = new Date(Date.UTC(y!, mo! - 1, d!, h!, mi!, s!));
  // Date.UTC wraps month 13 into the next year: only a date that reads back the same is valid.
  const same =
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo! - 1 &&
    date.getUTCDate() === d &&
    date.getUTCHours() === h &&
    date.getUTCMinutes() === mi &&
    date.getUTCSeconds() === s;
  return same ? date : null;
}

/**
 * Whole hours since the backup was taken, read from its name (any folder in front is ignored);
 * null when the name is not one this script makes.
 */
export function backupAgeHours(key: string, now: Date): number | null {
  const taken = parseBackupTime(key.slice(key.lastIndexOf("/") + 1), "");
  return taken ? Math.floor((now.getTime() - taken.getTime()) / (60 * 60 * 1000)) : null;
}

/**
 * Which backups to delete: only keys that are exactly app-made backup names, older than
 * `retentionWeeks`, and never one of the newest `keepNewest`. Anything else in the bucket (other
 * files, other prefixes, names with a typo) is left alone.
 */
export function selectExpiredBackups(
  keys: string[],
  options: { prefix: string; now: Date; retentionWeeks: number; keepNewest: number },
): string[] {
  const dated = keys
    .map((key) => ({ key, time: parseBackupTime(key, options.prefix) }))
    .filter((entry): entry is { key: string; time: Date } => entry.time !== null)
    .sort((a, b) => b.time.getTime() - a.time.getTime());
  const cutoff = options.now.getTime() - options.retentionWeeks * 7 * 24 * 60 * 60 * 1000;
  return dated
    .slice(options.keepNewest)
    .filter((entry) => entry.time.getTime() < cutoff)
    .map((entry) => entry.key);
}

/** libpq environment for a connection URL, so that no password ever appears in a command line. */
export function pgEnvFromUrl(url: string): Record<string, string> {
  const u = new URL(url);
  const env: Record<string, string> = {};
  if (u.hostname) env.PGHOST = decodeURIComponent(u.hostname);
  if (u.port) env.PGPORT = u.port;
  if (u.username) env.PGUSER = decodeURIComponent(u.username);
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (database) env.PGDATABASE = database;
  const sslmode = u.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  const channelBinding = u.searchParams.get("channel_binding");
  if (channelBinding) env.PGCHANNELBINDING = channelBinding;
  const options = u.searchParams.get("options");
  if (options) env.PGOPTIONS = options;
  return env;
}

/** `host/database` of a connection URL, for "same database?" comparisons (no credentials). */
export function databaseIdentity(url: string): string {
  const u = new URL(url);
  const port = u.port || "5432";
  return `${u.hostname.toLowerCase()}:${port}/${decodeURIComponent(u.pathname.replace(/^\//, ""))}`;
}

/** Removes secrets from text that may be shown in a log (tool output, error messages). */
export function redactSecrets(text: string, secrets: Array<string | undefined>): string {
  let out = text.replace(/postgres(ql)?:\/\/[^\s'"]+/gi, "postgresql://[redacted]");
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join("[redacted]");
  }
  return out;
}

/** The major version of a `pg_dump (PostgreSQL) 16.2` style line. */
export function parseToolMajor(versionLine: string): number | null {
  const match = /(\d+)(?:\.\d+)*/.exec(versionLine.replace(/^.*?\)\s*/, ""));
  return match ? Number(match[1]) : null;
}
