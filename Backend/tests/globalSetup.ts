import { execSync } from "node:child_process";
import { CreateBucketCommand, DeleteObjectsCommand, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { Client } from "pg";
// vitest.config has already set the test bucket's name; .env gives the MinIO address and keys.
import { bucket, s3 } from "../src/lib/storage";

/**
 * Creates the test database if needed and applies all migrations to it, then makes sure the test document bucket
 * exists and is empty (MinIO from docker compose: `npm run db:up`).
 */
export default async function setup() {
  const url = new URL(process.env.DATABASE_URL as string);
  const dbName = url.pathname.slice(1);

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  await client.end();

  execSync("npx prisma migrate deploy", { stdio: "pipe", env: process.env });
  await resetTestBucket();
}

async function resetTestBucket() {
  if (!/test/i.test(bucket)) throw new Error("Refusing to empty a bucket without 'test' in its name.");
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (keys.length > 0) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
    token = page.NextContinuationToken;
  } while (token);
}
