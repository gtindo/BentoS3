import { BentoS3 } from "bento-s3";

const server = new BentoS3({ rootDir: "./.bentos3" });

await server.start();

if (!server.endpoint) {
  throw new Error("Server did not expose an endpoint after startup.");
}

console.log(`BentoS3 listening at ${server.endpoint}`);
