import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env";

// The only code that talks to the document bucket (CLAUDE.md rule 4): S3-compatible (MinIO locally, AWS S3 or
// Cloudflare R2 in production), private, and opened only through short-lived pre-signed links.

export const bucket = env.S3_BUCKET;

export const s3 = new S3Client({
  region: env.S3_REGION,
  ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
});

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.length }));
}

/** The object's bytes, for the server's own use (the invoice PDF embeds the logo and signature). */
export async function getObject(key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body) throw new Error(`Empty object ${key}`);
  return Buffer.from(await res.Body.transformToByteArray());
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * A link that opens the file for S3_PRESIGN_SECONDS. It opens in the browser (inline) and saves under `fileName`.
 * Anyone holding the link can open it until it expires, so it is made per click and never stored.
 */
export async function presignGet(key: string, { fileName }: { fileName: string }): Promise<{ url: string; expiresAt: Date }> {
  const expiresIn = env.S3_PRESIGN_SECONDS;
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: `inline; filename="${fileName.replace(/["\\\r\n]/g, "")}"`,
  });
  const url = await getSignedUrl(s3, command, { expiresIn });
  return { url, expiresAt: new Date(Date.now() + expiresIn * 1000) };
}
