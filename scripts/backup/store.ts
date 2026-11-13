import { createReadStream, createWriteStream } from "node:fs";
import { chmod, copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { BackupConfig } from "../lib/backup";

export type BackupObject = { key: string; bytes: number; lastModified: Date };

/**
 * Where backup files live: a folder on the server (`createLocalBackupStore`) and/or a bucket
 * (`createS3BackupStore`: Cloudflare R2 or any other S3-compatible storage).
 */
export interface BackupStore {
  put(key: string, file: string, bytes: number, sha256: string): Promise<void>;
  head(key: string): Promise<{ bytes: number } | null>;
  list(prefix: string): Promise<BackupObject[]>;
  get(key: string, destination: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * A folder on the machine that runs the backup. A key is a path below it (`db/nudel-<time>.dump`),
 * so the folder looks like the bucket. Dumps hold personal data: folders are 0700, files 0600.
 */
export function createLocalBackupStore(dir: string): BackupStore {
  const root = path.resolve(dir);
  const fileFor = (key: string) => {
    const file = path.resolve(root, key);
    if (!file.startsWith(root + path.sep))
      throw new Error(`backup key "${key}" is outside ${root}`);
    return file;
  };
  return {
    async put(key, file) {
      const target = fileFor(key);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      // Copy under another name first: a crash must not leave a half-written "backup" behind.
      const partial = `${target}.partial`;
      try {
        await copyFile(file, partial);
        await chmod(partial, 0o600);
        await rename(partial, target);
      } finally {
        await rm(partial, { force: true });
      }
    },
    async head(key) {
      try {
        return { bytes: (await stat(fileFor(key))).size };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async list(prefix) {
      // `prefix` is a folder ("db/") or empty; files directly in it are the objects.
      const folder = prefix ? fileFor(prefix) : root;
      let names: string[];
      try {
        names = await readdir(folder);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
      const objects: BackupObject[] = [];
      for (const name of names) {
        const info = await stat(path.join(folder, name));
        if (info.isFile())
          objects.push({ key: `${prefix}${name}`, bytes: info.size, lastModified: info.mtime });
      }
      return objects;
    },
    async get(key, destination) {
      await copyFile(fileFor(key), destination);
    },
    async delete(key) {
      await rm(fileFor(key), { force: true });
    },
  };
}

export function createS3BackupStore(s3: NonNullable<BackupConfig["s3"]>): BackupStore {
  const client = new S3Client({
    region: s3.region,
    endpoint: s3.endpoint,
    forcePathStyle: s3.pathStyle,
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const Bucket = s3.bucket;
  return {
    async put(key, file, bytes, sha256) {
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: createReadStream(file),
          ContentLength: bytes,
          ContentType: "application/octet-stream",
          Metadata: { sha256 },
        }),
      );
    },
    async head(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { bytes: out.ContentLength ?? 0 };
      } catch (error) {
        const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404)
          return null;
        throw error;
      }
    },
    async list(prefix) {
      const objects: BackupObject[] = [];
      let token: string | undefined;
      do {
        const out = await client.send(
          new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const o of out.Contents ?? []) {
          if (o.Key && o.LastModified)
            objects.push({ key: o.Key, bytes: o.Size ?? 0, lastModified: o.LastModified });
        }
        token = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (token);
      return objects;
    },
    async get(key, destination) {
      const out = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      if (!out.Body) throw new Error(`empty body for ${key}`);
      await pipeline(out.Body as Readable, createWriteStream(destination));
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}
