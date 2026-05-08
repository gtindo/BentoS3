import {
  S3Client,
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BentoS3 } from "../../index.js";

const TEST_REGION = "us-east-1";
const TEST_ACCESS_KEY_ID = "test";
const TEST_SECRET_ACCESS_KEY = "test-secret";
const TEST_ROOT_PREFIX = "bento-s3-server-";

describe("BentoS3 managed server", () => {
  let server: BentoS3 | undefined;

  afterEach(async () => {
    await server?.stop();
  });

  it("starts on a dynamic port", async () => {
    server = new BentoS3({ port: 0 });

    await server.start();

    expect(server.port).toEqual(expect.any(Number));
    expect(server.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("supports initial AWS SDK bucket operations", async () => {
    server = new BentoS3({ port: 0 });
    await server.start();

    const client = createS3Client(server);

    await client.send(new CreateBucketCommand({ Bucket: "photos" }));
    await client.send(new HeadBucketCommand({ Bucket: "photos" }));
    const buckets = await client.send(new ListBucketsCommand({}));

    expect(buckets.Buckets?.map((bucket) => bucket.Name)).toContain("photos");
  });

  it("persists AWS SDK bucket and object operations to the filesystem", async () => {
    const rootDir = await createTempRoot();
    server = new BentoS3({ port: 0, rootDir });
    await server.start();

    const client = createS3Client(server);
    const body = new TextEncoder().encode("hello from sdk");

    await client.send(new CreateBucketCommand({ Bucket: "photos" }));
    await client.send(
      new PutObjectCommand({
        Bucket: "photos",
        Key: "cats/leo.txt",
        Body: body,
        ContentType: "text/plain",
        Metadata: { source: "sdk-test" },
      }),
    );

    const objectPath = join(rootDir, ".bentos3", "buckets", "photos", "cats", "leo.txt");
    const metadataPath = `${objectPath}.meta.json`;
    const headObject = await client.send(
      new HeadObjectCommand({ Bucket: "photos", Key: "cats/leo.txt" }),
    );
    const getObject = await client.send(
      new GetObjectCommand({ Bucket: "photos", Key: "cats/leo.txt" }),
    );
    const listedObjects = await client.send(
      new ListObjectsV2Command({ Bucket: "photos", Prefix: "cats/" }),
    );

    await expect(readFile(objectPath)).resolves.toEqual(Buffer.from(body));
    await expect(readFile(metadataPath, "utf8")).resolves.toContain("sdk-test");
    expect(headObject.ContentType).toBe("text/plain");
    expect(headObject.Metadata?.source).toBe("sdk-test");
    await expect(getObject.Body?.transformToByteArray()).resolves.toEqual(body);
    expect(listedObjects.Contents?.map((object) => object.Key)).toEqual(["cats/leo.txt"]);

    await client.send(new DeleteObjectCommand({ Bucket: "photos", Key: "cats/leo.txt" }));
    await client.send(new DeleteBucketCommand({ Bucket: "photos" }));
  });

  it("loads persisted objects after server restart", async () => {
    const rootDir = await createTempRoot();
    server = new BentoS3({ port: 0, rootDir });
    await server.start();

    const firstClient = createS3Client(server);
    await firstClient.send(new CreateBucketCommand({ Bucket: "photos" }));
    await firstClient.send(
      new PutObjectCommand({
        Bucket: "photos",
        Key: "cats/leo.txt",
        Body: "restart-safe",
        Metadata: { persisted: "true" },
      }),
    );
    await server.stop();

    server = new BentoS3({ port: 0, rootDir });
    await server.start();

    const secondClient = createS3Client(server);
    const object = await secondClient.send(
      new GetObjectCommand({ Bucket: "photos", Key: "cats/leo.txt" }),
    );

    await expect(object.Body?.transformToString()).resolves.toBe("restart-safe");
    expect(object.Metadata?.persisted).toBe("true");
  });

  it("supports copy, bulk delete, and non-empty bucket errors", async () => {
    const rootDir = await createTempRoot();
    server = new BentoS3({ port: 0, rootDir });
    await server.start();

    const client = createS3Client(server);
    await client.send(new CreateBucketCommand({ Bucket: "photos" }));
    await client.send(
      new PutObjectCommand({ Bucket: "photos", Key: "source.txt", Body: "copy me" }),
    );

    await expect(client.send(new DeleteBucketCommand({ Bucket: "photos" }))).rejects.toMatchObject({
      name: "BucketNotEmpty",
    });

    await client.send(
      new CopyObjectCommand({
        Bucket: "photos",
        Key: "copied.txt",
        CopySource: "/photos/source.txt",
      }),
    );
    const copiedObject = await client.send(
      new GetObjectCommand({ Bucket: "photos", Key: "copied.txt" }),
    );

    await expect(copiedObject.Body?.transformToString()).resolves.toBe("copy me");

    await client.send(
      new DeleteObjectsCommand({
        Bucket: "photos",
        Delete: {
          Objects: [{ Key: "source.txt" }, { Key: "copied.txt" }],
        },
      }),
    );
    await client.send(new DeleteBucketCommand({ Bucket: "photos" }));
  });
});

function createS3Client(server: BentoS3): S3Client {
  if (!server.endpoint) {
    throw new Error("Server must be started before creating an S3 client.");
  }

  return new S3Client({
    region: TEST_REGION,
    endpoint: server.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: TEST_ACCESS_KEY_ID,
      secretAccessKey: TEST_SECRET_ACCESS_KEY,
    },
  });
}

async function createTempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), TEST_ROOT_PREFIX));
}
