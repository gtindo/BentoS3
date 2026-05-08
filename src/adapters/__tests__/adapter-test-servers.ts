import express from "express";
import fastify from "fastify";
import Koa from "koa";
import { createServer, type IncomingHttpHeaders, type RequestListener, type Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { BentoS3Core, expressAdapter, fastifyBentoS3, handleFetchRequest, koaAdapter } from "../../index.js";
import { FileSystemStorageDriver } from "../../storage/file-system-storage-driver.js";
import { MemoryAuthStore } from "../../auth/memory-auth-store.js";
import type { TestServer } from "./compatibility-suite.js";
import { TEST_ACCESS_KEY_ID, TEST_SECRET_ACCESS_KEY } from "./compatibility-suite.js";

const HOST = "127.0.0.1";
const HTTP_PROTOCOL = "http";
const TEST_ROOT_PREFIX = "bento-s3-adapter-";

type MaybeAsyncRequestListener = (...parameters: Parameters<RequestListener>) => unknown;

export async function createExpressTestServer(): Promise<TestServer> {
  const rootDir = await createTempRoot();
  const app = express();
  const core = createCore(rootDir);

  app.use("/s3", expressAdapter(core));

  const server = await listen(app as RequestListener);

  return createTestServer(server, rootDir, "/s3");
}

export async function createKoaTestServer(): Promise<TestServer> {
  const rootDir = await createTempRoot();
  const app = new Koa();
  const core = createCore(rootDir);

  app.use(koaAdapter(core, { basePath: "/s3" }));

  const server = await listen(toRequestListener(app.callback()));

  return createTestServer(server, rootDir, "/s3");
}

export async function createFastifyTestServer(): Promise<TestServer> {
  const rootDir = await createTempRoot();
  const app = fastify();
  const core = createCore(rootDir);

  await app.register(fastifyBentoS3, { prefix: "/s3", bento: core, basePath: "/s3" });
  await app.listen({ host: HOST, port: 0 });

  return {
    endpoint: `${readFastifyEndpoint(app.server.address())}/s3`,
    rootDir,
    accessKeyId: TEST_ACCESS_KEY_ID,
    secretAccessKey: TEST_SECRET_ACCESS_KEY,
    stop: async () => {
      await app.close();
    },
  };
}

export async function createFetchTestServer(): Promise<TestServer> {
  const rootDir = await createTempRoot();
  const core = createCore(rootDir);
  const server = createServer((request, response) => {
    const host = request.headers.host ?? HOST;
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : Readable.toWeb(request);
    const fetchRequest = new Request(`${HTTP_PROTOCOL}://${host}${request.url ?? "/"}`, {
      method: request.method,
      headers: createFetchHeaders(request.headers),
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    void handleFetchRequest(core, fetchRequest, { basePath: "/s3" })
      .then(async (fetchResponse) => {
        response.statusCode = fetchResponse.status;
        fetchResponse.headers.forEach((value, name) => {
          response.setHeader(name, value);
        });

        if (!fetchResponse.body) {
          response.end();
          return;
        }

        for await (const chunk of Readable.fromWeb(fetchResponse.body)) {
          response.write(chunk);
        }

        response.end();
      })
      .catch((error: unknown) => {
        response.statusCode = 500;
        response.end(error instanceof Error ? error.message : "Internal Server Error");
      });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return createTestServer(server, rootDir, "/s3");
}

export function createCore(rootDir: string): BentoS3Core {
  return new BentoS3Core({
    storage: new FileSystemStorageDriver({ rootDir }),
    authStore: new MemoryAuthStore([
      {
        accessKeyId: TEST_ACCESS_KEY_ID,
        secretAccessKey: TEST_SECRET_ACCESS_KEY,
        enabled: true,
        createdAt: new Date(),
      },
    ]),
  });
}

async function createTempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), TEST_ROOT_PREFIX));
}

async function listen(listener: RequestListener): Promise<Server> {
  const server = createServer(listener);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
}

function createFetchHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const headerValue of value) {
        result.append(name, headerValue);
      }
      continue;
    }

    result.set(name, value);
  }

  return result;
}

function readFastifyEndpoint(address: ReturnType<Server["address"]>): string {
  if (!address || typeof address === "string") {
    throw new Error("Fastify test server did not bind to a TCP address.");
  }

  return `${HTTP_PROTOCOL}://${HOST}:${String(address.port)}`;
}

function createTestServer(server: Server, rootDir: string, basePath: string): TestServer {
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP address.");
  }

  return {
    endpoint: `${HTTP_PROTOCOL}://${HOST}:${String(address.port)}${basePath}`,
    rootDir,
    accessKeyId: TEST_ACCESS_KEY_ID,
    secretAccessKey: TEST_SECRET_ACCESS_KEY,
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
