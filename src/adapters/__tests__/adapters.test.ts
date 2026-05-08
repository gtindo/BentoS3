import { PutObjectCommand } from "@aws-sdk/client-s3";
import express from "express";
import Koa from "koa";
import { createServer, type RequestListener } from "node:http";
import { describe, expect, it } from "vitest";
import { expressAdapter, koaAdapter } from "../../index.js";
import {
  createCore,
  createExpressTestServer,
  createFastifyTestServer,
  createFetchTestServer,
  createKoaTestServer,
} from "./adapter-test-servers.js";
import { createS3Client, runS3CompatibilitySuite, type TestServer } from "./compatibility-suite.js";

type MaybeAsyncRequestListener = (...parameters: Parameters<RequestListener>) => unknown;

runS3CompatibilitySuite("Express adapter", createExpressTestServer);
runS3CompatibilitySuite("Koa adapter", createKoaTestServer);
runS3CompatibilitySuite("Fastify adapter", createFastifyTestServer);
runS3CompatibilitySuite("Fetch adapter", createFetchTestServer);

describe("adapter raw stream safeguards", () => {
  it("fails predictably when Express JSON parsing consumes the S3 stream first", async () => {
    const server = await createExpressBodyParserServer();
    const client = createS3Client(server);

    try {
      await expect(
        client.send(
          new PutObjectCommand({
            Bucket: "photos",
            Key: "parsed.json",
            Body: JSON.stringify({ parsed: true }),
            ContentType: "application/json",
          }),
        ),
      ).rejects.toMatchObject({ name: "AccessDenied" });
    } finally {
      await server.stop();
    }
  });

  it("fails predictably when Koa middleware consumes the S3 stream first", async () => {
    const server = await createKoaConsumedStreamServer();
    const client = createS3Client(server);

    try {
      await expect(
        client.send(
          new PutObjectCommand({ Bucket: "photos", Key: "consumed.txt", Body: "already read" }),
        ),
      ).rejects.toMatchObject({ name: "AccessDenied" });
    } finally {
      await server.stop();
    }
  });
});

async function createExpressBodyParserServer(): Promise<TestServer> {
  const backingServer = await createExpressTestServer();
  await backingServer.stop();

  const app = express();
  const core = createCore(backingServer.rootDir);

  app.use(express.json());
  app.use("/s3", expressAdapter(core));

  return listenWithRoot(app as RequestListener, backingServer.rootDir);
}

async function createKoaConsumedStreamServer(): Promise<TestServer> {
  const backingServer = await createKoaTestServer();
  await backingServer.stop();

  const app = new Koa();
  const core = createCore(backingServer.rootDir);

  app.use(async (context, next) => {
    for await (const chunk of context.req) {
      void chunk;
      // Intentionally consume the raw stream to emulate body-parser ordering mistakes.
    }

    await next();
  });
  app.use(koaAdapter(core, { basePath: "/s3" }));

  return listenWithRoot(toRequestListener(app.callback()), backingServer.rootDir);
}

function toRequestListener(listener: MaybeAsyncRequestListener): RequestListener {
  return (request, response) => {
    const result = listener(request, response);

    if (result instanceof Promise) {
      result.catch((error: unknown) => {
        response.statusCode = 500;
        response.end(error instanceof Error ? error.message : "Internal Server Error");
      });
    }
  };
}

async function listenWithRoot(
  listener: RequestListener,
  rootDir: string,
): Promise<TestServer> {
  const server = createServer(listener);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP address.");
  }

  return {
    endpoint: `http://127.0.0.1:${String(address.port)}/s3`,
    rootDir,
    accessKeyId: "test",
    secretAccessKey: "test-secret",
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}
