import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { usesPathStyle } from "@/lib/s3-url-style";

import { READ_URL_TTL_SECONDS, type Storage, UPLOAD_URL_TTL_SECONDS } from "./types";

export type S3Config = {
  /** Empty for AWS S3; the MinIO / Cloudflare R2 endpoint otherwise. */
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** `https://endpoint/bucket/key` (MinIO, R2) instead of `https://bucket.endpoint/key` (Railway). */
  pathStyle: boolean;
};

/** Reads the S3_* variables; returns null when the storage is not (fully) configured. */
export function readS3Config(env: Record<string, string | undefined>): S3Config | null {
  const { S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = env;
  if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) return null;
  return {
    endpoint: env.S3_ENDPOINT || undefined,
    // R2 accepts "auto"; MinIO ignores the region but the SDK requires one.
    region: env.S3_REGION || "auto",
    bucket: S3_BUCKET,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
    pathStyle: usesPathStyle(env.S3_ENDPOINT, env.S3_URL_STYLE),
  };
}

/** S3-compatible storage (AWS S3, MinIO, Cloudflare R2) using presigned URLs. */
export class S3Storage implements Storage {
  constructor(
    private readonly config: S3Config,
    private readonly client: S3Client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      // Path-style works with MinIO and R2 and avoids bucket sub-domains on localhost; a Railway
      // bucket is virtual-hosted (S3_URL_STYLE=virtual, src/lib/s3-url-style.ts).
      forcePathStyle: config.pathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // Do not add CRC32 checksum headers/params: browsers would have to send them.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
  ) {}

  async createUploadUrl(input: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds?: number;
  }) {
    const ttl = input.expiresInSeconds ?? UPLOAD_URL_TTL_SECONDS;
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: input.key,
        ContentType: input.contentType,
        ContentLength: input.contentLength,
      }),
      {
        expiresIn: ttl,
        // Sign type and size so the URL cannot be reused for another type or a larger object.
        signableHeaders: new Set(["content-type", "content-length"]),
        unhoistableHeaders: new Set(["content-type"]),
      },
    );
    return {
      url,
      method: "PUT" as const,
      headers: { "Content-Type": input.contentType },
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  getReadUrl(key: string, options?: { expiresInSeconds?: number }) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: options?.expiresInSeconds ?? READ_URL_TTL_SECONDS },
    );
  }

  async head(key: string) {
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return { bytes: out.ContentLength ?? 0, contentType: out.ContentType ?? null };
    } catch (error) {
      const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  async list(prefix: string, options?: { limit?: number; continuationToken?: string }) {
    const out = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: prefix,
        MaxKeys: Math.min(options?.limit ?? 1000, 1000),
        ContinuationToken: options?.continuationToken,
      }),
    );
    return {
      objects: (out.Contents ?? []).flatMap((o) =>
        o.Key && o.LastModified
          ? [{ key: o.Key, bytes: o.Size ?? 0, lastModified: o.LastModified }]
          : [],
      ),
      nextToken: out.IsTruncated ? out.NextContinuationToken : undefined,
    };
  }

  /**
   * Lists at most one key: succeeds only when endpoint, bucket and credentials are all valid
   * (wrong bucket = NoSuchBucket, bad keys = 403). Needs only the object read permission of the
   * bucket-scoped R2 token and changes nothing.
   */
  async checkReachable() {
    await this.client.send(new ListObjectsV2Command({ Bucket: this.config.bucket, MaxKeys: 1 }));
  }
}
