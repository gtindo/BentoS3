import { mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import s3Package from "@aws-sdk/client-s3";
import { expect, test } from "@playwright/test";
import { JsonAuthStore } from "../src/auth/json-auth-store.js";
import { BentoS3 } from "../src/index.js";

const ACCESS_KEY_ID = "test-access-key";
const SECRET_ACCESS_KEY = "test-secret-key";
const {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} = s3Package;

test("covers signed API bucket and object lifecycle with filesystem assertions", async () => {
  const rootDir = await createTempRootDir();
  const authStore = new JsonAuthStore({ rootDir });
  await authStore.createCredential({ accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY });

  const server = new BentoS3({ authStore, port: 0, rootDir });
  await server.start();

  try {
    const endpoint = readEndpoint(server);
    const client = createClient(endpoint, SECRET_ACCESS_KEY);
    const bucket = "api-e2e-bucket";
    const key = "nested/object with spaces.txt";

    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    await expect(stat(join(rootDir, ".bentos3", "buckets", bucket))).resolves.toBeTruthy();

    await expect(client.send(new CreateBucketCommand({ Bucket: bucket }))).rejects.toThrow();

    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: "hello api" }));
    await expect(readFile(join(rootDir, ".bentos3", "buckets", bucket, "nested", "object with spaces.txt"), "utf8")).resolves.toBe("hello api");
    await expect(stat(join(rootDir, ".bentos3", "buckets", bucket, "nested", "object with spaces.txt.meta.json"))).resolves.toBeTruthy();

    const headObject = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    expect(headObject.ContentLength).toBe(9);

    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    await expect(object.Body?.transformToString()).resolves.toBe("hello api");

    const listedObjects = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "nested/" }));
    expect(listedObjects.Contents?.map((entry) => entry.Key)).toContain(key);

    await expect(client.send(new DeleteBucketCommand({ Bucket: bucket }))).rejects.toThrow();

    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    await expect(stat(join(rootDir, ".bentos3", "buckets", bucket, "nested", "object with spaces.txt"))).rejects.toThrow();

    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    await expect(stat(join(rootDir, ".bentos3", "buckets", bucket))).rejects.toThrow();
  } finally {
    await server.stop();
  }
});

test("rejects invalid signed API credentials", async () => {
  const rootDir = await createTempRootDir();
  const authStore = new JsonAuthStore({ rootDir });
  await authStore.createCredential({ accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY });

  const server = new BentoS3({ authStore, port: 0, rootDir });
  await server.start();

  try {
    const endpoint = readEndpoint(server);
    const client = createClient(endpoint, "wrong-secret-key");

    await expect(client.send(new CreateBucketCommand({ Bucket: "invalid-auth-bucket" }))).rejects.toThrow();
  } finally {
    await server.stop();
  }
});

async function createTempRootDir(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "bentos3-api-e2e-"));
  const rootDir = join(parent, "root");

  await mkdir(rootDir);

  return rootDir;
}

function createClient(endpoint: string, secretAccessKey: string): InstanceType<typeof S3Client> {
  return new S3Client({
    credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey },
    endpoint,
    forcePathStyle: true,
    region: "us-east-1",
  });
}

function readEndpoint(server: BentoS3): string {
  if (!server.endpoint) {
    throw new Error("Server must expose an endpoint after startup.");
  }

  return server.endpoint;
}
