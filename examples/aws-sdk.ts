import { CreateBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const client = new S3Client({
  credentials: {
    accessKeyId: "bentos3",
    secretAccessKey: process.env.BENTOS3_SECRET_ACCESS_KEY ?? "replace-me",
  },
  endpoint: "http://127.0.0.1:9000",
  forcePathStyle: true,
  region: "us-east-1",
});

await client.send(new CreateBucketCommand({ Bucket: "example-bucket" }));
await client.send(
  new PutObjectCommand({ Bucket: "example-bucket", Key: "hello.txt", Body: "Hello BentoS3" }),
);
