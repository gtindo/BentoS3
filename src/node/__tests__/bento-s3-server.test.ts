import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  ListBucketsCommand,
} from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it } from "vitest";
import { BentoS3 } from "../../index.js";

const TEST_REGION = "us-east-1";
const TEST_ACCESS_KEY_ID = "test";
const TEST_SECRET_ACCESS_KEY = "test-secret";

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
