import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const TEST_REGION = "us-east-1";
export const TEST_ACCESS_KEY_ID = "test";
export const TEST_SECRET_ACCESS_KEY = "test-secret";

export interface TestServer {
  endpoint: string;
  rootDir: string;
  accessKeyId: string;
  secretAccessKey: string;
  stop(): Promise<void>;
}

interface ClientCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export function runS3CompatibilitySuite(
  name: string,
  createServer: () => Promise<TestServer>,
): void {
  describe(name, () => {
    let server: TestServer | undefined;

    afterEach(async () => {
      await server?.stop();
      server = undefined;
    });

    it("supports bucket lifecycle", async () => {
      server = await createServer();
      const client = createS3Client(server);

      await client.send(new CreateBucketCommand({ Bucket: "photos" }));
      await client
        .send(new HeadObjectCommand({ Bucket: "photos", Key: "missing.txt" }))
        .catch(() => undefined);
      const buckets = await client.send(new ListBucketsCommand({}));

      expect(buckets.Buckets?.map((bucket) => bucket.Name)).toContain("photos");

      await client.send(new DeleteBucketCommand({ Bucket: "photos" }));
    });

    it("supports object lifecycle", async () => {
      server = await createServer();
      const client = createS3Client(server);

      await client.send(new CreateBucketCommand({ Bucket: "photos" }));
      await client.send(
        new PutObjectCommand({ Bucket: "photos", Key: "cats/leo.txt", Body: "hello" }),
      );

      const object = await client.send(
        new GetObjectCommand({ Bucket: "photos", Key: "cats/leo.txt" }),
      );

      await expect(object.Body?.transformToString()).resolves.toBe("hello");

      await client.send(new DeleteObjectCommand({ Bucket: "photos", Key: "cats/leo.txt" }));
      await client.send(new DeleteBucketCommand({ Bucket: "photos" }));
    });

    it("roundtrips metadata and binary objects", async () => {
      server = await createServer();
      const client = createS3Client(server);
      const body = Uint8Array.from([0, 1, 2, 3, 254, 255]);

      await client.send(new CreateBucketCommand({ Bucket: "photos" }));
      await client.send(
        new PutObjectCommand({
          Bucket: "photos",
          Key: "binary.dat",
          Body: body,
          ContentType: "application/octet-stream",
          Metadata: { source: "adapter-suite" },
        }),
      );

      const object = await client.send(
        new GetObjectCommand({ Bucket: "photos", Key: "binary.dat" }),
      );
      const objectPath = join(server.rootDir, ".bentos3", "buckets", "photos", "binary.dat");

      expect(object.ContentType).toBe("application/octet-stream");
      expect(object.Metadata?.source).toBe("adapter-suite");
      await expect(object.Body?.transformToByteArray()).resolves.toEqual(new Uint8Array(body));
      await expect(readFile(objectPath)).resolves.toEqual(Buffer.from(body));
    });

    it("supports large-ish streamed upload and prefix listing", async () => {
      server = await createServer();
      const client = createS3Client(server);
      const body = Buffer.alloc(128 * 1024, "a");

      await client.send(new CreateBucketCommand({ Bucket: "photos" }));
      await client.send(
        new PutObjectCommand({ Bucket: "photos", Key: "cats/large.txt", Body: body }),
      );
      await client.send(
        new PutObjectCommand({ Bucket: "photos", Key: "dogs/large.txt", Body: "dog" }),
      );

      const listedObjects = await client.send(
        new ListObjectsV2Command({ Bucket: "photos", Prefix: "cats/" }),
      );
      const object = await client.send(
        new GetObjectCommand({ Bucket: "photos", Key: "cats/large.txt" }),
      );

      expect(listedObjects.Contents?.map((item) => item.Key)).toEqual(["cats/large.txt"]);
      await expect(object.Body?.transformToByteArray()).resolves.toEqual(new Uint8Array(body));
    });

    it("returns S3 errors for missing objects", async () => {
      server = await createServer();
      const client = createS3Client(server);

      await client.send(new CreateBucketCommand({ Bucket: "photos" }));

      await expect(
        client.send(new GetObjectCommand({ Bucket: "photos", Key: "missing.txt" })),
      ).rejects.toMatchObject({ name: "NoSuchKey" });
    });

    it("rejects invalid credentials", async () => {
      server = await createServer();
      const client = createS3Client(server, {
        accessKeyId: "wrong",
        secretAccessKey: server.secretAccessKey,
      });

      await expect(client.send(new ListBucketsCommand({}))).rejects.toMatchObject({
        name: "InvalidAccessKeyId",
      });
    });
  });
}

export function createS3Client(
  server: TestServer,
  credentials: ClientCredentials = {
    accessKeyId: server.accessKeyId,
    secretAccessKey: server.secretAccessKey,
  },
): S3Client {
  return new S3Client({
    region: TEST_REGION,
    endpoint: server.endpoint,
    forcePathStyle: true,
    credentials,
  });
}
